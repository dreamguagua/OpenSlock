import { describe, it, expect, beforeEach } from "vitest";
import { TaskService } from "../src/services/task.service.js";
import { createMemoryRepos, type MemoryRepos } from "../src/repo/memory/store.js";
import { isDomainError, type DomainErrorCode } from "../src/domain/errors.js";
import type { Actor } from "../src/domain/actor.js";
import type { TaskRow } from "../src/repo/types.js";

const agentA: Actor = { type: "agent", id: "a" };
const agentB: Actor = { type: "agent", id: "b" };
const WS = "ws1";

function makeTask(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "t1", workspaceId: WS, channelId: "c1", number: 160, title: "fix",
    messageId: "msg_1", parentTaskId: null, assignee: null, createdBy: null, status: "todo",
    anchoredOnSystemMessage: false, ...over,
  };
}

async function expectCode(p: Promise<unknown>, code: DomainErrorCode) {
  try {
    await p;
    expect.unreachable("expected DomainError " + code);
  } catch (e) {
    expect(isDomainError(e)).toBe(true);
    if (isDomainError(e)) expect(e.code).toBe(code);
  }
}

describe("TaskService.claim", () => {
  let repos: MemoryRepos;
  let svc: TaskService;
  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new TaskService(repos.tasks, repos.seen, repos.messages);
  });

  it("claims an unassigned task → in_progress", async () => {
    repos.store.seedTask(makeTask());
    const res = await svc.claim(WS, agentA, "t1");
    expect(res).toMatchObject({ assignee: agentA, status: "in_progress", idempotent: false });
  });

  it("is idempotent when re-claimed by the same agent", async () => {
    repos.store.seedTask(makeTask({ assignee: agentA, status: "in_progress" }));
    const res = await svc.claim(WS, agentA, "t1");
    expect(res.idempotent).toBe(true);
  });

  it("conflicts when held by another agent (no stealing)", async () => {
    repos.store.seedTask(makeTask({ assignee: agentB, status: "in_progress" }));
    await expectCode(svc.claim(WS, agentA, "t1"), "CLAIM_CONFLICT");
  });

  it("throws NOT_FOUND for a missing task", async () => {
    await expectCode(svc.claim(WS, agentA, "ghost"), "NOT_FOUND");
  });

  it("throws NOT_CLAIMABLE for a system-anchored task", async () => {
    repos.store.seedTask(makeTask({ anchoredOnSystemMessage: true }));
    await expectCode(svc.claim(WS, agentA, "t1"), "NOT_CLAIMABLE");
  });

  it("is FRESHNESS_HELD when the channel has model-unseen messages (task#160 case)", async () => {
    repos.store.seedTask(makeTask());
    // a system "task created" message lands in the channel, agent hasn't seen it
    await repos.messages.append(WS, {
      channelId: "c1", type: "system", sender: { type: "system", id: "platform" },
      content: "📋 1 new task created: #160",
    });
    await expectCode(svc.claim(WS, agentA, "t1"), "FRESHNESS_HOLD");
  });

  it("succeeds on retry after the agent catches up", async () => {
    repos.store.seedTask(makeTask());
    await repos.messages.append(WS, {
      channelId: "c1", type: "system", sender: { type: "system", id: "platform" },
      content: "📋 1 new task created: #160",
    });
    await repos.seen.advance(WS, agentA.id, "c1", 1); // re-read
    const res = await svc.claim(WS, agentA, "t1");
    expect(res.status).toBe("in_progress");
  });

  it("enforces tenant isolation: cannot claim a task in another workspace", async () => {
    repos.store.seedTask(makeTask({ workspaceId: "wsA" }));
    await expectCode(svc.claim("wsB", agentA, "t1"), "NOT_FOUND");
  });

  it("create:发 task-message + 分配 number + 状态 todo", async () => {
    const r1 = await svc.create(WS, agentA, { channelId: "c1", title: "修登录" });
    expect(r1.task.number).toBe(1);
    expect(r1.task.status).toBe("todo");
    expect(r1.message.content).toBe("修登录"); // 锚定消息
    const r2 = await svc.create(WS, agentA, { channelId: "c1", title: "另一个" });
    expect(r2.task.number).toBe(2); // number 单调
  });

  it("list:按状态/负责人过滤", async () => {
    const a = await svc.create(WS, agentA, { channelId: "c1", title: "t1" });
    await svc.create(WS, agentA, { channelId: "c1", title: "t2" });
    await svc.claim(WS, agentA, a.task.id); // a → in_progress, 归 agentA
    expect((await svc.list(WS, { channelId: "c1" })).length).toBe(2);
    expect((await svc.list(WS, { status: "todo" })).length).toBe(1);
    expect((await svc.list(WS, { assignee: agentA })).length).toBe(1);
  });

  it("updateStatus:assignee 推进 in_progress→in_review→done", async () => {
    const { task } = await svc.create(WS, agentA, { channelId: "c1", title: "t" });
    await svc.claim(WS, agentA, task.id);
    expect((await svc.updateStatus(WS, agentA, task.id, "in_review")).status).toBe("in_review");
    expect((await svc.updateStatus(WS, agentA, task.id, "done")).status).toBe("done");
  });

  it("updateStatus:非 assignee → FORBIDDEN", async () => {
    const { task } = await svc.create(WS, agentA, { channelId: "c1", title: "t" });
    await svc.claim(WS, agentA, task.id);
    await expectCode(svc.updateStatus(WS, agentB, task.id, "done"), "FORBIDDEN");
  });

  it("updateStatus:done 后再改 → CONFLICT(终态)", async () => {
    const { task } = await svc.create(WS, agentA, { channelId: "c1", title: "t" });
    await svc.claim(WS, agentA, task.id);
    await svc.updateStatus(WS, agentA, task.id, "done");
    await expectCode(svc.updateStatus(WS, agentA, task.id, "todo"), "CONFLICT");
  });

  it("updateStatus:非法状态 → VALIDATION", async () => {
    const { task } = await svc.create(WS, agentA, { channelId: "c1", title: "t" });
    await svc.claim(WS, agentA, task.id);
    await expectCode(svc.updateStatus(WS, agentA, task.id, "shipping"), "VALIDATION");
  });

  it("assign:done 任务不可改派 → CONFLICT(状态机终态冻结)", async () => {
    const { task } = await svc.create(WS, agentA, { channelId: "c1", title: "t" });
    await svc.claim(WS, agentA, task.id);
    await svc.updateStatus(WS, agentA, task.id, "done");
    await expectCode(svc.assign(WS, agentA, task.id, "dave"), "CONFLICT");
  });

  it("unclaim:本人释放 in_progress → 回到 todo 且可被他人再认领", async () => {
    const { task } = await svc.create(WS, agentA, { channelId: "c1", title: "t" });
    await svc.claim(WS, agentA, task.id);
    const released = await svc.unclaim(WS, agentA, task.id);
    expect(released.assignee).toBeNull();
    expect(released.status).toBe("todo");
    await repos.seen.advance(WS, agentB.id, "c1", 999); // agentB 先补课,避免被 freshness 拦
    const reclaimed = await svc.claim(WS, agentB, task.id);
    expect(reclaimed.assignee).toEqual(agentB);
  });

  it("unclaim:未认领 → CONFLICT;别人的 → FORBIDDEN", async () => {
    const { task } = await svc.create(WS, agentA, { channelId: "c1", title: "t" });
    await expectCode(svc.unclaim(WS, agentA, task.id), "CONFLICT"); // 没人认领
    await svc.claim(WS, agentA, task.id);
    await expectCode(svc.unclaim(WS, agentB, task.id), "FORBIDDEN"); // agentB 不能释放 agentA 的
  });

  it("maps a repo not_claimable result to NOT_CLAIMABLE (defensive path)", async () => {
    // 一个总是返回 not_claimable 的 repo,验证 service 的结果映射 (防御性分支)
    const notImpl = async () => { throw new Error("not used in this test"); };
    const stubTasks = {
      get: async () => makeTask(),
      claim: async () => ({ kind: "not_claimable" as const }),
      list: notImpl,
      create: notImpl,
      unclaim: notImpl,
      updateStatus: notImpl,
    } as never;
    const stubSvc = new TaskService(stubTasks, repos.seen, repos.messages);
    await expectCode(stubSvc.claim(WS, agentA, "t1"), "NOT_CLAIMABLE");
  });
});

describe("TaskService.assign", () => {
  const human: Actor = { type: "human", id: "alice" };
  let repos: MemoryRepos;
  let svc: TaskService;
  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new TaskService(repos.tasks, repos.seen, repos.messages);
  });

  it("human assigns an unassigned task → assignee set, todo→in_progress", async () => {
    repos.store.seedTask(makeTask());
    const t = await svc.assign(WS, human, "t1", "b");
    expect(t.assignee).toEqual(agentB);
    expect(t.status).toBe("in_progress");
  });

  it("current assignee can hand off to another agent", async () => {
    repos.store.seedTask(makeTask({ assignee: agentA, status: "in_progress" }));
    const t = await svc.assign(WS, agentA, "t1", "b");
    expect(t.assignee).toEqual(agentB);
  });

  it("a non-assignee agent cannot reassign someone else's task", async () => {
    repos.store.seedTask(makeTask({ assignee: agentA, status: "in_progress" }));
    await expectCode(svc.assign(WS, agentB, "t1", "b"), "FORBIDDEN");
  });

  it("human can reassign a task held by another agent", async () => {
    repos.store.seedTask(makeTask({ assignee: agentA, status: "in_progress" }));
    const t = await svc.assign(WS, human, "t1", "b");
    expect(t.assignee).toEqual(agentB);
  });

  it("throws NOT_FOUND for a missing task", async () => {
    await expectCode(svc.assign(WS, human, "missing", "b"), "NOT_FOUND");
  });

  it("cannot assign a done task (terminal)", async () => {
    repos.store.seedTask(makeTask({ assignee: agentA, status: "done" }));
    await expectCode(svc.assign(WS, human, "t1", "b"), "CONFLICT");
  });

  it("cannot assign a system-anchored task", async () => {
    repos.store.seedTask(makeTask({ anchoredOnSystemMessage: true }));
    await expectCode(svc.assign(WS, human, "t1", "b"), "NOT_CLAIMABLE");
  });
});
