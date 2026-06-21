/** Tasks tab:看板视图(TODO / IN PROGRESS / IN REVIEW / DONE 四列)。
 *  支持 @dnd-kit 拖拽流转:把卡片拖到目标列即改状态(拖动会幂等认领后改状态)。
 *  也保留 Claim / 状态下拉 / Release 控件;点卡片标题打开其 thread。所有权由后端强制。 */

import { useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCorners,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import type { Task, TaskStatus } from "../types.js";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "TODO" },
  { key: "in_progress", label: "IN PROGRESS" },
  { key: "in_review", label: "IN REVIEW" },
  { key: "done", label: "DONE" },
];
const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
];

export function TaskBoard(props: {
  tasks: Task[];
  disabled: boolean;
  onCreate: (title: string) => Promise<void>;
  onClaim: (taskId: string) => Promise<void>;
  onSetStatus: (taskId: string, status: string) => Promise<void>;
  onUnclaim: (taskId: string) => Promise<void>;
  onMove: (taskId: string, status: string) => Promise<void>;
  onOpenTask: (task: Task) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  // 5px 激活阈值:轻点用于打开 thread,拖动才触发 DnD
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // 过滤选项:从当前任务里取去重的 creator / assignee
  const creators = [...new Set(props.tasks.map((t) => t.createdBy?.id).filter((x): x is string => !!x))].sort();
  const assignees = [...new Set(props.tasks.map((t) => t.assignee?.id).filter((x): x is string => !!x))].sort();
  const visible = props.tasks.filter((t) =>
    (!creatorFilter || t.createdBy?.id === creatorFilter) &&
    (!assigneeFilter || (assigneeFilter === "__none__" ? !t.assignee : t.assignee?.id === assigneeFilter)),
  );

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    await props.onCreate(t);
    setTitle(""); setCreating(false);
  };

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const over = e.over?.id;
    if (!over) return;
    const task = props.tasks.find((t) => t.id === String(e.active.id));
    if (task && over !== task.status && COLUMNS.some((c) => c.key === over)) {
      void props.onMove(task.id, String(over));
    }
  };

  const dragTask = props.tasks.find((t) => t.id === dragId) ?? null;

  return (
    <div className="chat" data-testid="task-board">
      <div className="task-toolbar">
        <select className="nb-btn" data-testid="filter-creator" value={creatorFilter} onChange={(e) => setCreatorFilter(e.target.value)}>
          <option value="">Creator: all</option>
          {creators.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="nb-btn" data-testid="filter-assignee" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
          <option value="">Assignee: all</option>
          <option value="__none__">Unclaimed</option>
          {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        {creating ? (
          <>
            <input
              className="nb-btn" style={{ fontWeight: 400, minWidth: 220 }}
              data-testid="task-title-input" autoFocus placeholder="Task title…"
              value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
            <button className="nb-btn primary" data-testid="task-create-confirm" disabled={!title.trim()} onClick={create}>Create</button>
            <button className="nb-btn" onClick={() => { setCreating(false); setTitle(""); }}>Cancel</button>
          </>
        ) : (
          <button className="nb-btn primary" data-testid="new-task-btn" disabled={props.disabled} onClick={() => setCreating(true)}>+ New Task</button>
        )}
        <div className="right">
          <button className={`nb-btn ${viewMode === "board" ? "yellow" : ""}`} data-testid="board-toggle" onClick={() => setViewMode("board")}>▤ Board</button>
          <button className={`nb-btn ${viewMode === "list" ? "yellow" : ""}`} data-testid="list-toggle" onClick={() => setViewMode("list")}>≣ List</button>
        </div>
      </div>

      {viewMode === "board" ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="board">
            {COLUMNS.map((col) => (
              <Column key={col.key} col={col} tasks={visible.filter((t) => t.status === col.key)}
                onClaim={props.onClaim} onSetStatus={props.onSetStatus} onUnclaim={props.onUnclaim} onOpen={props.onOpenTask} />
            ))}
          </div>
          <DragOverlay>
            {dragTask ? <div className="tcard dragging"><div className="id mono">#{dragTask.number}</div><div className="ttl">{dragTask.title}</div></div> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <TaskList tasks={visible} onClaim={props.onClaim} onSetStatus={props.onSetStatus} onUnclaim={props.onUnclaim} onOpen={props.onOpenTask} />
      )}
    </div>
  );
}

function TaskList(props: {
  tasks: Task[];
  onClaim: (id: string) => Promise<void>;
  onSetStatus: (id: string, s: string) => Promise<void>;
  onUnclaim: (id: string) => Promise<void>;
  onOpen: (t: Task) => void;
}) {
  const ordered = [...props.tasks].sort((a, b) => COLUMNS.findIndex((c) => c.key === a.status) - COLUMNS.findIndex((c) => c.key === b.status) || a.number - b.number);
  return (
    <div className="task-list" data-testid="task-list">
      <div className="tl-row tl-head">
        <span className="tl-id">#</span><span className="tl-title">Title</span>
        <span className="tl-status">Status</span><span className="tl-asg">Assignee</span>
        <span className="tl-creator">Creator</span><span className="tl-act">Actions</span>
      </div>
      {ordered.length === 0 && <div className="empty-col" style={{ margin: 12 }}>No tasks</div>}
      {ordered.map((t) => <TaskRowItem key={t.id} task={t} onClaim={props.onClaim} onSetStatus={props.onSetStatus} onUnclaim={props.onUnclaim} onOpen={props.onOpen} />)}
    </div>
  );
}

function TaskRowItem(props: {
  task: Task;
  onClaim: (id: string) => Promise<void>;
  onSetStatus: (id: string, s: string) => Promise<void>;
  onUnclaim: (id: string) => Promise<void>;
  onOpen: (t: Task) => void;
}) {
  const t = props.task;
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return (
    <div className="tl-row" data-testid="task-row">
      <span className="tl-id mono">#{t.number}</span>
      <span className="tl-title tl-link" onClick={() => props.onOpen(t)} title="Open thread">{t.title}</span>
      <span className="tl-status"><span className={`col-pill ${t.status}`} style={{ margin: 0, padding: "2px 8px" }}>{t.status.replace("_", " ")}</span></span>
      <span className="tl-asg">{t.assignee ? t.assignee.id : <span className="fake">—</span>}</span>
      <span className="tl-creator">{t.createdBy ? t.createdBy.id : <span className="fake">—</span>}</span>
      <span className="tl-act">
        {!t.assignee ? (
          <button className="nb-btn primary" disabled={busy} onClick={() => run(() => props.onClaim(t.id))}>Claim</button>
        ) : (
          <>
            <select className="nb-btn" value={t.status} disabled={busy} onChange={(e) => run(() => props.onSetStatus(t.id, e.target.value))}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button className="nb-btn" disabled={busy} onClick={() => run(() => props.onUnclaim(t.id))}>Release</button>
          </>
        )}
      </span>
    </div>
  );
}

function Column(props: {
  col: { key: TaskStatus; label: string };
  tasks: Task[];
  onClaim: (id: string) => Promise<void>;
  onSetStatus: (id: string, s: string) => Promise<void>;
  onUnclaim: (id: string) => Promise<void>;
  onOpen: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.col.key });
  return (
    <div ref={setNodeRef} className={`board-col ${isOver ? "drop-over" : ""}`} data-testid={`col-${props.col.key}`}>
      <div className={`col-pill ${props.col.key}`}>{props.col.label}<span>{props.tasks.length}</span></div>
      {props.tasks.length === 0 && <div className="empty-col">Drop here</div>}
      {props.tasks.map((t) => (
        <TaskCard key={t.id} task={t} colLabel={props.col.label}
          onClaim={props.onClaim} onSetStatus={props.onSetStatus} onUnclaim={props.onUnclaim} onOpen={props.onOpen} />
      ))}
    </div>
  );
}

function TaskCard(props: {
  task: Task;
  colLabel: string;
  onClaim: (taskId: string) => Promise<void>;
  onSetStatus: (taskId: string, status: string) => Promise<void>;
  onUnclaim: (taskId: string) => Promise<void>;
  onOpen: (task: Task) => void;
}) {
  const t = props.task;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: t.id });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div ref={setNodeRef} className="tcard" data-testid="task-item" style={isDragging ? { opacity: 0.4 } : undefined}>
      {/* 拖拽手柄 = 卡片头部;轻点打开 thread(<5px),拖动触发 DnD */}
      <div className="tcard-top" data-testid="task-card-handle" {...listeners} {...attributes}
        onClick={() => props.onOpen(t)} title="Drag to a column, or click to open thread" style={{ cursor: "grab" }}>
        <div className="id mono">#{t.number}</div>
        <div className="ttl">{t.title}</div>
      </div>
      <div className="foot">
        <span className="asg">{t.assignee ? `→ ${t.assignee.id}` : "Unclaimed"}</span>
        <span className={`col-pill ${t.status}`} style={{ margin: 0, padding: "2px 8px" }}>{props.colLabel}</span>
      </div>
      <div className="tcard-actions">
        {!t.assignee ? (
          <button className="nb-btn primary" data-testid="task-claim" disabled={busy} onClick={() => run(() => props.onClaim(t.id))}>Claim</button>
        ) : (
          <>
            <select
              className="nb-btn" data-testid="task-status" value={t.status} disabled={busy}
              onChange={(e) => run(() => props.onSetStatus(t.id, e.target.value))}
            >
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button className="nb-btn" data-testid="task-unclaim" disabled={busy} onClick={() => run(() => props.onUnclaim(t.id))}>Release</button>
          </>
        )}
      </div>
      {error && <div className="tcard-err" data-testid="task-error">{error}</div>}
    </div>
  );
}
