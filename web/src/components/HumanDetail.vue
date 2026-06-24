<script setup lang="ts">
/** Human 详情(主面板,与 AgentDetail 同构):hero + DESCRIPTION + INFO + CREATED AGENTS + ACTIONS。
 *  owner/admin 可改角色 / 移除成员;对自己隐藏管理操作。 */

import { ref, computed, watch } from "vue";
import { MessageSquare } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import { api } from "../api.js";
import type { HumanDetail, WorkspaceRole } from "../types.js";

const props = defineProps<{
  handle: string;
  canManage: boolean;
  isSelf: boolean;
  onMessage: (handle: string) => void;
  onRemoved: () => void;
}>();

const ROLES: ReadonlyArray<WorkspaceRole> = ["owner", "admin", "member"];

const detail = ref<HumanDetail | null>(null);
const error = ref<string | null>(null);
const roleEdit = ref<WorkspaceRole>("member");
const savingRole = ref(false);
const confirming = ref(false);
const removing = ref(false);

const roleChanged = computed(() => Boolean(detail.value) && roleEdit.value !== detail.value!.role);

const joinedStr = computed(() => {
  const j = detail.value?.joinedAt;
  if (!j) return "—";
  const d = new Date(j);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
});

watch(() => props.handle, (h) => {
  detail.value = null; error.value = null; confirming.value = false;
  api.human(h)
    .then((v) => { detail.value = v; roleEdit.value = v.role; })
    .catch((e) => { error.value = (e as Error).message; });
}, { immediate: true });

const saveRole = async () => {
  if (!detail.value || savingRole.value || !roleChanged.value) return;
  savingRole.value = true; error.value = null;
  try {
    const next = await api.setHumanRole(detail.value.handle, roleEdit.value);
    detail.value = next; roleEdit.value = next.role;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    savingRole.value = false;
  }
};
const cancelRole = () => { if (detail.value) roleEdit.value = detail.value.role; };

const remove = async () => {
  if (!detail.value) return;
  if (!confirming.value) { confirming.value = true; return; }
  removing.value = true; error.value = null;
  try {
    await api.removeHuman(detail.value.handle);
    props.onRemoved();
  } catch (e) {
    error.value = (e as Error).message; confirming.value = false;
  } finally {
    removing.value = false;
  }
};
</script>

<template>
  <div v-if="error && !detail" class="error-banner">{{ error }}</div>
  <div v-else-if="!detail" class="empty">Loading…</div>
  <div v-else class="agent-detail" data-testid="human-detail">
    <div class="ch-head">
      <Avatar type="human" :id="detail.handle" :size="34" />
      <div class="head-meta">
        <div class="nm">{{ detail.displayName }}</div>
        <div class="desc"><span class="fake">@{{ detail.handle }}</span></div>
      </div>
      <div class="right">
        <button class="nb-btn" data-testid="human-message" title="Open DM" @click="onMessage(detail.handle)">
          <MessageSquare :size="14" /> Message
        </button>
      </div>
    </div>

    <div class="agent-pane">
      <div class="profile" data-testid="human-profile">
        <div class="profile-hero">
          <Avatar type="human" :id="detail.handle" :size="64" />
          <div>
            <div class="hero-name">{{ detail.displayName }}</div>
            <div class="hero-handle">@{{ detail.handle }}</div>
          </div>
        </div>

        <div class="profile-sect">DESCRIPTION</div>
        <div class="fake">No description</div>

        <div class="profile-sect">INFO</div>
        <div class="kv">
          <div class="k">Role</div>
          <div class="v">
            <template v-if="canManage && !isSelf">
              <select data-testid="human-role-select" v-model="roleEdit">
                <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
              </select>
              <template v-if="roleChanged">
                <button class="nb-btn" :disabled="savingRole" @click="saveRole">{{ savingRole ? "Saving…" : "Save" }}</button>
                <button class="nb-btn" :disabled="savingRole" @click="cancelRole">Cancel</button>
              </template>
            </template>
            <span v-else class="role-badge">{{ detail.role.toUpperCase() }}</span>
          </div>
          <div class="k">Email</div>
          <div class="v">{{ detail.email ?? "—" }}</div>
          <div class="k">Joined</div>
          <div class="v">{{ joinedStr }}</div>
        </div>

        <div class="profile-sect">CREATED AGENTS</div>
        <template v-if="detail.createdAgents.length">
          <div v-for="a in detail.createdAgents" :key="a.handle" class="kv">
            <div class="k">{{ a.displayName }}</div>
            <div class="v">@{{ a.handle }}</div>
          </div>
        </template>
        <div v-else class="fake">No created agents</div>

        <template v-if="canManage && !isSelf">
          <div class="profile-sect">ACTIONS</div>
          <div v-if="error" class="gate-error">{{ error }}</div>
          <button class="nb-btn danger remove-btn" data-testid="human-remove" :disabled="removing" @click="remove">
            {{ removing ? "Removing…" : confirming ? "Click again to confirm" : "Remove Member" }}
          </button>
        </template>
        <div v-else-if="error" class="gate-error">{{ error }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.role-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: var(--pink-soft);
  color: var(--pink);
}
.remove-btn { width: 100%; justify-content: center; }
</style>
