<script setup lang="ts">
/** "Add reaction" 触发器 + emoji 弹层。放在消息右上角操作区(Reply 图标右边)。
 *  触发器在消息顶部,默认向下弹;仅当下方空间不足(靠近视口底部)时才向上弹。 */

import { ref } from "vue";
import { SmilePlus } from "lucide-vue-next";
import type { ReactionSummary } from "../types.js";

const props = defineProps<{
  reactions: ReactionSummary[];
  onToggle: (emoji: string, mine: boolean) => void;
}>();

const PALETTE = ["👍", "❤️", "🎉", "😄", "🙏", "👀", "🚀", "✅"] as const;
// emoji 弹层(4 列 2 行)大致高度(含内边距/外边距),用于判断下方空间是否够。
const PICKER_HEIGHT = 90;

const pickerOpen = ref(false);
const dir = ref<"up" | "down">("down");
const addRef = ref<HTMLButtonElement | null>(null);
const has = (emoji: string) => props.reactions.find((r) => r.emoji === emoji);

function togglePicker() {
  if (!pickerOpen.value) {
    const rect = addRef.value?.getBoundingClientRect();
    const below = rect ? window.innerHeight - rect.bottom : Infinity;
    dir.value = below < PICKER_HEIGHT ? "up" : "down";
  }
  pickerOpen.value = !pickerOpen.value;
}

function pick(e: string) {
  pickerOpen.value = false;
  props.onToggle(e, Boolean(has(e)?.mine));
}
</script>

<template>
  <div class="reaction-add-wrap">
    <button ref="addRef" class="msg-act" data-testid="reaction-add" title="Add reaction" @click="togglePicker">
      <SmilePlus :size="14" />
    </button>
    <template v-if="pickerOpen">
      <div class="menu-backdrop" @click="pickerOpen = false" />
      <div :class="`emoji-picker ${dir}`" data-testid="emoji-picker">
        <button
          v-for="e in PALETTE"
          :key="e"
          :class="`emoji-opt ${has(e)?.mine ? 'active' : ''}`"
          @click="pick(e)"
        >
          {{ e }}
        </button>
      </div>
    </template>
  </div>
</template>
