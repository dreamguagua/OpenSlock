/**
 * WebSocket 实时扇出 hub。
 *
 * 客户端连 `GET /ws?token=<sk_*>`,鉴权后加入其 workspace 房间,接收该 workspace 的
 * 领域事件 (message.created / task.updated)。断开时自动退订。
 */

import type { FastifyInstance } from "fastify";
import type { RealtimeBus } from "./bus.js";
import type { TokenResolver } from "../http/auth.js";

export interface WsDeps {
  readonly resolveToken: TokenResolver;
  readonly bus: RealtimeBus;
}

export async function registerWs(
  app: FastifyInstance,
  deps: WsDeps,
): Promise<void> {
  app.get("/ws", { websocket: true }, async (socket, req) => {
    const token =
      typeof (req.query as { token?: string }).token === "string"
        ? (req.query as { token?: string }).token!
        : "";
    const principal = await deps.resolveToken(token);
    if (!principal) {
      socket.send(JSON.stringify({ type: "error", code: "UNAUTHENTICATED" }));
      socket.close();
      return;
    }

    socket.send(
      JSON.stringify({ type: "ready", workspaceId: principal.workspaceId }),
    );

    const unsubscribe = deps.bus.subscribe(principal.workspaceId, (event) => {
      // socket 可能正在关闭;send 失败忽略即可,close 钩子会清理
      try {
        socket.send(JSON.stringify(event));
      } catch {
        /* readyState 非 OPEN,等待 close 清理 */
      }
    });

    socket.on("close", unsubscribe);
    socket.on("error", unsubscribe);
  });
}
