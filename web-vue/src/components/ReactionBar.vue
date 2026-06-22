<script setup lang="ts">
/** 消息下方的反应 pill 列表(只展示已有反应)。点已有 pill 切换自己的反应。 */

import type { ReactionSummary } from "../types.js";

defineProps<{
  reactions: ReactionSummary[];
  onToggle: (emoji: string, mine: boolean) => void;
}>();
</script>

<template>
  <div v-if="reactions.length > 0" class="reactions" data-testid="reactions">
    <button
      v-for="r in reactions"
      :key="r.emoji"
      :class="`reaction-pill ${r.mine ? 'mine' : ''}`"
      data-testid="reaction-pill"
      :title="r.mine ? 'Click to remove your reaction' : 'Click to react'"
      @click="onToggle(r.emoji, r.mine)"
    >
      <span class="re">{{ r.emoji }}</span>
      <span class="rc">{{ r.count }}</span>
    </button>
  </div>
</template>
