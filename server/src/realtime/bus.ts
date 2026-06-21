/**
 * 进程内实时事件总线 (按 workspace 房间扇出)。
 *
 * Service/路由产生领域事件 → 经 bus 发布 → WS hub 订阅并推给该 workspace 的客户端。
 * 多实例水平扩展时,在此之上接 Redis pub/sub 把事件跨节点转发即可 (seam 已留好)。
 */

import { EventEmitter } from "node:events";
import type { MessageRow } from "../repo/types.js";

export type RealtimeEvent =
  | { readonly type: "message.created"; readonly message: MessageRow }
  | { readonly type: "reaction.updated"; readonly channelId: string; readonly messageId: string }
  | { readonly type: "action.prepared"; readonly actionId: string }
  | { readonly type: "action.updated"; readonly actionId: string }
  | { readonly type: "task.updated"; readonly taskId: string }
  | {
      readonly type: "agent.activity";
      readonly agentHandle: string;
      readonly channelId: string;
      readonly activity: string; // working|thinking|reading|sending|claiming|checking|done|error
      readonly detail: string;
      readonly seq: number;
    }
  | {
      // 机器上线/下线/信息上报 —— web 端据此刷新 Computers 列表
      readonly type: "machine.updated";
      readonly machineId: string;
      readonly status: "online" | "offline";
    };

export type EmitFn = (workspaceId: string, event: RealtimeEvent) => void;

export class RealtimeBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // 房间数可能很多,放宽监听器上限
    this.emitter.setMaxListeners(0);
  }

  emit: EmitFn = (workspaceId, event) => {
    this.emitter.emit(workspaceId, event);
  };

  /** 订阅某 workspace 的事件,返回取消订阅函数。 */
  subscribe(
    workspaceId: string,
    listener: (event: RealtimeEvent) => void,
  ): () => void {
    this.emitter.on(workspaceId, listener);
    return () => this.emitter.off(workspaceId, listener);
  }
}

/** 进程级默认总线。 */
export const defaultBus = new RealtimeBus();
