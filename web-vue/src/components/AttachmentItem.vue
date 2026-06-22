<script setup lang="ts">
/** 单个附件:带 token 拉取(普通 <img src> 不行)→ object URL。
 *  图片内联预览;其它文件显示下载 chip。 */

import { ref, onMounted, onUnmounted } from "vue";
import { Paperclip, Download } from "lucide-vue-next";
import { api } from "../api.js";
import type { AttachmentMeta } from "../types.js";

const props = defineProps<{ att: AttachmentMeta }>();

const isImage = props.att.mime.startsWith("image/");
const objUrl = ref<string | null>(null);
const busy = ref(false);
let made: string | null = null;

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// 图片:进入即拉 blob 预览(带 token)。其它类型按需下载。
onMounted(() => {
  if (!isImage) return;
  api.fetchAttachment(props.att.id).then((b) => {
    made = URL.createObjectURL(b);
    objUrl.value = made;
  }).catch(() => {});
});
onUnmounted(() => { if (made) URL.revokeObjectURL(made); });

async function download() {
  busy.value = true;
  try {
    const blob = await api.fetchAttachment(props.att.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = props.att.filename; a.click();
    URL.revokeObjectURL(url);
  } finally { busy.value = false; }
}
</script>

<template>
  <a
    v-if="isImage && objUrl"
    class="att-img"
    data-testid="attachment-image"
    :href="objUrl"
    :download="att.filename"
    :title="att.filename"
  >
    <img :src="objUrl" :alt="att.filename" />
  </a>
  <button
    v-else
    class="att-chip"
    data-testid="attachment-chip"
    :disabled="busy"
    :title="`Download ${att.filename}`"
    @click="download"
  >
    <Paperclip :size="13" />
    <span class="att-name">{{ att.filename }}</span>
    <span class="att-size">{{ humanSize(att.size) }}</span>
    <Download :size="13" />
  </button>
</template>
