<script setup lang="ts">
/** List 视图的一行任务。 */

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
  onClaim: (id: string) => Promise<void>;
  onSetStatus: (id: string, s: string) => Promise<void>;
  onUnclaim: (id: string) => Promise<void>;
  onOpen: (t: Task) => void;
}>();

const busy = ref(false);
const run = async (fn: () => Promise<void>) => { busy.value = true; try { await fn(); } finally { busy.value = false; } };
const onStatusChange = (e: Event) => { const v = (e.target as HTMLSelectElement).value; void run(() => props.onSetStatus(props.task.id, v)); };
</script>

<template>
  <div class="tl-row" data-testid="task-row">
    <span class="tl-id mono">#{{ task.number }}</span>
    <span class="tl-title tl-link" title="Open thread" @click="onOpen(task)">{{ task.title }}</span>
    <span class="tl-status"><span :class="`col-pill ${task.status}`" :style="{ margin: '0', padding: '2px 8px' }">{{ task.status.replace("_", " ") }}</span></span>
    <span class="tl-asg"><template v-if="task.assignee">{{ task.assignee.id }}</template><span v-else class="fake">—</span></span>
    <span class="tl-creator"><template v-if="task.createdBy">{{ task.createdBy.id }}</template><span v-else class="fake">—</span></span>
    <span class="tl-act">
      <button v-if="!task.assignee" class="nb-btn primary" :disabled="busy" @click="run(() => onClaim(task.id))">Claim</button>
      <template v-else>
        <select class="nb-btn" :value="task.status" :disabled="busy" @change="onStatusChange">
          <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <button class="nb-btn" :disabled="busy" @click="run(() => onUnclaim(task.id))">Release</button>
      </template>
    </span>
  </div>
</template>
