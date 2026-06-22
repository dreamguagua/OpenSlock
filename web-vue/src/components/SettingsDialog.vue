<script setup lang="ts">
/** Settings dialog —— 工作区信息、当前身份、连接状态、登出。 */

import { ref, onMounted } from "vue";
import { Check } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import { api } from "../api.js";
import type { Me } from "../types.js";

defineProps<{
  connected: boolean;
  onClose: () => void;
  onLogout: () => void;
}>();

const me = ref<Me | null>(null);
const error = ref<string | null>(null);

onMounted(() => {
  api.me().then((v) => { me.value = v; }).catch((e) => { error.value = (e as Error).message; });
});
</script>

<template>
  <div class="modal-overlay" data-testid="settings-dialog" @click="onClose">
    <div class="modal" @click.stop>
      <div class="modal-head">Settings</div>
      <div class="modal-body">
        <div v-if="error" class="gate-error">{{ error }}</div>
        <div v-if="!me && !error" class="fake">Loading…</div>
        <template v-if="me">
          <label>WORKSPACE</label>
          <div class="ws-switcher">
            <div class="ws-entry active" data-testid="ws-entry">
              <div class="ws-badge">{{ me.workspace.name.slice(0, 1).toUpperCase() }}</div>
              <div class="ws-meta">
                <div class="ws-name">{{ me.workspace.name }}</div>
                <div class="ws-slug">/{{ me.workspace.slug }}</div>
              </div>
              <Check :size="16" />
            </div>
          </div>
          <div class="field-hint">Switching between workspaces requires multi-workspace membership (coming soon).</div>

          <label :style="{ marginTop: '14px' }">SIGNED IN AS</label>
          <div class="me-row" data-testid="me-row">
            <Avatar :type="me.actor.type === 'agent' ? 'agent' : 'human'" :id="me.actor.id" :size="32" />
            <div class="ws-meta">
              <div class="ws-name">{{ me.displayName }}</div>
              <div class="ws-slug">@{{ me.actor.id }} · {{ me.tier }}</div>
            </div>
          </div>

          <label :style="{ marginTop: '14px' }">CONNECTION</label>
          <div class="conn-line">
            <span :class="`dot ${connected ? 'online' : 'offline'}`" />
            {{ connected ? "Connected (realtime)" : "Disconnected" }}
          </div>
        </template>
      </div>
      <div class="modal-foot">
        <button class="nb-btn" @click="onClose">Close</button>
        <button class="nb-btn primary" data-testid="settings-signout" @click="onLogout">Sign out</button>
      </div>
    </div>
  </div>
</template>
