<script setup lang="ts">
/** 工作区切换器(对标 raft 左上角面板):列出我加入的工作区 + 切换 + 新建。
 *  切换/新建都换取该工作区的 sk_user_* 令牌 → onSwitch(token) 让 App remount。 */

import { ref, onMounted } from "vue";
import { Plus, Check } from "lucide-vue-next";
import { api } from "../api.js";
import type { WorkspaceSummary } from "../types.js";

const props = defineProps<{
  currentWorkspaceId: string;
  onSwitch: (token: string) => void;
  onClose: () => void;
}>();

const list = ref<WorkspaceSummary[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const busy = ref(false);
const creating = ref(false);
const newName = ref("");

onMounted(async () => {
  try { list.value = await api.myWorkspaces(); }
  catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
});

const pick = async (ws: WorkspaceSummary) => {
  if (busy.value || ws.id === props.currentWorkspaceId) return;
  busy.value = true; error.value = null;
  try { const r = await api.switchWorkspace(ws.id); props.onSwitch(r.token); }
  catch (e) { error.value = (e as Error).message; busy.value = false; }
};

const create = async () => {
  if (busy.value || !newName.value.trim()) return;
  busy.value = true; error.value = null;
  try { const r = await api.createWorkspace(newName.value.trim()); props.onSwitch(r.token); }
  catch (e) { error.value = (e as Error).message; busy.value = false; }
};
</script>

<template>
  <div class="ws-switch-backdrop" @click="onClose" />
  <div class="ws-switch" data-testid="workspace-switcher" @click.stop>
    <div class="ws-switch-head">Workspaces</div>
    <div v-if="loading" class="ws-switch-empty">Loading…</div>
    <div v-else-if="error" class="ws-switch-empty err">{{ error }}</div>
    <template v-else>
      <button
        v-for="ws in list" :key="ws.id"
        class="ws-switch-row" :class="{ active: ws.id === currentWorkspaceId }"
        data-testid="workspace-row" :disabled="busy"
        @click="pick(ws)"
      >
        <span class="ws-switch-badge">{{ (ws.name[0] ?? '?').toUpperCase() }}</span>
        <span class="ws-switch-meta">
          <span class="ws-switch-name">{{ ws.name }}</span>
          <span class="ws-switch-sub">/{{ ws.slug }} · {{ ws.role }}</span>
        </span>
        <Check v-if="ws.id === currentWorkspaceId" :size="15" class="ws-switch-check" />
      </button>
    </template>

    <div class="ws-switch-divider" />
    <template v-if="creating">
      <input
        class="ws-switch-input" data-testid="new-workspace-name" placeholder="New workspace name"
        v-model="newName" @keydown.enter="create" autofocus
      />
      <div class="ws-switch-actions">
        <button class="nb-btn" @click="creating = false">Cancel</button>
        <button class="nb-btn primary" data-testid="create-workspace-confirm" :disabled="busy || !newName.trim()" @click="create">Create</button>
      </div>
    </template>
    <button v-else class="ws-switch-create" data-testid="create-workspace-btn" @click="creating = true">
      <Plus :size="15" /> Create or join a workspace
    </button>
  </div>
</template>

<style scoped>
.ws-switch-backdrop { position: fixed; inset: 0; z-index: 40; }
.ws-switch {
  position: fixed; top: 8px; left: 60px; z-index: 41; width: 280px;
  background: var(--surface, #fff); border: 1px solid var(--border, #e3e3e3);
  border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.18); padding: 6px;
}
.ws-switch-head { font-size: 11px; font-weight: 700; letter-spacing: .04em; color: var(--muted, #888); padding: 8px 10px 4px; text-transform: uppercase; }
.ws-switch-empty { padding: 12px 10px; color: var(--muted, #888); font-size: 13px; }
.ws-switch-empty.err { color: #c0392b; }
.ws-switch-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; background: none; border-radius: 8px; cursor: pointer; text-align: left; }
.ws-switch-row:hover { background: var(--hover, #f4f4f5); }
.ws-switch-row.active { background: var(--hover, #f1f1f3); }
.ws-switch-row:disabled { opacity: .5; cursor: default; }
.ws-switch-badge { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: #1f1f24; color: #fff; font-weight: 700; font-size: 13px; flex: none; }
.ws-switch-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ws-switch-name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ws-switch-sub { font-size: 11px; color: var(--muted, #999); }
.ws-switch-check { color: var(--accent, #2b6cff); flex: none; }
.ws-switch-divider { height: 1px; background: var(--border, #ececec); margin: 6px 4px; }
.ws-switch-create { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: 0; background: none; border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--text, #222); }
.ws-switch-create:hover { background: var(--hover, #f4f4f5); }
.ws-switch-input { width: 100%; padding: 8px 10px; border: 1px solid var(--border, #ddd); border-radius: 8px; margin: 4px 0; font-size: 13px; }
.ws-switch-actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
