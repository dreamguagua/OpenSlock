/**
 * 任务的状态流转与释放 (纯判定)。配合 claim.ts 的认领逻辑,构成任务生命周期。
 *
 * 规则:
 * - 改状态:人类可改任意任务(与"人类可改派 reassign"一致——人在频道里是协调者);
 *   agent 只能改自己认领的任务(防止 agent 互相覆盖)。
 * - 任意状态可互相流转,包含把 done / closed 重新打开(无终态限制)。
 * - unclaim:只有当前 assignee 能释放(别人的认领不能替他放)。
 * - unclaim 释放认领;若当时是 in_progress 则状态回退到 todo,便于干净地被重新认领。
 */

import type { Actor } from "./actor.js";
import { actorEquals } from "./actor.js";
import { TASK_STATUSES, type TaskStatus } from "./claim.js";

export interface OwnedTaskState {
  readonly assignee: Actor | null;
  readonly status: TaskStatus;
}

export function isTaskStatus(v: string): v is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(v);
}

export type StatusUpdateResult =
  | { readonly kind: "ok"; readonly status: TaskStatus }
  | { readonly kind: "forbidden" } // agent 改了不属于自己的任务
  | { readonly kind: "invalid" }; // 非法目标状态

export function decideStatusUpdate(
  task: OwnedTaskState,
  actor: Actor,
  next: string,
): StatusUpdateResult {
  if (!isTaskStatus(next)) return { kind: "invalid" };
  // 无终态:任意状态可互转(含把 done / closed 重新打开)。
  // 人类是频道协调者:可改任意任务状态(与 reassign 的"人类放行"一致)。
  if (actor.type === "human") return { kind: "ok", status: next };
  // agent 只能改自己认领的任务。
  if (!task.assignee || !actorEquals(task.assignee, actor)) {
    return { kind: "forbidden" };
  }
  return { kind: "ok", status: next };
}

export type UnclaimResult =
  | { readonly kind: "ok"; readonly status: TaskStatus }
  | { readonly kind: "not_claimed" }
  | { readonly kind: "forbidden" };

export function decideUnclaim(task: OwnedTaskState, actor: Actor): UnclaimResult {
  if (!task.assignee) return { kind: "not_claimed" };
  if (!actorEquals(task.assignee, actor)) return { kind: "forbidden" };
  // in_progress → todo,让任务干净地回到可认领状态;其它状态保持
  const status: TaskStatus = task.status === "in_progress" ? "todo" : task.status;
  return { kind: "ok", status };
}
