<script setup lang="ts">
/** 文件树的一层(递归自引用)。原 WorkspaceView.tsx 内部的 TreeLevel。 */

import { computed } from "vue";
import { FolderClosed, FolderOpen, FileText, ChevronRight, ChevronDown } from "lucide-vue-next";
import type { FsEntry } from "../types.js";

const props = defineProps<{
  path: string;
  entries: FsEntry[] | null;
  depth: number;
  expanded: Set<string>;
  children: Record<string, FsEntry[]>;
  selected: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}>();

const fullPath = (e: FsEntry) => (props.path ? `${props.path}/${e.name}` : e.name);
const padStyle = computed(() => ({ paddingLeft: `${8 + props.depth * 16}px` }));
</script>

<template>
  <template v-if="entries === null">
    <div v-if="depth === 0" class="fake" :style="{ padding: '8px' }">loading…</div>
  </template>
  <template v-else-if="entries.length === 0">
    <div v-if="depth === 0" class="fake" :style="{ padding: '8px' }">Empty workspace</div>
  </template>
  <template v-else>
    <template v-for="e in entries" :key="fullPath(e)">
      <div v-if="e.type === 'dir'">
        <div class="ws-row" data-testid="ws-dir" :style="padStyle" @click="onToggle(fullPath(e))">
          <ChevronDown v-if="expanded.has(fullPath(e))" :size="13" /><ChevronRight v-else :size="13" />
          <FolderOpen v-if="expanded.has(fullPath(e))" :size="15" /><FolderClosed v-else :size="15" />
          <span class="ws-name">{{ e.name }}</span>
        </div>
        <TreeLevel
          v-if="expanded.has(fullPath(e))"
          :path="fullPath(e)"
          :entries="children[fullPath(e)] ?? null"
          :depth="depth + 1"
          :expanded="expanded"
          :children="children"
          :selected="selected"
          :onToggle="onToggle"
          :onOpen="onOpen"
        />
      </div>
      <div
        v-else
        :class="`ws-row file ${selected === fullPath(e) ? 'active' : ''}`"
        data-testid="ws-file"
        :style="padStyle"
        @click="onOpen(fullPath(e))"
      >
        <span :style="{ width: '13px' }" />
        <FileText :size="15" />
        <span class="ws-name">{{ e.name }}</span>
      </div>
    </template>
  </template>
</template>
