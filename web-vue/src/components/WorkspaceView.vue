<script setup lang="ts">
/** Agent workspace tab:真实文件树(daemon 经控制面提供)+ 只读文件查看器。
 *  文件夹展开时懒加载子项。路径在服务端被限制在 agent 沙箱内。 */

import { ref, watch } from "vue";
import { FolderClosed, FileText, RefreshCw, Copy } from "lucide-vue-next";
import { api } from "../api.js";
import TreeLevel from "./TreeLevel.vue";
import type { FsEntry, FsFile } from "../types.js";

const props = defineProps<{ handle: string }>();

const root = ref<string | null>(null);
const error = ref<string | null>(null);
const children = ref<Record<string, FsEntry[]>>({});
const expanded = ref<Set<string>>(new Set());
const selected = ref<string | null>(null);
const file = ref<FsFile | null>(null);
const fileErr = ref<string | null>(null);

async function loadDir(path: string) {
  const res = await api.agentFiles(props.handle, path);
  children.value = { ...children.value, [path]: res.entries };
  return res;
}

function reload() {
  expanded.value = new Set(); selected.value = null; file.value = null; error.value = null;
  api.agentFiles(props.handle, "")
    .then((res) => { root.value = res.root; children.value = { "": res.entries }; })
    .catch((e) => { children.value = {}; error.value = (e as Error).message; });
}
watch(() => props.handle, () => { root.value = null; reload(); }, { immediate: true });

const toggle = async (path: string) => {
  const next = new Set(expanded.value);
  if (next.has(path)) { next.delete(path); expanded.value = next; return; }
  next.add(path); expanded.value = next;
  if (!children.value[path]) { try { await loadDir(path); } catch { /* leave collapsed-empty */ } }
};

const openFile = async (path: string) => {
  selected.value = path; file.value = null; fileErr.value = null;
  try { file.value = await api.agentFile(props.handle, path); }
  catch (e) { fileErr.value = (e as Error).message; }
};

const copyFile = () => { if (file.value) void navigator.clipboard?.writeText(file.value.content).catch(() => {}); };
</script>

<template>
  <div v-if="error" class="workspace" data-testid="agent-workspace">
    <div class="ws-empty"><FolderClosed :size="28" /><div>{{ error }}</div>
      <div class="fake">Workspace files are read from the agent's computer via its daemon.</div>
    </div>
  </div>
  <div v-else class="workspace ws-split" data-testid="agent-workspace">
    <div class="ws-tree-pane">
      <div class="ws-pathbar">
        <code>{{ root ?? "loading…" }}</code>
        <button class="nb-btn" title="Refresh" data-testid="ws-refresh" @click="reload"><RefreshCw :size="13" /></button>
      </div>
      <div class="ws-tree" data-testid="ws-tree">
        <TreeLevel
          path=""
          :entries="children[''] ?? null"
          :depth="0"
          :expanded="expanded"
          :children="children"
          :selected="selected"
          :onToggle="toggle"
          :onOpen="openFile"
        />
      </div>
    </div>
    <div class="ws-viewer" data-testid="ws-viewer">
      <div v-if="!selected" class="ws-empty"><FileText :size="26" /><div>Select a file to view</div></div>
      <div v-if="selected && fileErr" class="ws-empty"><FileText :size="26" /><div>{{ fileErr }}</div></div>
      <template v-if="selected && file">
        <div class="ws-file-head"><code>{{ file.path }}</code>
          <span class="grow" />
          <span class="fake">{{ file.size }} bytes{{ file.truncated ? " · truncated" : "" }}</span>
          <button class="nb-btn" title="Copy" @click="copyFile"><Copy :size="13" /></button>
        </div>
        <pre class="ws-file-body" data-testid="ws-file-content">{{ file.content }}</pre>
      </template>
    </div>
  </div>
</template>
