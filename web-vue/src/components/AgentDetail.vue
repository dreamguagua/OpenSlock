<script setup lang="ts">
/** Agent detail (主面板):头部 + Profile / Workspace / Activity 页签。
 *  Profile 可编辑(显示名/描述/runtime/model/computer)且可删除。 */

import { ref, computed, watch } from "vue";
import { IdCard, FolderOpen, Activity as ActivityIcon, MessageSquare, Pencil } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import AgentProfileTab from "./AgentProfileTab.vue";
import AgentProfileEdit from "./AgentProfileEdit.vue";
import AgentActivityTab from "./AgentActivityTab.vue";
import WorkspaceTab from "./WorkspaceView.vue";
import { api } from "../api.js";
import type { AgentPatch, AgentProfile, AgentActivity, AgentStatusInfo, Machine } from "../types.js";

type DetailTab = "profile" | "workspace" | "activity";

const props = defineProps<{
  handle: string;
  machines: Machine[];
  activity?: AgentActivity;
  status?: AgentStatusInfo;
  onSave: (handle: string, patch: AgentPatch) => Promise<AgentProfile>;
  onDelete: (handle: string) => Promise<void>;
  onDeleted: () => void;
  onMessage: (handle: string) => void;
}>();

const agent = ref<AgentProfile | null>(null);
const error = ref<string | null>(null);
const tab = ref<DetailTab>("profile");
const editing = ref(false);

watch(() => props.handle, (h) => {
  agent.value = null; error.value = null; tab.value = "profile"; editing.value = false;
  api.agent(h).then((a) => { agent.value = a; }).catch((e) => { error.value = (e as Error).message; });
}, { immediate: true });

const statusInfo = computed<AgentStatusInfo>(() => props.status ?? { kind: "offline", label: "Offline" });

const goProfile = () => { tab.value = "profile"; };
const goWorkspace = () => { tab.value = "workspace"; editing.value = false; };
const goActivity = () => { tab.value = "activity"; editing.value = false; };
const cancelEdit = () => { editing.value = false; };

const doSave = async (patch: AgentPatch) => {
  if (!agent.value) return;
  const next = await props.onSave(agent.value.handle, patch);
  agent.value = next; editing.value = false;
};
const doDelete = async () => {
  if (!agent.value) return;
  await props.onDelete(agent.value.handle);
  props.onDeleted();
};
</script>

<template>
  <div v-if="error" class="error-banner" data-testid="agent-detail-error">{{ error }}</div>
  <div v-else-if="!agent" class="empty">Loading agent…</div>
  <div v-else class="agent-detail" data-testid="agent-detail">
    <div class="ch-head">
      <Avatar type="agent" :id="agent.handle" :size="34" :status="statusInfo.kind" :url="agent.avatarUrl" />
      <div class="head-meta">
        <div class="nm">{{ agent.displayName }}</div>
        <div class="desc"><template v-if="agent.description">{{ agent.description }}</template><span v-else class="fake">No description</span></div>
      </div>
      <div class="right">
        <button class="nb-btn" data-testid="agent-message" title="Open DM" @click="onMessage(agent.handle)">
          <MessageSquare :size="14" /> Message
        </button>
        <button v-if="tab === 'profile' && !editing" class="nb-btn" data-testid="agent-edit" @click="editing = true">
          <Pencil :size="14" /> Edit
        </button>
      </div>
    </div>

    <div class="tabs">
      <div :class="`tab ${tab === 'profile' ? 'active' : ''}`" data-testid="agent-tab-profile" @click="goProfile">
        <span class="ti"><IdCard :size="14" /></span> Profile
      </div>
      <div :class="`tab ${tab === 'workspace' ? 'active' : ''}`" data-testid="agent-tab-workspace" @click="goWorkspace">
        <span class="ti"><FolderOpen :size="14" /></span> Workspace
      </div>
      <div :class="`tab ${tab === 'activity' ? 'active' : ''}`" data-testid="agent-tab-activity" @click="goActivity">
        <span class="ti"><ActivityIcon :size="14" /></span> Activity
      </div>
    </div>

    <div class="agent-pane">
      <template v-if="tab === 'profile'">
        <AgentProfileEdit
          v-if="editing"
          :agent="agent" :machines="machines"
          :onCancel="cancelEdit"
          :onSave="doSave"
          :onDelete="doDelete"
        />
        <AgentProfileTab v-else :agent="agent" :status="statusInfo" :machines="machines" />
      </template>
      <WorkspaceTab v-if="tab === 'workspace'" :handle="agent.handle" />
      <AgentActivityTab v-if="tab === 'activity'" :handle="agent.handle" :activity="activity" />
    </div>
  </div>
</template>
