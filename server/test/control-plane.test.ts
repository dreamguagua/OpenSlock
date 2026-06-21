import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { createMemoryRepos } from "../src/repo/memory/store.js";
import { DaemonHub } from "../src/realtime/daemon-hub.js";
import type { Principal } from "../src/auth/service.js";

const PRINCIPALS: Record<string, Principal> = {
  "machine-tok": { workspaceId: "ws1", tier: "machine", actor: { type: "system", id: "m1" } },
  "user-tok": { workspaceId: "ws1", tier: "user", actor: { type: "human", id: "alice" } },
  "agent-tok": { workspaceId: "ws1", tier: "agent", actor: { type: "agent", id: "cindy" } },
};
const resolveToken = async (t: string) => PRINCIPALS[t] ?? null;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance | null = null;
afterEach(async () => { if (app) await app.close(); app = null; });

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((res) => ws.once("message", (d) => res(JSON.parse(d.toString()))));
}

describe("控制面 WS + 自动唤醒 (M3c)", () => {
  it("daemon 用 machine token 连入 → ready;@agent 发消息 → daemon 收到 agent:start", async () => {
    const repos = createMemoryRepos();
    repos.store.seedAgent({ workspaceId: "ws1", handle: "cindy", displayName: "Cindy" });
    const hub = new DaemonHub();
    app = await buildApp({ repos, resolveToken, daemonHub: hub });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;

    const daemon = new WebSocket(`ws://127.0.0.1:${port}/daemon/connect?key=machine-tok`);
    const ready = await nextMessage(daemon);
    expect(ready).toMatchObject({ type: "ready", workspaceId: "ws1" });
    expect(hub.count("ws1")).toBe(1);

    // 人类 @cindy 发消息 → 触发自动唤醒
    const incoming = nextMessage(daemon);
    const res = await app.inject({
      method: "POST", url: "/api/channels/c1/messages",
      headers: auth("user-tok"), payload: { content: "@cindy 帮我看下登录bug" },
    });
    expect(res.statusCode).toBe(201);

    const cmd = await incoming;
    expect(cmd).toMatchObject({ type: "agent:start", agentHandle: "cindy", channelId: "c1", reason: "mention" });
    daemon.close();
  });

  it("daemon 连入 → 机器置 online;断开 → 置 offline;hello 存机器信息", async () => {
    const repos = createMemoryRepos();
    const m = await repos.machines.create("ws1", { name: "box" });
    // 绑定一个机器 token (subject.id = machineId)
    PRINCIPALS["m-box"] = { workspaceId: "ws1", tier: "machine", actor: { type: "system", id: m.id } };
    app = await buildApp({ repos, resolveToken, daemonHub: new DaemonHub() });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;

    const daemon = new WebSocket(`ws://127.0.0.1:${port}/daemon/connect?key=m-box`);
    await nextMessage(daemon); // ready
    // hello 上报
    daemon.send(JSON.stringify({ type: "machine:hello", hostname: "box.local", os: "linux x64", daemonVersion: "1.2.3", runtimes: ["claude", "codex"] }));
    await new Promise((r) => setTimeout(r, 100));
    let row = await repos.machines.get("ws1", m.id);
    expect(row?.status).toBe("online");
    expect(row?.os).toBe("linux x64");
    expect(row?.runtimes).toEqual(["claude", "codex"]);

    daemon.close();
    await new Promise((r) => setTimeout(r, 150));
    row = await repos.machines.get("ws1", m.id);
    expect(row?.status).toBe("offline");
    delete PRINCIPALS["m-box"];
  });

  it("daemon 上报 agent:activity → 落库为历史", async () => {
    const repos = createMemoryRepos();
    app = await buildApp({ repos, resolveToken, daemonHub: new DaemonHub() });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    const daemon = new WebSocket(`ws://127.0.0.1:${port}/daemon/connect?key=machine-tok`);
    await nextMessage(daemon); // ready
    daemon.send(JSON.stringify({ type: "agent:activity", agentHandle: "cindy", channelId: "c1", activity: "thinking", detail: "pondering", seq: 3 }));
    await new Promise((r) => setTimeout(r, 120));
    const rows = await repos.activities.list("ws1", "cindy");
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ agentHandle: "cindy", activity: "thinking", detail: "pondering", seq: 3 });
    daemon.close();
  });

  it("非 machine token 连控制面 → 拒绝并关闭", async () => {
    app = await buildApp({ repos: createMemoryRepos(), resolveToken, daemonHub: new DaemonHub() });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/daemon/connect?key=agent-tok`);
    const msg = await nextMessage(ws);
    expect(msg).toMatchObject({ type: "error", code: "UNAUTHENTICATED" });
    ws.close();
  });
});
