import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore, createMemoryRepos } from "../src/repo/memory/store.js";
import type { Actor } from "../src/domain/actor.js";
import type { TaskRow } from "../src/repo/types.js";

const agentA: Actor = { type: "agent", id: "a" };
const human: Actor = { type: "human", id: "u" };
const WS = "ws1";

describe("MemoryStore — messages & seq", () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
  });

  it("allocates strictly increasing seq per channel starting at 1", () => {
    const m1 = store.appendMessage(WS, { channelId: "c1", type: "human", sender: human, content: "a" });
    const m2 = store.appendMessage(WS, { channelId: "c1", type: "human", sender: human, content: "b" });
    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(2);
  });

  it("keeps seq independent across channels", () => {
    store.appendMessage(WS, { channelId: "c1", type: "human", sender: human, content: "a" });
    const other = store.appendMessage(WS, { channelId: "c2", type: "human", sender: human, content: "x" });
    expect(other.seq).toBe(1);
  });

  it("isolates messages by workspace (tenant boundary)", () => {
    store.appendMessage("wsA", { channelId: "c1", type: "human", sender: human, content: "a" });
    expect(store.latestSeq("wsB", "c1")).toBe(0);
    expect(store.listMessages("wsB", "c1")).toEqual([]);
  });

  it("lists messages after a seq and respects limit", () => {
    for (let i = 0; i < 5; i++) {
      store.appendMessage(WS, { channelId: "c1", type: "human", sender: human, content: `m${i}` });
    }
    expect(store.listMessages(WS, "c1", { afterSeq: 2 }).map((m) => m.seq)).toEqual([3, 4, 5]);
    expect(store.listMessages(WS, "c1", { limit: 2 }).map((m) => m.seq)).toEqual([1, 2]);
  });

  it("gets a message by id within tenant only", () => {
    const m = store.appendMessage(WS, { channelId: "c1", type: "human", sender: human, content: "a" });
    expect(store.getMessage(WS, m.id)?.id).toBe(m.id);
    expect(store.getMessage("wsOther", m.id)).toBeNull();
  });
});

describe("MemoryStore — drafts", () => {
  it("creates and lists drafts per tenant", () => {
    const store = new MemoryStore();
    const d = store.createDraft(WS, { channelId: "c1", author: agentA, content: "held", heldAtSeq: 3 });
    expect(d.id).toMatch(/^draft_/);
    expect(store.listDrafts(WS)).toHaveLength(1);
    expect(store.listDrafts("wsOther")).toHaveLength(0);
  });
});

describe("MemoryStore — tasks & claim", () => {
  const task: TaskRow = {
    id: "t1",
    workspaceId: WS,
    channelId: "c1",
    number: 159,
    title: "fix",
    messageId: "msg_1",
    parentTaskId: null,
    assignee: null,
    createdBy: null,
    status: "todo",
    anchoredOnSystemMessage: false,
  };

  it("seeds, gets, and claims a task atomically", () => {
    const store = new MemoryStore();
    store.seedTask(task);
    expect(store.getTask(WS, "t1")?.number).toBe(159);
    expect(store.claimTask(WS, "t1", agentA)).toEqual({
      kind: "claimed",
      assignee: agentA,
      status: "in_progress",
    });
    // second claim by another is a conflict
    expect(store.claimTask(WS, "t1", { type: "agent", id: "b" })).toEqual({
      kind: "conflict",
      heldBy: agentA,
    });
  });

  it("returns not_claimable for a missing task", () => {
    const store = new MemoryStore();
    expect(store.claimTask(WS, "missing", agentA)).toEqual({ kind: "not_claimable" });
  });
});

describe("MemoryStore — seen & read cursors", () => {
  it("advances seen cursor monotonically per agent/channel", () => {
    const store = new MemoryStore();
    expect(store.getSeen(WS, "a", "c1")).toBe(0);
    expect(store.advanceSeen(WS, "a", "c1", 5)).toBe(5);
    expect(store.advanceSeen(WS, "a", "c1", 3)).toBe(5);
  });

  it("advances read cursor monotonically per member/channel", () => {
    const store = new MemoryStore();
    expect(store.getRead(WS, human, "c1")).toBe(0);
    expect(store.advanceRead(WS, human, "c1", 7)).toBe(7);
    expect(store.advanceRead(WS, human, "c1", 4)).toBe(7);
  });
});

describe("createMemoryRepos — interface adapters", () => {
  it("exposes all repo interfaces over shared state", async () => {
    const repos = createMemoryRepos();
    const m = await repos.messages.append(WS, { channelId: "c1", type: "human", sender: human, content: "hi" });
    expect(m.seq).toBe(1);
    expect(await repos.messages.latestSeq(WS, "c1")).toBe(1);
    expect(await repos.messages.get(WS, m.id)).not.toBeNull();
    expect(await repos.messages.list(WS, "c1")).toHaveLength(1);

    const d = await repos.drafts.create(WS, { channelId: "c1", author: agentA, content: "x", heldAtSeq: 1 });
    expect(d.id).toMatch(/^draft_/);

    expect(await repos.seen.get(WS, "a", "c1")).toBe(0);
    expect(await repos.seen.advance(WS, "a", "c1", 2)).toBe(2);
    expect(await repos.readState.get(WS, human, "c1")).toBe(0);
    expect(await repos.readState.advance(WS, human, "c1", 1)).toBe(1);

    repos.store.seedTask({
      id: "t1", workspaceId: WS, channelId: "c1", number: 1, title: "t",
      messageId: m.id, parentTaskId: null, assignee: null, createdBy: null, status: "todo", anchoredOnSystemMessage: false,
    });
    expect((await repos.tasks.get(WS, "t1"))?.id).toBe("t1");
    expect((await repos.tasks.claim(WS, "t1", agentA)).kind).toBe("claimed");
  });
});
