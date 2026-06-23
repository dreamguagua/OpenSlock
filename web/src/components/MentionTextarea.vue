<script setup lang="ts">
/** 带 @mention 自动补全的 textarea(复用于主输入框与线程输入框)。
 *  打 @ 后弹出本频道 agent/human 列表:↑↓ 选择、Enter/Tab 确认、Esc 关闭、鼠标点选;
 *  菜单关闭时 Enter 走正常发送(emit onEnter)。仅做交互,数据与发送逻辑由父组件提供。 */

import { ref, computed, nextTick, watch, onMounted } from "vue";
import type { Member } from "../types.js";
import Avatar from "./Avatar.vue";
import { applyMention, filterMembers, findMentionQuery, type MentionQuery } from "../mentions.js";

const MAX_ITEMS = 8;

const props = defineProps<{
  modelValue: string;
  members: Member[];
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
  (e: "enter"): void;
  (e: "paste", ev: ClipboardEvent): void;
}>();

const el = ref<HTMLTextAreaElement | null>(null);
const menu = ref<MentionQuery | null>(null);
const active = ref(0);

const matches = computed(() =>
  menu.value ? filterMembers(props.members, menu.value.query).slice(0, MAX_ITEMS) : [],
);
const open = computed(() => menu.value !== null && matches.value.length > 0);

// 依据 textarea 当前内容与光标重算菜单状态。
// 关键:仅当补全词(start+query)变化时才把高亮重置回第一项;否则方向键的 keyup 也会触发 sync,
// 会把刚用 ↑↓ 选中的项弹回第一个(alice #65 的「切换完又蹦回第一个」)。
const sync = (ta: HTMLTextAreaElement) => {
  const next = findMentionQuery(ta.value, ta.selectionStart ?? ta.value.length);
  const sameToken =
    next !== null && menu.value !== null && next.start === menu.value.start && next.query === menu.value.query;
  menu.value = next;
  if (!sameToken) active.value = 0;
};

const choose = (m: Member) => {
  if (!menu.value) return;
  const ta = el.value;
  const cursor = ta?.selectionStart ?? props.modelValue.length;
  const { text, cursor: next } = applyMention(props.modelValue, menu.value.start, cursor, m.handle);
  emit("update:modelValue", text);
  menu.value = null;
  // 等 Vue 应用新 value 后,把光标移到插入串之后
  nextTick(() => {
    if (ta) { ta.focus(); ta.setSelectionRange(next, next); }
  });
};

// 随内容自动增高:先归零再按 scrollHeight 撑开,超过 CSS max-height 后由 overflow 滚动接管。
// 默认两行高度交给 CSS 的 min-height,这里只负责"内容多了往上长"。
const autoGrow = () => {
  const ta = el.value;
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
};

const onInput = (ev: Event) => {
  const ta = ev.target as HTMLTextAreaElement;
  emit("update:modelValue", ta.value);
  sync(ta);
  autoGrow();
};

// 外部清空/回填(如发送后重置)时也要重算高度,缩回默认两行。
watch(() => props.modelValue, () => nextTick(autoGrow));
onMounted(autoGrow);

const onKeydown = (e: KeyboardEvent) => {
  if (open.value) {
    if (e.key === "ArrowDown") { e.preventDefault(); active.value = (active.value + 1) % matches.value.length; return; }
    if (e.key === "ArrowUp") { e.preventDefault(); active.value = (active.value - 1 + matches.value.length) % matches.value.length; return; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const m = matches.value[active.value]; if (m) choose(m); return; }
    if (e.key === "Escape") { e.preventDefault(); menu.value = null; return; }
  }
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); emit("enter"); }
};

// mousedown + preventDefault:点击不让 textarea 失焦,确保插入后光标可恢复
const onItemMouseDown = (e: MouseEvent, m: Member) => { e.preventDefault(); choose(m); };
</script>

<template>
  <div class="mention-wrap">
    <div v-if="open" class="mention-menu" data-testid="mention-menu">
      <button
        v-for="(m, i) in matches"
        :key="`${m.kind}:${m.handle}`"
        type="button"
        :class="`mention-item ${i === active ? 'active' : ''}`"
        data-testid="mention-item"
        @mousedown="onItemMouseDown($event, m)"
        @mouseenter="active = i"
      >
        <Avatar :type="m.kind" :id="m.handle" :size="20" :url="m.avatarUrl" />
        <span class="mention-handle">@{{ m.handle }}</span>
        <span v-if="m.displayName && m.displayName !== m.handle" class="mention-name">{{ m.displayName }}</span>
        <span :class="`mention-kind ${m.kind}`">{{ m.kind }}</span>
      </button>
    </div>
    <textarea
      ref="el"
      :data-testid="testId"
      :placeholder="placeholder"
      :value="modelValue"
      :disabled="disabled"
      @input="onInput"
      @keyup="sync($event.target as HTMLTextAreaElement)"
      @click="sync($event.target as HTMLTextAreaElement)"
      @blur="menu = null"
      @paste="emit('paste', $event)"
      @keydown="onKeydown"
    />
  </div>
</template>
