<script setup lang="ts">
/** 邀请弹窗(对标 SettingsDialog 的 overlay):生成并复制邀请链接,可切角色重生成。 */

import { ref, onMounted } from "vue";
import { api } from "../api.js";

const props = defineProps<{ onClose: () => void }>();

const url = ref<string | null>(null);
const role = ref<"member" | "admin">("member");
const error = ref<string | null>(null);
const generating = ref(false);
const copied = ref(false);

const generate = async (r: "member" | "admin") => {
  generating.value = true; error.value = null; copied.value = false;
  try {
    const res = await api.createInvite(r);
    url.value = res.url;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    generating.value = false;
  }
};

onMounted(() => { generate(role.value); });

const onRoleChange = () => { generate(role.value); };

const copy = async () => {
  if (!url.value) return;
  try {
    await navigator.clipboard.writeText(url.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch (e) {
    error.value = (e as Error).message;
  }
};
</script>

<template>
  <div class="modal-overlay" data-testid="invite-dialog" @click="onClose">
    <div class="settings-modal invite-modal" @click.stop>
      <section class="settings-content">
        <div class="settings-content-head">
          <span>Invite people</span>
          <button class="icon-btn" title="Close" @click="onClose">✕</button>
        </div>

        <div class="settings-content-body">
          <p class="field-hint">Anyone with this link can join this workspace.</p>

          <div v-if="error" class="gate-error">{{ error }}</div>
          <div v-else-if="generating && !url" class="fake">Generating…</div>

          <template v-else-if="url">
            <div class="invite-url-row">
              <input class="acct-input" data-testid="invite-url" :value="url" readonly />
              <button class="nb-btn primary" data-testid="invite-copy" @click="copy">
                {{ copied ? "Copied!" : "Copy" }}
              </button>
            </div>
          </template>

          <label class="acct-label">Role</label>
          <select class="acct-input" v-model="role" @change="onRoleChange">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>

          <button class="nb-btn primary acct-save" @click="onClose">Done</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.invite-modal { width: 520px; height: auto; max-height: 88vh; }
.invite-url-row { display: flex; gap: 8px; align-items: center; }
.invite-url-row .acct-input { flex: 1; }
</style>
