import { describe, it, expect, beforeEach } from "vitest";
import { ReadStateService } from "../src/services/read-state.service.js";
import { MessageService } from "../src/services/message.service.js";
import { createMemoryRepos, type MemoryRepos } from "../src/repo/memory/store.js";
import type { Actor } from "../src/domain/actor.js";

const human: Actor = { type: "human", id: "u" };
const agent: Actor = { type: "agent", id: "cindy" };
const WS = "ws1";
const CH = "c1";

describe("ReadStateService", () => {
  let repos: MemoryRepos;
  let svc: ReadStateService;
  let messages: MessageService;
  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new ReadStateService(repos.readState, repos.seen, repos.messages);
    messages = new MessageService(repos.messages, repos.drafts, repos.seen);
  });

  it("computes unread as latest - lastRead", async () => {
    await messages.sendAsHuman(WS, human, { channelId: CH, content: "a" });
    await messages.sendAsHuman(WS, human, { channelId: CH, content: "b" });
    expect(await svc.unread(WS, agent, CH)).toBe(2);
    await svc.markRead(WS, agent, CH, 2);
    expect(await svc.unread(WS, agent, CH)).toBe(0);
  });

  it("markRead advances both read and seen cursors for an agent", async () => {
    await svc.markRead(WS, agent, CH, 5);
    expect(await repos.readState.get(WS, agent, CH)).toBe(5);
    expect(await repos.seen.get(WS, agent.id, CH)).toBe(5); // freshness aligns
  });

  it("markRead advances read but NOT a seen cursor for a human", async () => {
    await svc.markRead(WS, human, CH, 5);
    expect(await repos.readState.get(WS, human, CH)).toBe(5);
    expect(await repos.seen.get(WS, human.id, CH)).toBe(0); // humans have no freshness gate
  });

  it("read cursor is monotonic (cannot regress)", async () => {
    await svc.markRead(WS, agent, CH, 9);
    await svc.markRead(WS, agent, CH, 4);
    expect(await repos.readState.get(WS, agent, CH)).toBe(9);
  });

  it("rejects invalid upToSeq", async () => {
    await expect(svc.markRead(WS, agent, CH, -1)).rejects.toThrow();
    await expect(svc.markRead(WS, agent, CH, 1.5)).rejects.toThrow();
  });

  it("reading a channel lets a previously-held agent send succeed", async () => {
    await messages.sendAsHuman(WS, human, { channelId: CH, content: "n1" });
    // before reading → held
    const held = await messages.sendAsAgent(WS, agent, { channelId: CH, content: "x" });
    expect(held.kind).toBe("held");
    // catch up via markRead → now passes
    await svc.markRead(WS, agent, CH, 1);
    const sent = await messages.sendAsAgent(WS, agent, { channelId: CH, content: "y" });
    expect(sent.kind).toBe("sent");
  });
});
