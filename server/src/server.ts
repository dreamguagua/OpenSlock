/**
 * 生产入口:用 PG 仓储 + DB 鉴权启动 Fastify。
 *   pnpm --filter @crew-ai/server start   (或根目录 `pnpm dev` 同时起前后端)
 */

import "dotenv/config"; // 先加载 server/.env(DATABASE_URL / CREW_PUBLIC_URL / CREW_DAEMON_DIR)
import { buildApp } from "./http/app.js";
import { createPgRepos } from "./repo/pg/repos.js";
import { resolveToken } from "./auth/service.js";
import { closeDb } from "./db/client.js";
import { ReminderWorker } from "./services/reminder-worker.js";
import { OrphanSweeper } from "./services/orphan-sweeper.js";
import { WakeService } from "./services/wake.service.js";
import { defaultBus } from "./realtime/bus.js";
import { defaultDaemonHub } from "./realtime/daemon-hub.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";

async function main() {
  const repos = createPgRepos();
  // 启动归零:server 重启后内存连接已清空,DB 里残留的 online 都是 stale,先全部置 offline
  await repos.machines.resetAllOffline();
  const app = await buildApp({ repos, resolveToken, serveDashboard: true });
  await app.listen({ port: PORT, host: HOST });
  console.log(`Crew server listening on http://${HOST}:${PORT}`);

  // 提醒触发 worker (每 30s 扫描到点提醒)
  const worker = new ReminderWorker({
    reminders: repos.reminders,
    messages: repos.messages,
    emit: defaultBus.emit,
    hub: defaultDaemonHub, // 提醒触发时经控制面唤醒 owner agent
  });
  worker.start();

  // 防漏兜底巡检 (每 60s):无主超时任务 → 先 Cindy 分诊,再升级人类
  const wakeSvc = new WakeService(defaultDaemonHub, async (ws) =>
    (await repos.agents.list(ws)).map((a) => ({ handle: a.handle, machineId: a.machineId })),
  );
  const sweeper = new OrphanSweeper({
    tasks: repos.tasks,
    agents: repos.agents,
    messages: repos.messages,
    triage: (ws, roster, task) => wakeSvc.dispatchTriage(ws, roster, task),
    emit: defaultBus.emit,
  });
  sweeper.start();

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      await app.close();
      await closeDb();
      process.exit(0);
    });
  }
}

main().catch((e) => {
  console.error("server 启动失败:", e);
  process.exit(1);
});
