import { describe, it, expect, beforeEach } from "vitest";
import { ReminderService } from "../src/services/reminder.service.js";
import { ReminderWorker } from "../src/services/reminder-worker.js";
import { createMemoryReminderRepo } from "../src/repo/memory/reminder.repo.js";
import { createMemoryRepos, type MemoryRepos } from "../src/repo/memory/store.js";
import { isDomainError, type DomainErrorCode } from "../src/domain/errors.js";
import type { Actor } from "../src/domain/actor.js";
import type { ReminderRepo } from "../src/repo/types.js";

const WS = "ws1";
const owner: Actor = { type: "agent", id: "cindy" };
const other: Actor = { type: "agent", id: "dave" };
const NOW = new Date("2026-06-19T00:00:00.000Z");

async function expectCode(p: Promise<unknown>, code: DomainErrorCode) {
  try { await p; expect.unreachable("expected " + code); }
  catch (e) { expect(isDomainError(e) && e.code).toBe(code); }
}

describe("ReminderService", () => {
  let repo: ReminderRepo;
  let svc: ReminderService;
  beforeEach(() => {
    repo = createMemoryReminderRepo();
    svc = new ReminderService(repo, () => NOW);
  });

  it("schedule --in → once,nextFireAt = now+dur", async () => {
    const r = await svc.schedule(WS, owner, { title: "看 CI", in: "5m" });
    expect(r.kind).toBe("once");
    expect(new Date(r.nextFireAt!).getTime()).toBe(NOW.getTime() + 300_000);
    expect(r.status).toBe("scheduled");
  });

  it("schedule --cron → recurring", async () => {
    const r = await svc.schedule(WS, owner, { title: "周报", cron: "0 9 * * 1", timezone: "UTC" });
    expect(r.kind).toBe("recurring");
    expect(r.cron).toBe("0 9 * * 1");
  });

  it("list 只看自己的", async () => {
    await svc.schedule(WS, owner, { title: "a", in: "5m" });
    await svc.schedule(WS, other, { title: "b", in: "5m" });
    expect((await svc.list(WS, owner)).length).toBe(1);
  });

  it("snooze 推后 + 记事件", async () => {
    const r = await svc.schedule(WS, owner, { title: "a", in: "5m" });
    const s = await svc.snooze(WS, owner, r.id, "1h");
    expect(s.status).toBe("snoozed");
    expect(new Date(s.nextFireAt!).getTime()).toBe(NOW.getTime() + 3_600_000);
    const log = await svc.log(WS, owner, r.id);
    expect(log.some((e) => e.kind === "snoozed")).toBe(true);
  });

  it("update 改标题/时间", async () => {
    const r = await svc.schedule(WS, owner, { title: "a", in: "5m" });
    const u = await svc.update(WS, owner, r.id, { title: "b", in: "10m" });
    expect(u.title).toBe("b");
    expect(new Date(u.nextFireAt!).getTime()).toBe(NOW.getTime() + 600_000);
  });

  it("cancel → status cancelled", async () => {
    const r = await svc.schedule(WS, owner, { title: "a", in: "5m" });
    expect((await svc.cancel(WS, owner, r.id)).status).toBe("cancelled");
  });

  it("非 owner 操作 → FORBIDDEN", async () => {
    const r = await svc.schedule(WS, owner, { title: "a", in: "5m" });
    await expectCode(svc.cancel(WS, other, r.id), "FORBIDDEN");
    await expectCode(svc.snooze(WS, other, r.id, "1h"), "FORBIDDEN");
    await expectCode(svc.log(WS, other, r.id), "FORBIDDEN");
  });

  it("操作不存在的提醒 → NOT_FOUND", async () => {
    await expectCode(svc.cancel(WS, owner, "ghost"), "NOT_FOUND");
  });
});

describe("ReminderWorker", () => {
  let repos: MemoryRepos;
  let svc: ReminderService;
  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new ReminderService(repos.reminders, () => NOW);
  });

  it("到点的 once 提醒 → 触发:发 system 消息 + 置 done + 记 fired", async () => {
    const r = await svc.schedule(WS, owner, { title: "看 CI", in: "5m", channelId: "c1" });
    const fireTime = new Date(NOW.getTime() + 600_000); // 10 分钟后,已过期
    const worker = new ReminderWorker({
      reminders: repos.reminders, messages: repos.messages, emit: () => {},
      now: () => fireTime,
    });
    const fired = await worker.tick();
    expect(fired).toBe(1);
    // system 消息已发到 c1
    const msgs = await repos.messages.list(WS, "c1");
    expect(msgs.some((m) => m.type === "system" && m.content.includes("看 CI"))).toBe(true);
    // 提醒变 done
    const after = await repos.reminders.get(WS, r.id);
    expect(after?.status).toBe("done");
    // 事件流含 fired
    const log = await repos.reminders.listEvents(WS, r.id);
    expect(log.some((e) => e.kind === "fired")).toBe(true);
  });

  it("recurring 触发后重排下次 (仍 scheduled)", async () => {
    const r = await svc.schedule(WS, owner, { title: "周报", cron: "*/5 * * * *", timezone: "UTC", channelId: "c1" });
    const fireTime = new Date(NOW.getTime() + 600_000);
    const worker = new ReminderWorker({
      reminders: repos.reminders, messages: repos.messages, emit: () => {}, now: () => fireTime,
    });
    await worker.tick();
    const after = await repos.reminders.get(WS, r.id);
    expect(after?.status).toBe("scheduled"); // 周期性 → 继续
    expect(new Date(after!.nextFireAt!).getTime()).toBeGreaterThan(fireTime.getTime());
  });

  it("未到点不触发", async () => {
    await svc.schedule(WS, owner, { title: "later", in: "1h", channelId: "c1" });
    const worker = new ReminderWorker({
      reminders: repos.reminders, messages: repos.messages, emit: () => {},
      now: () => new Date(NOW.getTime() + 60_000), // 才过 1 分钟
    });
    expect(await worker.tick()).toBe(0);
  });
});
