<script setup lang="ts">
/** 消息底部(及 thread 头部)的 task 标签:状态图标 + #编号 + assignee(仿 raft)。
 *  - 点状态图标 → 弹出状态下拉(Todo/In Progress/In Review/Done),点选即改状态。
 *  - 点编号/assignee 区 → 打开该 task 的 thread。
 *  背景色随状态变化。仅当传入 onSetStatus 时才渲染可改状态的下拉(否则状态图标只读)。 */

import { computed, ref } from "vue";
import { Circle, CircleDot, Eye, CheckCircle2, Ban, Check, ChevronDown } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import type { AgentStatusInfo, AgentStatusKind, Task, TaskStatus } from "../types.js";

const props = defineProps<{
  task: Task;
  agentStatus?: Record<string, AgentStatusInfo>;
  onOpen: () => void;
  onSetStatus?: (taskId: string, status: TaskStatus) => Promise<void>;
}>();

// 状态 → lucide 图标(进度感:空心 → 进行 → 评审 → 勾)。
const STATUS_ICON = { todo: Circle, in_progress: CircleDot, in_review: Eye, done: CheckCircle2, closed: Ban } as const;
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  closed: "Closed",
};
const STATUS_ORDER: readonly TaskStatus[] = ["todo", "in_progress", "in_review", "done", "closed"];

const Icon = computed(() => STATUS_ICON[props.task.status]);
const title = computed(() => `Task #${props.task.number} · ${STATUS_LABEL[props.task.status]} — ${props.task.title}`);

// assignee 的在线状态:仅 agent 有实时状态(human 无角标),用于头像右下角的状态点。
const asgStatus = computed<AgentStatusKind | undefined>(() => {
  const a = props.task.assignee;
  if (!a || a.type !== "agent") return undefined;
  return props.agentStatus?.[a.id]?.kind;
});

// ---- 状态下拉 ----
const MENU_HEIGHT = 150; // 4 项菜单大致高度,用于判断向上/向下弹
const menuOpen = ref(false);
const busy = ref(false);
const err = ref<string | null>(null);
const dir = ref<"up" | "down">("up");
const trigRef = ref<HTMLButtonElement | null>(null);

function toggleMenu() {
  if (!props.onSetStatus) return;
  if (!menuOpen.value) {
    err.value = null;
    const rect = trigRef.value?.getBoundingClientRect();
    const below = rect ? window.innerHeight - rect.bottom : 0;
    // 下方空间够就向下弹,否则向上(消息底部的 chip 通常靠近视口下沿 → 向上)
    dir.value = below > MENU_HEIGHT ? "down" : "up";
  }
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

async function pick(status: TaskStatus) {
  if (!props.onSetStatus || status === props.task.status) {
    closeMenu();
    return;
  }
  busy.value = true;
  err.value = null;
  try {
    await props.onSetStatus(props.task.id, status);
    closeMenu();
  } catch (e) {
    err.value = e instanceof Error ? e.message : "Update failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <span :class="`task-chip ${task.status}`" data-testid="message-task-chip" :title="title">
    <!-- 状态徽标:可改时是下拉触发器,只读时是纯图标 -->
    <button
      v-if="onSetStatus"
      ref="trigRef"
      type="button"
      class="task-chip-status"
      data-testid="task-chip-status-trigger"
      :title="`Status: ${STATUS_LABEL[task.status]} — 点击修改`"
      @click.stop="toggleMenu"
    >
      <component :is="Icon" :size="13" />
      <ChevronDown :size="10" class="task-chip-caret" />
    </button>
    <component v-else :is="Icon" :size="13" />

    <!-- 编号 + assignee:点击打开 thread -->
    <button type="button" class="task-chip-body" @click="onOpen">
      <span class="task-chip-num">#{{ task.number }}</span>
      <span class="task-chip-asg" data-testid="message-task-assignee">
        <template v-if="task.assignee">
          <Avatar :type="task.assignee.type" :id="task.assignee.id" :size="16" :status="asgStatus" />
          <span class="task-chip-asg-name">{{ task.assignee.id }}</span>
        </template>
        <span v-else class="task-chip-asg-none">Unassigned</span>
      </span>
    </button>

    <!-- 状态下拉菜单 -->
    <template v-if="menuOpen">
      <div class="menu-backdrop" @click="closeMenu" />
      <div :class="`task-chip-menu ${dir}`" data-testid="task-chip-menu">
        <button
          v-for="st in STATUS_ORDER"
          :key="st"
          type="button"
          :class="`task-chip-menu-item ${st === task.status ? 'current' : ''}`"
          data-testid="task-chip-menu-item"
          :disabled="busy"
          @click="pick(st)"
        >
          <component :is="STATUS_ICON[st]" :size="14" />
          <span class="task-chip-menu-label">{{ STATUS_LABEL[st] }}</span>
          <Check v-if="st === task.status" :size="14" class="task-chip-menu-check" />
        </button>
        <div v-if="err" class="task-chip-menu-err" data-testid="task-chip-menu-err">{{ err }}</div>
      </div>
    </template>
  </span>
</template>
