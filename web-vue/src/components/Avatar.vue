<script setup lang="ts">
/** 头像组件:DiceBear 生成的 SVG 套在方框里。
 *  传入 status 时,右下角叠加一个状态角标(online 🟢 / busy 🟡 / offline ⚪)。 */

import { computed } from "vue";
import { avatarDataUri } from "../avatar.js";
import type { ActorType, AgentStatusKind } from "../types.js";

const props = defineProps<{ type: ActorType; id: string; size?: number; status?: AgentStatusKind; url?: string | null }>();

const size = computed(() => props.size ?? 34);
const src = computed(() => (props.url && props.url.trim() ? props.url : avatarDataUri(props.type, props.id)));
// 角标尺寸随头像比例缩放,贴在右下角并略微外溢
const dot = computed(() => Math.max(8, Math.round(size.value * 0.3)));
const off = computed(() => -Math.round(dot.value * 0.25));
const boxStyle = computed(() => ({ width: `${size.value}px`, height: `${size.value}px`, padding: "0", overflow: "hidden" }));
</script>

<template>
  <span v-if="!status" :class="`av ${type}`" :style="boxStyle" :title="`${type}:${id}`">
    <img :src="src" :alt="id" :width="size" :height="size" :style="{ display: 'block', objectFit: 'cover' }" />
  </span>
  <span v-else class="av-wrap">
    <span :class="`av ${type}`" :style="boxStyle" :title="`${type}:${id}`">
      <img :src="src" :alt="id" :width="size" :height="size" :style="{ display: 'block', objectFit: 'cover' }" />
    </span>
    <span
      :class="`status-dot ${status}`"
      :style="{ width: `${dot}px`, height: `${dot}px`, right: `${off}px`, bottom: `${off}px` }"
      :title="status"
    />
  </span>
</template>
