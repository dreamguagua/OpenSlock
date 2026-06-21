/** 消息流里的 task 关联标签:显示 task 编号,背景色随状态变化,点击打开其 thread。
 *  关联到 task 的消息下方挂一个彩色 chip(✓ #3 绿 / ○ #4 待办 等)。 */

import { Circle, CircleDot, Eye, CheckCircle2 } from "lucide-react";
import type { Task, TaskStatus } from "../types.js";

/** 状态 → lucide 图标(进度感:空心 → 进行 → 评审 → 勾)。 */
const STATUS_ICON: Record<TaskStatus, typeof Circle> = {
  todo: Circle,
  in_progress: CircleDot,
  in_review: Eye,
  done: CheckCircle2,
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

export function TaskChip(props: { task: Task; onOpen: () => void }) {
  const t = props.task;
  const Icon = STATUS_ICON[t.status];
  return (
    <button
      type="button"
      className={`task-chip ${t.status}`}
      data-testid="message-task-chip"
      title={`Task #${t.number} · ${STATUS_LABEL[t.status]} — ${t.title}`}
      onClick={props.onOpen}
    >
      <Icon size={13} /> #{t.number}
    </button>
  );
}
