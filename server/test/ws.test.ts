import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { createMemoryRepos } from "../src/repo/memory/store.js";
import { RealtimeBus } from "../src/realtime/bus.js";
import type { Principal } from "../src/auth/service.js";

const PRINCIPALS: Record<string, Principal> = {
  "user-tok": { workspaceId: "ws1", tier: "user", actor: { type: "human", id: "alice" } },
  "userB-tok": { workspaceId: "ws2", tier: "user", actor: { type: "human", id: "bob" } },
};
const resolveToken = async (t: string) => PRINCIPALS[t] ?? null;

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

async function start(bus: RealtimeBus): Promise<number> {
  app = await buildApp({ repos: createMemoryRepos(), resolveToken, bus });
  await app.listen({ port: 0, host: "127.0.0.1" });
  return (app.server.address() as AddressInfo).port;
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => ws.once("message", (d) => resolve(JSON.parse(d.toString()))));
}

describe("WebSocket 实时扇出", () => {
  it("鉴权成功后收到 ready,并接收本 workspace 事件", async () => {
    const bus = new RealtimeBus();
    const port = await start(bus);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=user-tok`);

    const ready = await nextMessage(ws);
    expect(ready).toMatchObject({ type: "ready", workspaceId: "ws1" });

    const incoming = nextMessage(ws);
    bus.emit("ws1", { type: "task.updated", taskId: "t-42" });
    expect(await incoming).toMatchObject({ type: "task.updated", taskId: "t-42" });

    ws.close();
  });

  it("只收到自己 workspace 的事件 (不串租户)", async () => {
    const bus = new RealtimeBus();
    const port = await start(bus);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=user-tok`);
    await nextMessage(ws); // ready

    const got: unknown[] = [];
    ws.on("message", (d) => got.push(JSON.parse(d.toString())));

    bus.emit("ws2", { type: "task.updated", taskId: "other" }); // 别的租户
    bus.emit("ws1", { type: "task.updated", taskId: "mine" }); // 自己的
    await new Promise((r) => setTimeout(r, 50));

    expect(got).toEqual([{ type: "task.updated", taskId: "mine" }]);
    ws.close();
  });

  it("无效 token → 收到 error 并被关闭", async () => {
    const bus = new RealtimeBus();
    const port = await start(bus);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=bogus`);
    const msg = await nextMessage(ws);
    expect(msg).toMatchObject({ type: "error", code: "UNAUTHENTICATED" });
    ws.close();
  });
});
