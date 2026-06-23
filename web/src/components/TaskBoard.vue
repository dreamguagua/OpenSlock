<script setup lang="ts">
/** Tasks tab:看板视图(TODO / IN PROGRESS / IN REVIEW / DONE 四列)。
 *  vuedraggable 拖拽流转:把卡片拖到目标列即改状态(拖动会幂等认领后改状态)。
 *  也保留 Claim / 状态下拉 / Release 控件;点卡片标题打开其 thread。所有权由后端强制。 */

import { ref, computed, watch } from "vue";
import draggable from "vuedraggable";
import TaskCard from "./TaskCard.vue";
import TaskRowItem from "./TaskRowItem.vue";
import type { Task, TaskStatus } from "../types.js";

// 看板五列(对齐 raft):TODO / IN PROGRESS / IN REVIEW / DONE / CLOSED。
type ColKey = TaskStatus;
const COLUMNS: { key: ColKey; label: string }[] = [
  { key: "todo", label: "TODO" },
  { key: "in_progress", label: "IN PROGRESS" },
  { key: "in_review", label: "IN REVIEW" },
  { key: "done", label: "DONE" },
  { key: "closed", label: "CLOSED" },
];

const props = defineProps<{
  tasks: Task[];
  disabled: boolean;
  onCreate: (title: string) => Promise<void>;
  onClaim: (taskId: string) => Promise<void>;
  onSetStatus: (taskId: string, status: string) => Promise<void>;
  onUnclaim: (taskId: string) => Promise<void>;
  onMove: (taskId: string, status: string) => Promise<void>;
  onOpenTask: (task: Task) => void;
}>();

const creating = ref(false);
const title = ref("");
const viewMode = ref<"board" | "list">("board");
const creatorFilter = ref("");
const assigneeFilter = ref("");
const overCol = ref<string | null>(null);

// 过滤选项:从当前任务里取去重的 creator / assignee
const creators = computed(() => [...new Set(props.tasks.map((t) => t.createdBy?.id).filter((x): x is string => !!x))].sort());
const assignees = computed(() => [...new Set(props.tasks.map((t) => t.assignee?.id).filter((x): x is string => !!x))].sort());
const visible = computed(() => props.tasks.filter((t) =>
  (!creatorFilter.value || t.createdBy?.id === creatorFilter.value) &&
  (!assigneeFilter.value || (assigneeFilter.value === "__none__" ? !t.assignee : t.assignee?.id === assigneeFilter.value)),
));

// 看板四列的本地镜像(vuedraggable 需要可变列表;以后端为真相源:props 变化或拖拽失败即重建)
const board = ref<Record<ColKey, Task[]>>({ todo: [], in_progress: [], in_review: [], done: [], closed: [] });
const rebuildBoard = () => {
  const vis = visible.value;
  board.value = {
    todo: vis.filter((t) => t.status === "todo"),
    in_progress: vis.filter((t) => t.status === "in_progress"),
    in_review: vis.filter((t) => t.status === "in_review"),
    done: vis.filter((t) => t.status === "done"),
    closed: vis.filter((t) => t.status === "closed"),
  };
};
watch(visible, rebuildBoard, { immediate: true });

// List 视图:按列顺序 + 编号排序;"closed" 不在列里,排到最后。
const colIdx = (s: TaskStatus) => { const i = COLUMNS.findIndex((c) => c.key === s); return i === -1 ? COLUMNS.length : i; };
const orderedList = computed(() => [...visible.value].sort(
  (a, b) => colIdx(a.status) - colIdx(b.status) || a.number - b.number,
));

const create = async () => {
  const t = title.value.trim();
  if (!t) return;
  await props.onCreate(t);
  title.value = ""; creating.value = false;
};

// 拖拽:卡片进入新列(状态不同)即触发流转。失败则回滚本地镜像到后端真相,避免出现
// "卡片落在新列但状态没变"的错位(如之前 done 卡片停留在 in_review)。
const onColChange = async (status: ColKey, evt: { added?: { element: Task } }) => {
  const added = evt.added;
  if (!added) return;
  const task = added.element;
  if (task.status === status || !COLUMNS.some((c) => c.key === status)) return;
  try {
    await props.onMove(task.id, status);
  } catch {
    rebuildBoard(); // 回滚:把卡片放回它在后端的真实状态列
  }
};
// 拖动经过哪一列:高亮 drop-over
const onMoveEvt = (evt: { to: HTMLElement }) => {
  overCol.value = evt.to?.getAttribute("data-col") ?? null;
  return true;
};
const onEnd = () => { overCol.value = null; };
</script>

<template>
  <div class="chat" data-testid="task-board">
    <div class="task-toolbar">
      <select class="nb-btn" data-testid="filter-creator" v-model="creatorFilter">
        <option value="">Creator: all</option>
        <option v-for="c in creators" :key="c" :value="c">{{ c }}</option>
      </select>
      <select class="nb-btn" data-testid="filter-assignee" v-model="assigneeFilter">
        <option value="">Assignee: all</option>
        <option value="__none__">Unclaimed</option>
        <option v-for="a in assignees" :key="a" :value="a">{{ a }}</option>
      </select>
      <template v-if="creating">
        <input
          class="nb-btn" :style="{ fontWeight: '400', minWidth: '220px' }"
          data-testid="task-title-input" autofocus placeholder="Task title…"
          v-model="title" @keydown.enter="create"
        />
        <button class="nb-btn primary" data-testid="task-create-confirm" :disabled="!title.trim()" @click="create">Create</button>
        <button class="nb-btn" @click="creating = false; title = ''">Cancel</button>
      </template>
      <button v-else class="nb-btn primary" data-testid="new-task-btn" :disabled="disabled" @click="creating = true">+ New Task</button>
      <div class="right">
        <button :class="`nb-btn ${viewMode === 'board' ? 'yellow' : ''}`" data-testid="board-toggle" @click="viewMode = 'board'">▤ Board</button>
        <button :class="`nb-btn ${viewMode === 'list' ? 'yellow' : ''}`" data-testid="list-toggle" @click="viewMode = 'list'">≣ List</button>
      </div>
    </div>

    <div v-if="viewMode === 'board'" class="board">
      <draggable
        v-for="col in COLUMNS"
        :key="col.key"
        :list="board[col.key]"
        :group="{ name: 'tasks' }"
        item-key="id"
        handle=".tcard-top"
        tag="div"
        chosen-class="dragging"
        :class="`board-col ${overCol === col.key ? 'drop-over' : ''}`"
        :data-testid="`col-${col.key}`"
        :data-col="col.key"
        :move="onMoveEvt"
        @change="onColChange(col.key, $event)"
        @end="onEnd"
      >
        <template #header>
          <div :class="`col-pill ${col.key}`">{{ col.label }}<span>{{ board[col.key].length }}</span></div>
          <div v-if="board[col.key].length === 0" class="empty-col">Drop here</div>
        </template>
        <template #item="{ element }">
          <TaskCard
            :task="element"
            :col-label="col.label"
            :on-claim="onClaim"
            :on-set-status="onSetStatus"
            :on-unclaim="onUnclaim"
            :on-open="onOpenTask"
          />
        </template>
      </draggable>
    </div>

    <div v-else class="task-list" data-testid="task-list">
      <div class="tl-row tl-head">
        <span class="tl-id">#</span><span class="tl-title">Title</span>
        <span class="tl-status">Status</span><span class="tl-asg">Assignee</span>
        <span class="tl-creator">Creator</span><span class="tl-act">Actions</span>
      </div>
      <div v-if="orderedList.length === 0" class="empty-col" :style="{ margin: '12px' }">No tasks</div>
      <TaskRowItem
        v-for="t in orderedList"
        :key="t.id"
        :task="t"
        :on-claim="onClaim"
        :on-set-status="onSetStatus"
        :on-unclaim="onUnclaim"
        :on-open="onOpenTask"
      />
    </div>
  </div>
</template>
