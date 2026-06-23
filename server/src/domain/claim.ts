/**
 * claim-before-work 协议的纯判定逻辑。
 *
 * 任何"回复之外的动作"前,agent 必须先 claim 对应任务;claim 失败 (已被占) 就停手、
 * 不抢、转做别的。这是多 agent 防重复领活的核心。
 *
 * 真实的原子抢占由 DB 完成 (条件 `UPDATE ... WHERE assignee IS NULL` + 部分唯一
 * 索引,见 repo/pg)。本函数描述"给定任务当前状态,某 actor 的 claim 应得到什么结果",
 * 既供内存 repo 实现使用,也供 service 解释 DB 返回。
 */

import type { Actor } from "./actor.js";
import { actorEquals } from "./actor.js";

export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "closed",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskState {
  readonly assignee: Actor | null;
  readonly status: TaskStatus;
  /** 任务锚定的消息是否为 system 消息 —— system 消息不可成任务/被 claim。 */
  readonly anchoredOnSystemMessage: boolean;
}

export type ClaimResult =
  | { readonly kind: "claimed"; readonly assignee: Actor; readonly status: TaskStatus }
  | { readonly kind: "already_mine" }
  | { readonly kind: "conflict"; readonly heldBy: Actor }
  | { readonly kind: "not_claimable" };

export function decideClaim(task: TaskState, claimant: Actor): ClaimResult {
  if (task.anchoredOnSystemMessage) {
    return { kind: "not_claimable" };
  }
  if (task.assignee === null) {
    // todo → in_progress;若已是更靠后的状态则保持。
    const status: TaskStatus = task.status === "todo" ? "in_progress" : task.status;
    return { kind: "claimed", assignee: claimant, status };
  }
  if (actorEquals(task.assignee, claimant)) {
    return { kind: "already_mine" };
  }
  return { kind: "conflict", heldBy: task.assignee };
}
