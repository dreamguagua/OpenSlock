import { describe, it, expect } from "vitest";
import { DaemonHub, type AgentStartMessage, type ControlMessage } from "../src/realtime/daemon-hub.js";

const start = (h: string): AgentStartMessage => ({
  type: "agent:start", agentHandle: h, channelId: "c1", reason: "mention",
});

describe("DaemonHub", () => {
  it("register/count/unregister", () => {
    const hub = new DaemonHub();
    expect(hub.count("ws1")).toBe(0);
    const un = hub.register("ws1", "d1", "m1", () => {});
    expect(hub.count("ws1")).toBe(1);
    un();
    expect(hub.count("ws1")).toBe(0);
  });

  it("dispatchAny 送达已注册 daemon", () => {
    const hub = new DaemonHub();
    const got: ControlMessage[] = [];
    hub.register("ws1", "d1", "m1", (m) => got.push(m));
    expect(hub.dispatchAny("ws1", start("cindy"))).toBe(true);
    expect((got[0] as AgentStartMessage)?.agentHandle).toBe("cindy");
  });

  it("无在线 daemon → dispatchAny 返回 false", () => {
    const hub = new DaemonHub();
    expect(hub.dispatchAny("ws1", start("cindy"))).toBe(false);
  });

  it("多个 daemon 轮询派发", () => {
    const hub = new DaemonHub();
    const a: ControlMessage[] = [];
    const b: ControlMessage[] = [];
    hub.register("ws1", "d1", "mA", (m) => a.push(m));
    hub.register("ws1", "d2", "mB", (m) => b.push(m));
    hub.dispatchAny("ws1", start("x"));
    hub.dispatchAny("ws1", start("y"));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("dispatchToMachine 只发给指定机器", () => {
    const hub = new DaemonHub();
    const a: ControlMessage[] = [];
    const b: ControlMessage[] = [];
    hub.register("ws1", "d1", "mA", (m) => a.push(m));
    hub.register("ws1", "d2", "mB", (m) => b.push(m));
    expect(hub.dispatchToMachine("ws1", "mB", start("x"))).toBe(true);
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
    // 不在线的机器 → false
    expect(hub.dispatchToMachine("ws1", "mZ", start("y"))).toBe(false);
  });

  it("isMachineOnline 反映连接存在", () => {
    const hub = new DaemonHub();
    expect(hub.isMachineOnline("ws1", "mA")).toBe(false);
    const un = hub.register("ws1", "d1", "mA", () => {});
    expect(hub.isMachineOnline("ws1", "mA")).toBe(true);
    un();
    expect(hub.isMachineOnline("ws1", "mA")).toBe(false);
  });

  it("按 workspace 隔离:不串租户", () => {
    const hub = new DaemonHub();
    const a: ControlMessage[] = [];
    hub.register("wsA", "d1", "mA", (m) => a.push(m));
    expect(hub.dispatchAny("wsB", start("x"))).toBe(false);
    expect(a).toHaveLength(0);
  });
});
