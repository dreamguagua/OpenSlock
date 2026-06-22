<script setup lang="ts">
/** 消息流里的 task 关联标签:显示 task 编号,背景色随状态变化,点击打开其 thread。 */

import { computed } from "vue";
import { Circle, CircleDot, Eye, CheckCircle2 } from "lucide-vue-next";
import type { Task, TaskStatus } from "../types.js";

const props = defineProps<{ task: Task; onOpen: () => void }>();

// 状态 → lucide 图标(进度感:空心 → 进行 → 评审 → 勾)。
const STATUS_ICON = { todo: Circle, in_progress: CircleDot, in_review: Eye, done: CheckCircle2 } as const;
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

const Icon = computed(() => STATUS_ICON[props.task.status]);
const title = computed(() => `Task #${props.task.number} · ${STATUS_LABEL[props.task.status]} — ${props.task.title}`);
</script>

<template>
  <button
    type="button"
    :class="`task-chip ${task.status}`"
    data-testid="message-task-chip"
    :title="title"
    @click="onOpen"
  >
    <component :is="Icon" :size="13" /> #{{ task.number }}
  </button>
</template>
