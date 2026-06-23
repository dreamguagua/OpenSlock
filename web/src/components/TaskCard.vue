<script setup lang="ts">
/** 看板卡片:拖拽手柄 = 卡片头部(轻点打开 thread,拖动改状态);下方 Claim/状态/Release。 */

import { ref } from "vue";
import type { Task } from "../types.js";

const STATUSES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
  { value: "closed", label: "Closed" },
];

const props = defineProps<{
  task: Task;
  colLabel: string;
  onClaim: (taskId: string) => Promise<void>;
  onSetStatus: (taskId: string, status: string) => Promise<void>;
  onUnclaim: (taskId: string) => Promise<void>;
  onOpen: (task: Task) => void;
}>();

const busy = ref(false);
const error = ref<string | null>(null);
const run = async (fn: () => Promise<void>) => {
  busy.value = true; error.value = null;
  try { await fn(); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
};
const onStatusChange = (e: Event) => { const v = (e.target as HTMLSelectElement).value; void run(() => props.onSetStatus(props.task.id, v)); };
</script>

<template>
  <div class="tcard" data-testid="task-item">
    <div class="tcard-top" data-testid="task-card-handle" title="Drag to a column, or click to open thread" :style="{ cursor: 'grab' }" @click="onOpen(task)">
      <div class="id mono">#{{ task.number }}</div>
      <div class="ttl">{{ task.title }}</div>
    </div>
    <div class="foot">
      <span class="asg">{{ task.assignee ? `→ ${task.assignee.id}` : "Unclaimed" }}</span>
      <span :class="`col-pill ${task.status}`" :style="{ margin: '0', padding: '2px 8px' }">{{ colLabel }}</span>
    </div>
    <div class="tcard-actions">
      <button v-if="!task.assignee" class="nb-btn primary" data-testid="task-claim" :disabled="busy" @click="run(() => onClaim(task.id))">Claim</button>
      <template v-else>
        <select class="nb-btn" data-testid="task-status" :value="task.status" :disabled="busy" @change="onStatusChange">
          <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <button class="nb-btn" data-testid="task-unclaim" :disabled="busy" @click="run(() => onUnclaim(task.id))">Release</button>
      </template>
    </div>
    <div v-if="error" class="tcard-err" data-testid="task-error">{{ error }}</div>
  </div>
</template>
