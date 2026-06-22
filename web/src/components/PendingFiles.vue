<script setup lang="ts">
/** 待发送附件预览:图片显示缩略图,其它文件显示文件名 chip。用于频道/线程输入框。
 *  object URL 在文件列表变化/卸载时回收,避免内存泄漏。 */

import { ref, watch, onUnmounted } from "vue";
import { X, Paperclip } from "lucide-vue-next";

const props = defineProps<{ files: File[]; onRemove: (index: number) => void }>();

const isImage = (f: File) => f.type.startsWith("image/");
const urls = ref<string[]>([]);
let made: string[] = [];

watch(
  () => props.files,
  (files) => {
    made.forEach((u) => u && URL.revokeObjectURL(u));
    made = files.map((f) => (isImage(f) ? URL.createObjectURL(f) : ""));
    urls.value = made;
  },
  { immediate: true },
);
onUnmounted(() => made.forEach((u) => u && URL.revokeObjectURL(u)));
</script>

<template>
  <div v-if="files.length > 0" class="pending-files" data-testid="pending-files">
    <span
      v-for="(f, i) in files"
      :key="`${f.name}-${i}`"
      :class="`pending-chip ${isImage(f) ? 'img' : ''}`"
    >
      <img v-if="isImage(f) && urls[i]" class="pending-thumb" :src="urls[i]" :alt="f.name" :title="f.name" />
      <template v-else>
        <Paperclip :size="12" /><span class="pending-name">{{ f.name }}</span>
      </template>
      <button class="pending-x" title="Remove" @click="onRemove(i)"><X :size="12" /></button>
    </span>
  </div>
</template>
