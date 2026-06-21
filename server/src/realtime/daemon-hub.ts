/**
 * 控制面 hub —— 跟踪已连接的 daemon,把唤醒指令派发给某台机器的 daemon。
 *
 * 每台 machine 用自己的 sk_machine_* 连入,连接按 (workspaceId, machineId) 索引。
 * 精确路由:dispatchToMachine 只发给 agent 所属那台在线机器(多机器场景正确)。
 * 兜底:dispatchAny 仍可向 workspace 内任一在线 daemon 轮询(如 reminder 无指定机器)。
 * 无在线 daemon 时返回 false(唤醒落空,记日志)。
 */

export interface AgentStartMessage {
  readonly type: "agent:start";
  readonly agentHandle: string;
  readonly channelId: string;
  readonly reason: "mention" | "reminder" | "triage" | "channel";
  readonly wake?: {
    readonly seq?: number;
    readonly senderHandle?: string;
    readonly content?: string;
    readonly threadId?: string; // 触发消息所在线程的父消息 id;有则要求 agent 在该线程内回复
  };
}

/**
 * 服务端→daemon 的工作区/技能/导入请求 (带 reqId 关联响应)。
 * raft:inspect 读 raft 工作区元信息(path=源路径);raft:import 复制用户内容(handle=目标 handle,path=源路径)。
 */
export interface FsRequestMessage {
  readonly type: "fs:list" | "fs:read" | "skills:list" | "raft:inspect" | "raft:import";
  readonly reqId: string;
  readonly handle: string;
  readonly path: string;
}

export type ControlMessage = AgentStartMessage | FsRequestMessage;

/** daemon→服务端的 fs 响应。 */
export interface FsResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

type Send = (msg: ControlMessage) => void;

const REQUEST_TIMEOUT_MS = 10_000;

interface Conn {
  readonly id: string;
  readonly machineId: string;
  readonly send: Send;
}

export class DaemonHub {
  private byWorkspace = new Map<string, Conn[]>();
  private rr = new Map<string, number>(); // round-robin 游标
  private pending = new Map<string, { resolve: (r: FsResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private reqSeq = 0;

  /** 注册一个 daemon 连接 (绑定其 machineId),返回注销函数。 */
  register(workspaceId: string, connId: string, machineId: string, send: Send): () => void {
    const list = this.byWorkspace.get(workspaceId) ?? [];
    const conn: Conn = { id: connId, machineId, send };
    this.byWorkspace.set(workspaceId, [...list, conn]);
    return () => {
      const cur = this.byWorkspace.get(workspaceId) ?? [];
      const next = cur.filter((c) => c.id !== connId);
      if (next.length) this.byWorkspace.set(workspaceId, next);
      else this.byWorkspace.delete(workspaceId);
    };
  }

  count(workspaceId: string): number {
    return this.byWorkspace.get(workspaceId)?.length ?? 0;
  }

  /** 某台机器当前是否在线 (有活动控制面连接)。 */
  isMachineOnline(workspaceId: string, machineId: string): boolean {
    return (this.byWorkspace.get(workspaceId) ?? []).some((c) => c.machineId === machineId);
  }

  /** 精确派发:发给该 workspace 内指定 machine 的(任一)连接。返回是否送达。 */
  dispatchToMachine(workspaceId: string, machineId: string, msg: ControlMessage): boolean {
    const conns = (this.byWorkspace.get(workspaceId) ?? []).filter((c) => c.machineId === machineId);
    if (conns.length === 0) return false;
    conns[0]!.send(msg);
    return true;
  }

  /** 兜底派发:发给该 workspace 任一在线 daemon (轮询)。返回是否送达。 */
  dispatchAny(workspaceId: string, msg: ControlMessage): boolean {
    const list = this.byWorkspace.get(workspaceId);
    if (!list || list.length === 0) return false;
    const i = (this.rr.get(workspaceId) ?? 0) % list.length;
    this.rr.set(workspaceId, i + 1);
    list[i]!.send(msg);
    return true;
  }

  /**
   * 向指定机器发请求并等其 fs:result (按 reqId 关联)。机器离线抛错;超时抛错。
   * 供 workspace 文件浏览用。
   */
  request(
    workspaceId: string,
    machineId: string,
    req: Omit<FsRequestMessage, "reqId">,
  ): Promise<FsResult> {
    const reqId = `req-${(this.reqSeq += 1)}`;
    const conns = (this.byWorkspace.get(workspaceId) ?? []).filter((c) => c.machineId === machineId);
    if (conns.length === 0) return Promise.reject(new Error("machine offline"));
    return new Promise<FsResult>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error("daemon request timed out"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(reqId, { resolve: resolvePromise, timer });
      conns[0]!.send({ ...req, reqId });
    });
  }

  /** 控制面收到 daemon 的 fs:result 时调用,唤醒等待的 request。 */
  resolveRequest(reqId: string, result: FsResult): void {
    const p = this.pending.get(reqId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(reqId);
    p.resolve(result);
  }
}

export const defaultDaemonHub = new DaemonHub();
