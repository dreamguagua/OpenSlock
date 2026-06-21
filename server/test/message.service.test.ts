import { describe, it, expect, beforeEach } from "vitest";
import { MessageService } from "../src/services/message.service.js";
import { createMemoryRepos, type MemoryRepos } from "../src/repo/memory/store.js";
import type { Actor } from "../src/domain/actor.js";

const human: Actor = { type: "human", id: "u" };
const agent: Actor = { type: "agent", id: "cindy" };
const WS = "ws1";
const CH = "c1";

describe("MessageService", () => {
  let repos: MemoryRepos;
  let svc: MessageService;
  beforeEach(() => {
    repos = createMemoryRepos();
    svc = new MessageService(repos.messages, repos.drafts, repos.seen);
  });

  it("human send appends with increasing seq, no freshness", async () => {
    const m1 = await svc.sendAsHuman(WS, human, { channelId: CH, content: "hello" });
    const m2 = await svc.sendAsHuman(WS, human, { channelId: CH, content: "again" });
    expect([m1.seq, m2.seq]).toEqual([1, 2]);
    expect(m1.type).toBe("human");
  });

  it("rejects empty content at the boundary (zod)", async () => {
    await expect(svc.sendAsHuman(WS, human, { channelId: CH, content: "" })).rejects.toThrow();
  });

  it("agent send passes when caught up, and advances own seen cursor", async () => {
    // agent has seen the channel up to latest (0 == empty)
    const res = await svc.sendAsAgent(WS, agent, { channelId: CH, content: "ok" });
    expect(res.kind).toBe("sent");
    if (res.kind === "sent") {
      expect(res.message.type).toBe("agent");
      expect(await repos.seen.get(WS, agent.id, CH)).toBe(res.message.seq);
    }
  });

  it("agent send is HELD as draft when channel has model-unseen messages", async () => {
    // a human posts 2 messages the agent has not seen
    await svc.sendAsHuman(WS, human, { channelId: CH, content: "n1" });
    await svc.sendAsHuman(WS, human, { channelId: CH, content: "n2" });
    const res = await svc.sendAsAgent(WS, agent, { channelId: CH, content: "stale reply" });
    expect(res).toMatchObject({ kind: "held", unseenCount: 2, fromSeq: 1, toSeq: 2 });
    // nothing of type agent was appended
    expect((await repos.messages.list(WS, CH)).some((m) => m.type === "agent")).toBe(false);
  });

  it("agent send with force=--send-draft bypasses the hold", async () => {
    await svc.sendAsHuman(WS, human, { channelId: CH, content: "n1" });
    const res = await svc.sendAsAgent(WS, agent, { channelId: CH, content: "force it", force: true });
    expect(res.kind).toBe("sent");
  });

  it("agent send passes after catching up (seen advanced)", async () => {
    await svc.sendAsHuman(WS, human, { channelId: CH, content: "n1" });
    await repos.seen.advance(WS, agent.id, CH, 1); // simulate `crew message read`
    const res = await svc.sendAsAgent(WS, agent, { channelId: CH, content: "informed reply" });
    expect(res.kind).toBe("sent");
  });

  it("appendSystem writes a system message and validates input", async () => {
    const m = await svc.appendSystem(WS, CH, "📋 1 new task created: #160");
    expect(m.type).toBe("system");
    await expect(svc.appendSystem(WS, "", "x")).rejects.toThrow();
  });
});
