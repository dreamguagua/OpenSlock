/**
 * work-log 生命周期收尾:任务被改为 done/closed 时,程序触发其 assignee agent 做一次
 * "prune" —— 把可复用经验提炼进 notes/lessons.md、清空本任务 work-log,防止上下文膨胀。
 * 经 wake 投递到该任务线程(threadParentId=task.messageId),daemon 会在该任务隔离目录里运行。
 * best-effort:不阻塞、不影响状态更新本身。
 */

import type { AppServices } from "./services-context.js";
import type { TaskRow } from "../repo/types.js";

const PRUNE_STATUSES = new Set(["done", "closed"]);

export function maybePruneWorklog(svc: AppServices, ws: string, task: TaskRow): void {
  if (!PRUNE_STATUSES.has(task.status)) return;
  if (task.assignee?.type !== "agent") return; // 只有 agent 有 work-log
  const content =
    `task #${task.number}「${task.title}」已置为 ${task.status}。请做收尾(prune,无需在频道发言):` +
    `把本任务 work-log(\`$CREW_TASK_LOG\`)里可复用的经验/教训提炼进 \`$CREW_HOME/notes/lessons.md\`` +
    `(并在 MEMORY.md 索引补一行指向它),然后清空本任务 work-log;若无可留存内容则直接清空。完成即停。`;
  void svc.wake
    .wakeAgent(ws, task.assignee.id, task.channelId, content, "system", task.messageId)
    .catch(() => {});
}
