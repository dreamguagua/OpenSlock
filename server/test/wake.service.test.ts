import { describe, it, expect, beforeEach } from "vitest";
import { WakeService } from "../src/services/wake.service.js";
import { DaemonHub, type AgentStartMessage, type ControlMessage } from "../src/realtime/daemon-hub.js";

const WS = "ws1";
const AGENTS = [
  { handle: "cindy", machineId: null },
  { handle: "dave", machineId: null },
];

describe("WakeService", () => {
  let hub: DaemonHub;
  let got: AgentStartMessage[];
  let svc: WakeService;
  beforeEach(() => {
    hub = new DaemonHub();
    got = [];
    hub.register(WS, "d1", "m1", (m) => got.push(m as AgentStartMessage));
    svc = new WakeService(hub, async () => AGENTS);
  });

  it("@到的 agent 被唤醒", async () => {
    const woken = await svc.onMessage(WS, {
      channelId: "c1", content: "@cindy 看下", senderType: "human", senderId: "alice",
    });
    expect(woken).toEqual(["cindy"]);
    expect(got[0]).toMatchObject({ type: "agent:start", agentHandle: "cindy", reason: "mention" });
  });

  it("线程回复 → 唤醒带 threadId(要求 agent 在线程内回)", async () => {
    await svc.onMessage(WS, {
      channelId: "c1", content: "@cindy 跟进", senderType: "human", senderId: "alice",
      threadParentId: "parent-msg-123",
    });
    expect(got[0]?.wake?.threadId).toBe("parent-msg-123");
  });

  it("顶层消息:以消息自身为线程根 → 唤醒 threadId=消息id(agent 回复都落该线程)", async () => {
    await svc.onMessage(WS, {
      channelId: "c1", content: "@cindy 看下这个问题", senderType: "human", senderId: "alice",
      messageId: "msg-top-1", // 顶层(无 threadParentId)
    });
    expect(got[0]?.wake?.threadId).toBe("msg-top-1");
  });

  it("频道广播:人类发普通消息 → 频道 agent 成员被唤醒(reason channel),非成员不唤醒", async () => {
    // c1 成员:cindy(agent)、zoe(不在 AGENTS 名册也无所谓,广播只看成员表)
    const members = new Map<string, string[]>([["c1", ["cindy"]]]);
    const svc2 = new WakeService(hub, async () => AGENTS, undefined, async (_ws, ch) => members.get(ch) ?? []);
    const woken = await svc2.onMessage(WS, { channelId: "c1", content: "有个问题没人@", senderType: "human", senderId: "alice" });
    expect(woken).toEqual(["cindy"]);
    expect(got[0]).toMatchObject({ agentHandle: "cindy", reason: "channel" });
    // dave 不是 c1 成员 → 不被唤醒
    expect(got.some((m) => m.agentHandle === "dave")).toBe(false);
  });

  it("频道广播:agent 发的普通消息不广播(防风暴),只走 @", async () => {
    const members = new Map<string, string[]>([["c1", ["cindy", "dave"]]]);
    const svc2 = new WakeService(hub, async () => AGENTS, undefined, async (_ws, ch) => members.get(ch) ?? []);
    const woken = await svc2.onMessage(WS, { channelId: "c1", content: "随便说句", senderType: "agent", senderId: "cindy" });
    expect(woken).toEqual([]); // 无 @ + agent 发 → 不广播
  });

  it("频道广播:@提及优先级高于广播(reason mention),且不重复唤醒", async () => {
    const members = new Map<string, string[]>([["c1", ["cindy", "dave"]]]);
    const svc2 = new WakeService(hub, async () => AGENTS, undefined, async (_ws, ch) => members.get(ch) ?? []);
    const woken = await svc2.onMessage(WS, { channelId: "c1", content: "@cindy 你看下", senderType: "human", senderId: "alice" });
    expect(woken.sort()).toEqual(["cindy", "dave"]); // cindy(@) + dave(广播)
    expect(got.find((m) => m.agentHandle === "cindy")?.reason).toBe("mention");
    expect(got.find((m) => m.agentHandle === "dave")?.reason).toBe("channel");
    expect(got.filter((m) => m.agentHandle === "cindy")).toHaveLength(1); // 不重复
  });

  it("线程退订:退订该线程的 agent 在线程内 @ 不被唤醒,其它线程/顶层仍唤醒", async () => {
    const muted = new Map<string, Set<string>>([["thread-A", new Set(["cindy"])]]);
    const svc2 = new WakeService(hub, async () => AGENTS, async (_ws, tid) => muted.get(tid) ?? new Set());
    expect(await svc2.onMessage(WS, { channelId: "c1", content: "@cindy 跟进", senderType: "human", senderId: "alice", threadParentId: "thread-A" })).toEqual([]);
    expect(await svc2.onMessage(WS, { channelId: "c1", content: "@cindy 跟进", senderType: "human", senderId: "alice", threadParentId: "thread-B" })).toEqual(["cindy"]);
    expect(await svc2.onMessage(WS, { channelId: "c1", content: "@cindy 看下", senderType: "human", senderId: "alice" })).toEqual(["cindy"]);
  });

  it("DM wakeAgentByHandle 也透传 threadId", async () => {
    const ok = await svc.wakeAgentByHandle(WS, "cindy", "dm1", "在吗", "alice", "parent-xyz");
    expect(ok).toBe(true);
    expect(got[got.length - 1]?.wake?.threadId).toBe("parent-xyz");
  });

  it("@非 agent → 不唤醒", async () => {
    const woken = await svc.onMessage(WS, {
      channelId: "c1", content: "@alice 你好", senderType: "human", senderId: "bob",
    });
    expect(woken).toEqual([]);
  });

  it("不唤醒自己 (agent @自己)", async () => {
    const woken = await svc.onMessage(WS, {
      channelId: "c1", content: "我 @cindy 自言自语", senderType: "agent", senderId: "cindy",
    });
    expect(woken).toEqual([]);
  });

  it("无在线 daemon → 不计入已唤醒", async () => {
    const svc2 = new WakeService(new DaemonHub(), async () => AGENTS);
    const woken = await svc2.onMessage(WS, {
      channelId: "c1", content: "@cindy", senderType: "human", senderId: "a",
    });
    expect(woken).toEqual([]);
  });

  it("agent 绑定 machine → 精确投递到那台机器", async () => {
    const h2 = new DaemonHub();
    const onA: ControlMessage[] = [];
    const onB: ControlMessage[] = [];
    h2.register(WS, "dA", "mA", (m) => onA.push(m));
    h2.register(WS, "dB", "mB", (m) => onB.push(m));
    const svc2 = new WakeService(h2, async () => [{ handle: "cindy", machineId: "mB" }]);
    const woken = await svc2.onMessage(WS, {
      channelId: "c1", content: "@cindy 上线", senderType: "human", senderId: "alice",
    });
    expect(woken).toEqual(["cindy"]);
    expect(onA).toHaveLength(0);
    expect(onB).toHaveLength(1);
  });

  it("agent 绑定的 machine 离线 → 唤醒落空 (不兜底到别的机器)", async () => {
    const h2 = new DaemonHub();
    const onA: ControlMessage[] = [];
    h2.register(WS, "dA", "mA", (m) => onA.push(m));
    const svc2 = new WakeService(h2, async () => [{ handle: "cindy", machineId: "mOffline" }]);
    const woken = await svc2.onMessage(WS, {
      channelId: "c1", content: "@cindy", senderType: "human", senderId: "alice",
    });
    expect(woken).toEqual([]);
    expect(onA).toHaveLength(0);
  });
});

describe("WakeService.dispatchTriage (Cindy 分诊)", () => {
  let hub: DaemonHub;
  let got: AgentStartMessage[];
  let svc: WakeService;
  const ROSTER = [
    { handle: "cindy", displayName: "Cindy", description: "总管/调度" },
    { handle: "dave", displayName: "Dave", description: "开发" },
    { handle: "qa", displayName: "QA", description: "测试" },
  ];
  const TASK = { id: "t1", number: 5, title: "修登录 bug", channelId: "c1", by: "alice" };

  beforeEach(() => {
    hub = new DaemonHub();
    got = [];
    hub.register(WS, "d1", "m1", (m) => got.push(m as AgentStartMessage));
    svc = new WakeService(hub, async () => [
      { handle: "cindy", machineId: null },
      { handle: "dave", machineId: null },
      { handle: "qa", machineId: null },
    ]);
  });

  it("无 @ 的任务 → 唤醒总管 Cindy(reason=triage),内容含任务与团队职责", async () => {
    const ok = await svc.dispatchTriage(WS, ROSTER, TASK);
    expect(ok).toBe(true);
    const m = got[got.length - 1];
    expect(m).toMatchObject({ type: "agent:start", agentHandle: "cindy", reason: "triage" });
    expect(m?.wake?.content).toContain("分诊");
    expect(m?.wake?.content).toContain("t1");
    expect(m?.wake?.content).toContain("dave");
    expect(m?.wake?.content).toContain("qa");
    // 名册里不应把总管自己列为可派对象
    expect(m?.wake?.content).not.toContain("- cindy");
  });

  it("发起人就是总管 → 不回派给自己", async () => {
    const ok = await svc.dispatchTriage(WS, ROSTER, { ...TASK, by: "cindy" });
    expect(ok).toBe(false);
    expect(got).toHaveLength(0);
  });

  it("团队里没有总管 → 不分诊", async () => {
    const ok = await svc.dispatchTriage(WS, [{ handle: "dave" }], TASK);
    expect(ok).toBe(false);
    expect(got).toHaveLength(0);
  });
});
