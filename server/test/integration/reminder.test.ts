import { describe, it, expect, afterAll } from "vitest";
import { createPgRepos } from "../../src/repo/pg/repos.js";
import { ReminderService } from "../../src/services/reminder.service.js";
import { ReminderWorker } from "../../src/services/reminder-worker.js";
import { closeDb } from "../../src/db/client.js";
import { HAS_DB, makeWorkspace, dropWorkspace, type Fixture } from "./helpers.js";
import type { Actor } from "../../src/domain/actor.js";

const repos = createPgRepos();
const created: string[] = [];
afterAll(async () => {
  for (const ws of created) await dropWorkspace(ws);
  await closeDb();
});
async function fixture(p: string): Promise<Fixture> {
  const f = await makeWorkspace(p);
  created.push(f.workspaceId);
  return f;
}
const owner: Actor = { type: "agent", id: "cindy" };
const NOW = new Date("2026-06-19T00:00:00.000Z");

describe.skipIf(!HAS_DB)("PG:reminder 全套 + worker", () => {
  it("schedule(once) → list → cancel,事件流记录", async () => {
    const { workspaceId } = await fixture("rem");
    const svc = new ReminderService(repos.reminders, () => NOW);
    const r = await svc.schedule(workspaceId, owner, { title: "看 CI", in: "5m" });
    expect(r.status).toBe("scheduled");
    expect((await svc.list(workspaceId, owner)).length).toBe(1);
    await svc.cancel(workspaceId, owner, r.id);
    const log = await svc.log(workspaceId, owner, r.id);
    expect(log.map((e) => e.kind)).toEqual(expect.arrayContaining(["scheduled", "cancelled"]));
  });

  it("worker:跨 workspace 扫描到点提醒并触发 (once→done + system 消息)", async () => {
    const { workspaceId, channelId } = await fixture("remfire");
    const svc = new ReminderService(repos.reminders, () => NOW);
    await svc.schedule(workspaceId, owner, { title: "巡检", in: "5m", channelId });

    const fireTime = new Date(NOW.getTime() + 600_000); // 已过期
    const worker = new ReminderWorker({
      reminders: repos.reminders, messages: repos.messages, emit: () => {}, now: () => fireTime,
    });
    const n = await worker.tick();
    expect(n).toBeGreaterThanOrEqual(1);

    // anchor 频道收到 system 提醒消息
    const msgs = await repos.messages.list(workspaceId, channelId);
    expect(msgs.some((m) => m.type === "system" && m.content.includes("巡检"))).toBe(true);
  });
});
