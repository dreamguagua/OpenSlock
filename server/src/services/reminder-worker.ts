/**
 * ReminderWorker —— 定时扫描到点提醒并触发。
 *
 * 触发 = 向 anchor 频道发一条 system 消息(@owner ⏰ <title>)+ 记 fired 事件;
 * recurring 算下次 nextFireAt,once 置 done。
 * M3c:owner 是 agent 且有 anchor 频道时,经控制面 hub 主动唤醒它(agent:start);
 * system 消息 + 未读唤醒作为 daemon 离线时的兜底。
 */

import { nextCronFire } from "../domain/reminder.js";
import type { MessageRepo, ReminderRepo, ReminderRow } from "../repo/types.js";
import type { EmitFn } from "../realtime/bus.js";
import type { DaemonHub } from "../realtime/daemon-hub.js";

export interface ReminderWorkerDeps {
  readonly reminders: ReminderRepo;
  readonly messages: MessageRepo;
  readonly emit: EmitFn;
  /** 可选:触发时经控制面唤醒 owner agent (M3c)。 */
  readonly hub?: DaemonHub;
  readonly intervalMs?: number;
  readonly batch?: number;
  readonly now?: () => Date;
}

export class ReminderWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: ReminderWorkerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.deps.intervalMs ?? 30_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 跑一轮:返回本轮触发的提醒数 (供测试断言)。 */
  async tick(): Promise<number> {
    const now = this.now();
    const due = await this.deps.reminders.dueAcrossWorkspaces(now, this.deps.batch ?? 50);
    for (const { workspaceId, reminder } of due) {
      await this.fire(workspaceId, reminder, now);
    }
    return due.length;
  }

  private async fire(workspaceId: string, r: ReminderRow, now: Date): Promise<void> {
    // 1) 发 system 消息到 anchor 频道
    if (r.anchorChannelId) {
      const msg = await this.deps.messages.append(workspaceId, {
        channelId: r.anchorChannelId,
        type: "system",
        sender: { type: "system", id: "reminder" },
        content: `⏰ Reminder @${r.owner.id}: ${r.title}`,
      });
      this.deps.emit(workspaceId, { type: "message.created", message: msg });
    }
    // 2) 记 fired 事件
    await this.deps.reminders.appendEvent(workspaceId, r.id, "fired", { firedAt: now.toISOString() });
    // 2b) M3c:若 owner 是 agent 且有 anchor 频道,经控制面主动唤醒它
    if (this.deps.hub && r.owner.type === "agent" && r.anchorChannelId) {
      // 注:reminder 暂走兜底派发 (worker 不持有 agent→machine 映射);后续可精确路由
      this.deps.hub.dispatchAny(workspaceId, {
        type: "agent:start",
        agentHandle: r.owner.id,
        channelId: r.anchorChannelId,
        reason: "reminder",
        wake: { content: `⏰ ${r.title}` },
      });
    }
    // 3) 重排:recurring → 下次;once → done
    if (r.kind === "recurring" && r.cron) {
      const next = nextCronFire(r.cron, r.timezone, now);
      await this.deps.reminders.markFired(workspaceId, r.id, next, "scheduled");
    } else {
      await this.deps.reminders.markFired(workspaceId, r.id, null, "done");
    }
  }
}
