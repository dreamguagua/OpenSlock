/**
 * OrphanSweeper —— 防漏兜底巡检(Phase 3)。
 *
 * 周期性扫描「无主且超时」的 todo 任务,分两级升级,杜绝任务无人接管 / 无响应:
 *   1) 超过 triageThresholdMs → 唤醒总管 Cindy 分诊(交给 WakeService.dispatchTriage)。
 *   2) 分诊后仍长时间无人认领(超过 humanThresholdMs)、或根本没有总管 → 在频道发 system 消息升级给人类。
 *
 * 每个任务的升级状态记在内存(进程级):避免每个 tick 重复打扰;进程重启后至多重升一次,可接受。
 */

import type { AgentRepo, MessageRepo, TaskRepo, TaskRow } from "../repo/types.js";
import type { RosterEntry, TriageTask } from "./wake.service.js";
import type { EmitFn } from "../realtime/bus.js";

export interface OrphanSweeperDeps {
  readonly tasks: TaskRepo;
  readonly agents: AgentRepo;
  readonly messages: MessageRepo;
  /** 分诊:把无主任务交给总管(返回是否成功派发)。 */
  readonly triage: (ws: string, roster: readonly RosterEntry[], task: TriageTask) => Promise<boolean>;
  readonly emit: EmitFn;
  /** 多久算「超时无人认领」→ 触发 Cindy 分诊。默认 2min。 */
  readonly triageThresholdMs?: number;
  /** 分诊后再等多久仍无人认领 → 升级给人类。默认 10min。 */
  readonly humanThresholdMs?: number;
  readonly intervalMs?: number;
  readonly batch?: number;
  readonly now?: () => Date;
}

interface Escalation {
  readonly firstMs: number;
  humanFlagged: boolean;
}

export class OrphanSweeper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;
  private readonly escalated = new Map<string, Escalation>();

  constructor(private readonly deps: OrphanSweeperDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 跑一轮:返回本轮产生的升级动作数(供测试断言)。 */
  async tick(): Promise<number> {
    const now = this.now();
    const nowMs = now.getTime();
    const triageThreshold = this.deps.triageThresholdMs ?? 120_000;
    const humanThreshold = this.deps.humanThresholdMs ?? 600_000;
    const olderThan = new Date(nowMs - triageThreshold);
    const orphans = await this.deps.tasks.staleOrphansAcrossWorkspaces(olderThan, this.deps.batch ?? 50);

    let acted = 0;
    for (const { workspaceId, task } of orphans) {
      const rec = this.escalated.get(task.id);
      if (!rec) {
        // 第一次发现超时无主 → 先交给总管分诊
        const roster = await this.roster(workspaceId);
        const ok = await this.deps.triage(workspaceId, roster, this.toTriageTask(task));
        if (!ok) await this.flagHuman(workspaceId, task); // 没有总管 / 派发失败 → 直接升级人类
        this.escalated.set(task.id, { firstMs: nowMs, humanFlagged: !ok });
        acted++;
      } else if (!rec.humanFlagged && nowMs - rec.firstMs >= humanThreshold) {
        // 分诊后仍长时间没人认领 → 升级给人类
        await this.flagHuman(workspaceId, task);
        rec.humanFlagged = true;
        acted++;
      }
    }
    return acted;
  }

  private async roster(ws: string): Promise<RosterEntry[]> {
    const agents = await this.deps.agents.list(ws);
    return agents.map((a) => ({ handle: a.handle, displayName: a.displayName, description: a.description }));
  }

  private toTriageTask(task: TaskRow): TriageTask {
    return {
      id: task.id,
      number: task.number,
      title: task.title,
      channelId: task.channelId,
      by: task.createdBy?.id ?? "system",
    };
  }

  private async flagHuman(ws: string, task: TaskRow): Promise<void> {
    const msg = await this.deps.messages.append(ws, {
      channelId: task.channelId,
      type: "system",
      sender: { type: "system", id: "sweeper" },
      content: `⚠️ 任务 #${task.number}「${task.title}」长时间无人认领,请指派或处理(crew task assign <taskId> --to <handle>)。`,
    });
    this.deps.emit(ws, { type: "message.created", message: msg });
  }
}
