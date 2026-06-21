/**
 * 控制面 WebSocket —— daemon 用 sk_machine_* 连入,注册进 DaemonHub,
 * 之后 server 可经此连接主动下发 agent:start 唤醒指令。
 *
 * 与数据面 (/ws 给 web 客户端) 物理隔离:这里只走 server→daemon 控制指令 + 心跳。
 */

import type { FastifyInstance } from "fastify";
import type { DaemonHub } from "./daemon-hub.js";
import type { RealtimeBus } from "./bus.js";
import type { TokenResolver } from "../http/auth.js";
import type { MachineInfoPatch, NewAgentActivity } from "../repo/types.js";

/** 控制面只需机器在线状态 + hello 信息上报这两件事。 */
export interface ControlPlaneMachines {
  setStatus(ws: string, id: string, status: "online" | "offline"): Promise<void>;
  updateInfo(ws: string, id: string, patch: MachineInfoPatch): Promise<void>;
}

export interface ControlPlaneDeps {
  readonly resolveToken: TokenResolver;
  readonly hub: DaemonHub;
  readonly bus: RealtimeBus;
  readonly machines: ControlPlaneMachines;
  /** 持久化 agent 活动 (Activity 时间线)。 */
  readonly appendActivity: (ws: string, a: NewAgentActivity) => Promise<void>;
}

let connSeq = 0;

export async function registerControlPlane(
  app: FastifyInstance,
  deps: ControlPlaneDeps,
): Promise<void> {
  app.get("/daemon/connect", { websocket: true }, async (socket, req) => {
    const key =
      typeof (req.query as { key?: string }).key === "string"
        ? (req.query as { key?: string }).key!
        : "";
    const principal = await deps.resolveToken(key);
    if (!principal || principal.tier !== "machine") {
      socket.send(JSON.stringify({ type: "error", code: "UNAUTHENTICATED" }));
      socket.close();
      return;
    }

    const ws = principal.workspaceId;
    const machineId = principal.actor.id; // 机器凭证 subject = {system, machineId}
    const connId = `daemon-${(connSeq += 1)}`;
    const unregister = deps.hub.register(ws, connId, machineId, (msg) => {
      try {
        socket.send(JSON.stringify(msg));
      } catch {
        /* socket 非 OPEN,等 close 清理 */
      }
    });
    // 连上即在线
    void deps.machines.setStatus(ws, machineId, "online")
      .then(() => deps.bus.emit(ws, { type: "machine.updated", machineId, status: "online" }))
      .catch(() => {});

    socket.send(JSON.stringify({ type: "ready", workspaceId: ws, connId, machineId }));

    // daemon 入站:machine:hello 上报机器信息;agent:activity 广播给 web 客户端
    socket.on("message", (raw: Buffer) => {
      let msg: {
        type?: string; agentHandle?: string; channelId?: string; activity?: string;
        detail?: string; seq?: number;
        hostname?: string; os?: string; daemonVersion?: string; runtimes?: string[];
        reqId?: string; ok?: boolean; data?: unknown; error?: string;
      };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "fs:result" && typeof msg.reqId === "string") {
        deps.hub.resolveRequest(msg.reqId, {
          ok: !!msg.ok,
          ...(msg.data !== undefined ? { data: msg.data } : {}),
          ...(msg.error !== undefined ? { error: msg.error } : {}),
        });
        return;
      }
      if (msg.type === "machine:hello") {
        void deps.machines.updateInfo(ws, machineId, {
          ...(msg.hostname !== undefined ? { hostname: msg.hostname } : {}),
          ...(msg.os !== undefined ? { os: msg.os } : {}),
          ...(msg.daemonVersion !== undefined ? { daemonVersion: msg.daemonVersion } : {}),
          ...(Array.isArray(msg.runtimes) ? { runtimes: msg.runtimes } : {}),
        })
          .then(() => deps.bus.emit(ws, { type: "machine.updated", machineId, status: "online" }))
          .catch(() => {});
        return;
      }
      if (msg.type === "agent:activity" && msg.agentHandle && msg.channelId && msg.activity) {
        deps.bus.emit(ws, {
          type: "agent.activity",
          agentHandle: msg.agentHandle,
          channelId: msg.channelId,
          activity: msg.activity,
          detail: msg.detail ?? "",
          seq: msg.seq ?? 0,
        });
        // 落库为 Activity 历史 (失败不影响实时推送)
        void deps.appendActivity(ws, {
          agentHandle: msg.agentHandle,
          channelId: msg.channelId,
          activity: msg.activity,
          detail: msg.detail ?? "",
          seq: msg.seq ?? 0,
        }).catch(() => {});
      }
    });

    const onClose = () => {
      unregister();
      // 该机器无其它连接时标记离线
      if (!deps.hub.isMachineOnline(ws, machineId)) {
        void deps.machines.setStatus(ws, machineId, "offline")
          .then(() => deps.bus.emit(ws, { type: "machine.updated", machineId, status: "offline" }))
          .catch(() => {});
      }
    };
    socket.on("close", onClose);
    socket.on("error", onClose);
  });
}
