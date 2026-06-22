<script setup lang="ts">
/** Files tab:当前频道内所有附件。下载带 token。 */

import { ref, watch } from "vue";
import { Paperclip, Download, FileText, Image as ImageIcon, RefreshCw } from "lucide-vue-next";
import { api } from "../api.js";
import type { ChannelFile } from "../types.js";

const props = defineProps<{ channelId: string }>();

const items = ref<ChannelFile[] | null>(null);
const error = ref<string | null>(null);

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function iconFor(mime: string) {
  return mime.startsWith("image/") ? ImageIcon : mime.startsWith("text/") ? FileText : Paperclip;
}

function load() {
  error.value = null;
  api.channelFiles(props.channelId).then((v) => { items.value = v; }).catch((e) => { error.value = (e as Error).message; });
}
watch(() => props.channelId, load, { immediate: true });

async function download(f: ChannelFile) {
  const blob = await api.fetchAttachment(f.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = f.filename; a.click();
  URL.revokeObjectURL(url);
}
const when = (s: string) => new Date(s).toLocaleString("en-US");
</script>

<template>
  <div class="files-view" data-testid="files-view">
    <div class="act-toolbar" :style="{ padding: '8px 16px' }">
      <span class="profile-sect" :style="{ margin: '0' }">FILES</span>
      <span class="grow" />
      <button class="nb-btn" data-testid="files-refresh" @click="load"><RefreshCw :size="13" /></button>
    </div>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <div v-if="items === null && !error" class="placeholder"><div class="fake">Loading…</div></div>
    <div v-if="items?.length === 0" class="placeholder"><div class="big">No files</div><div class="fake">Attachments shared in this channel show up here.</div></div>
    <div class="files-list">
      <div v-for="f in (items ?? [])" :key="f.id" class="file-row" data-testid="file-row">
        <span class="file-ic"><component :is="iconFor(f.mime)" :size="18" /></span>
        <div class="file-main">
          <div class="file-name">{{ f.filename }}</div>
          <div class="file-meta">{{ humanSize(f.size) }} · {{ f.uploader.id }} · {{ when(f.createdAt) }}</div>
        </div>
        <button class="nb-btn" data-testid="file-download" title="Download" @click="download(f)"><Download :size="14" /></button>
      </div>
    </div>
  </div>
</template>
