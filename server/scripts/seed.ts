/**
 * Seed —— 往真实 PostgreSQL 灌入 task#160 演示场景,供在 TablePlus 等 GUI 里浏览。
 * 同时充当 PG 仓储层的端到端冒烟:跑通后即证明 schema + RLS + 原子 seq/claim 正常。
 *
 * 运行:  export DATABASE_URL=... ; pnpm --filter @crew-ai/server seed
 * 幂等:每次重建演示 workspace (按 slug 删除后重插)。
 */

import { eq } from "drizzle-orm";
import { getDb, withTenant, closeDb } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { MessageService } from "../src/services/message.service.js";
import { TaskService } from "../src/services/task.service.js";
import { ReadStateService } from "../src/services/read-state.service.js";
import { createPgRepos } from "../src/repo/pg/repos.js";
import { mintCredential, createAccount } from "../src/auth/service.js";
import { isDomainError } from "../src/domain/errors.js";
import type { Actor } from "../src/domain/actor.js";

const log = (s = "") => console.log(s);

async function main() {
  const db = getDb();
  const repos = createPgRepos();
  const messages = new MessageService(repos.messages, repos.drafts, repos.seen);
  const tasks = new TaskService(repos.tasks, repos.seen, repos.messages);
  const reads = new ReadStateService(repos.readState, repos.seen, repos.messages);

  const alice: Actor = { type: "human", id: "alice" };
  const cindy: Actor = { type: "agent", id: "cindy" };
  const dave: Actor = { type: "agent", id: "dave" };

  log("=== Seed: 重建演示 workspace ===");
  // workspace 是租户根,无 RLS:可直接操作。先按 slug 清掉旧的 (级联删子表)。
  await db.delete(s.workspace).where(eq(s.workspace.slug, "demo"));
  const [ws] = await db
    .insert(s.workspace)
    .values({ name: "Demo Workspace", slug: "demo" })
    .returning();
  const WS = ws!.id;
  log(`  workspace.id = ${WS}`);

  // 租户内的基础数据 (channel / 成员) 需在 RLS 事务内插入。
  const CH = await withTenant(WS, async (tx) => {
    const [ch] = await tx
      .insert(s.channel)
      .values({ workspaceId: WS, slug: "build", kind: "channel" })
      .returning();
    await tx.insert(s.appUser).values({
      workspaceId: WS, handle: "alice", displayName: "Alice",
    });
    await tx.insert(s.agent).values([
      { workspaceId: WS, handle: "cindy", displayName: "Cindy" },
      { workspaceId: WS, handle: "dave", displayName: "Dave" },
    ]);
    return ch!.id;
  });
  log(`  channel #build id = ${CH}`);

  log("\n=== 跑 task#160 时间线 (经 PG 仓储 + 真实事务) ===");

  const m1 = await messages.sendAsHuman(WS, alice, { channelId: CH, content: "We need to fix the login bug" });
  const m2 = await messages.sendAsHuman(WS, alice, { channelId: CH, content: "@cindy take a look" });
  log(`步骤1 alice 发 2 条 → seq ${m1.seq}, ${m2.seq}`);

  const held = await messages.sendAsAgent(WS, cindy, { channelId: CH, content: "(stale reply)" });
  log(`步骤2 cindy 未读直接回复 → ${held.kind === "held" ? `HELD draft=${held.draftId} (未读${held.unseenCount})` : held.kind}`);

  await reads.markRead(WS, cindy, CH, m2.seq);
  const sent = await messages.sendAsAgent(WS, cindy, { channelId: CH, content: "Got it, I'll look into #160" });
  log(`步骤3-4 cindy 读后重发 → ${sent.kind === "sent" ? `SENT seq=${sent.message.seq}` : sent.kind}`);

  // 建任务 #160 + system 消息
  const [task160] = await withTenant(WS, async (tx) =>
    tx.insert(s.task).values({
      workspaceId: WS, channelId: CH, number: 160, title: "Fix login bug",
      messageId: m1.id, status: "todo", anchoredOnSystemMessage: false,
    }).returning(),
  );
  await messages.appendSystem(WS, CH, "📋 1 new task created: #160");

  try {
    await tasks.claim(WS, cindy, task160!.id);
  } catch (e) {
    if (isDomainError(e)) log(`步骤5 cindy 未读 system 消息时 claim → 被拦 ${e.code}`);
  }

  await reads.markRead(WS, cindy, CH, await repos.messages.latestSeq(WS, CH));
  const claimed = await tasks.claim(WS, cindy, task160!.id);
  log(`步骤6 cindy 复核后 claim → ${claimed.assignee.type}:${claimed.assignee.id} / ${claimed.status}`);

  try {
    await reads.markRead(WS, dave, CH, await repos.messages.latestSeq(WS, CH));
    await tasks.claim(WS, dave, task160!.id);
  } catch (e) {
    if (isDomainError(e)) log(`步骤7 dave 抢同一任务 → 被拒 ${e.code}`);
  }

  // 汇总当前各表行数
  log("\n=== 各表行数 (在 TablePlus 里可逐行查看) ===");
  for (const [name, tbl] of [
    ["workspace", s.workspace], ["channel", s.channel], ["app_user", s.appUser],
    ["agent", s.agent], ["message", s.message], ["draft", s.draft],
    ["task", s.task], ["channel_member", s.channelMember], ["agent_seen", s.agentSeen],
  ] as const) {
    const rows = await withTenant(WS, async (tx) => tx.select().from(tbl as never));
    log(`  ${name.padEnd(16)} ${rows.length} 行`);
  }

  // 签发可直接用于 curl/WS 的 token (明文仅此一次打印)
  const userToken = await mintCredential(WS, "user", alice);
  const agentToken = await mintCredential(WS, "agent", cindy);
  const machineToken = await mintCredential(WS, "machine", { type: "system", id: "machine-1" });
  // 登录账号(邮箱密码 → 网页登录,免贴 token)
  await createAccount(WS, "demo@crew.dev", "crew1234", alice.id);
  log("\n=== 网页登录账号(邮箱密码,免贴 token) ===");
  log("  邮箱: demo@crew.dev   密码: crew1234");

  log("\n=== 可用 token (HTTP/WS 鉴权用,明文仅打印这一次) ===");
  log(`  USER    (sk_user_*)   : ${userToken}`);
  log(`  AGENT   (sk_agent_*)  : ${agentToken}`);
  log(`  MACHINE (sk_machine_*): ${machineToken}`);
  log(`  workspace=${WS}  channel #build=${CH}`);

  log("\n✓ Seed 完成。TablePlus 连 localhost:5432 / crew_dev,看 message、task 表。");
  await closeDb();
}

main().catch(async (e) => {
  console.error("seed 失败:", e);
  await closeDb();
  process.exit(1);
});
