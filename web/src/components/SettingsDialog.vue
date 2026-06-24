<script setup lang="ts">
/**
 * Settings —— 仿 raft 的设置面板:左侧分组导航 + 右侧分区内容。
 * 当前可用分区 = Account(改 Display Name / 改密码 / 登出);其余依赖外部服务的分区先占位 coming soon。
 */

import { ref, computed, onMounted } from "vue";
import { Check, User, Languages, Palette, Bell, Server, CreditCard, Shield, AppWindow, FileText, ChevronRight, ChevronDown, LogOut } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import { api } from "../api.js";
import type { Me } from "../types.js";

const props = defineProps<{
  connected: boolean;
  onClose: () => void;
  onLogout: () => void;
  onProfileSaved?: () => void;
}>();

type SectionKey =
  | "account" | "language" | "appearance" | "notifications"
  | "server-profile" | "billing" | "administration" | "connected-apps"
  | "release-notes";

const NAV: ReadonlyArray<{ group: string; items: ReadonlyArray<{ key: SectionKey; label: string; icon: unknown; soon?: boolean }> }> = [
  { group: "Personal", items: [
    { key: "account", label: "Account", icon: User },
    { key: "language", label: "Language & Region", icon: Languages, soon: true },
    { key: "appearance", label: "Appearance", icon: Palette, soon: true },
    { key: "notifications", label: "Notifications", icon: Bell, soon: true },
  ] },
  { group: "Server", items: [
    { key: "server-profile", label: "Server Profile", icon: Server, soon: true },
    { key: "billing", label: "Plan & Billing", icon: CreditCard, soon: true },
    { key: "administration", label: "Administration", icon: Shield, soon: true },
    { key: "connected-apps", label: "Connected Apps", icon: AppWindow, soon: true },
  ] },
  { group: "About", items: [
    { key: "release-notes", label: "Release Notes", icon: FileText, soon: true },
  ] },
];

const active = ref<SectionKey>("account");
const activeLabel = computed(() => NAV.flatMap((g) => g.items).find((i) => i.key === active.value)?.label ?? "Account");

const me = ref<Me | null>(null);
const loadError = ref<string | null>(null);

// --- profile (display name) ---
const displayName = ref("");
const savingProfile = ref(false);
const profileMsg = ref<{ kind: "ok" | "err"; text: string } | null>(null);
const profileDirty = computed(() => Boolean(me.value) && displayName.value.trim().length > 0 && displayName.value.trim() !== me.value!.displayName);

// --- change password (collapsible) ---
const pwOpen = ref(false);
const curPw = ref("");
const newPw = ref("");
const confirmPw = ref("");
const savingPw = ref(false);
const pwMsg = ref<{ kind: "ok" | "err"; text: string } | null>(null);
const pwValid = computed(() => curPw.value.length >= 1 && newPw.value.length >= 8 && newPw.value === confirmPw.value);

onMounted(() => {
  api.me().then((v) => { me.value = v; displayName.value = v.displayName; }).catch((e) => { loadError.value = (e as Error).message; });
});

const saveProfile = async () => {
  if (!profileDirty.value || savingProfile.value) return;
  savingProfile.value = true; profileMsg.value = null;
  try {
    const r = await api.updateProfile({ displayName: displayName.value.trim() });
    if (me.value) me.value = { ...me.value, displayName: r.displayName };
    profileMsg.value = { kind: "ok", text: "Profile saved" };
    props.onProfileSaved?.();
  } catch (e) {
    profileMsg.value = { kind: "err", text: (e as Error).message };
  } finally {
    savingProfile.value = false;
  }
};

const savePassword = async () => {
  if (!pwValid.value || savingPw.value) return;
  savingPw.value = true; pwMsg.value = null;
  try {
    await api.changePassword(curPw.value, newPw.value);
    pwMsg.value = { kind: "ok", text: "Password changed" };
    curPw.value = ""; newPw.value = ""; confirmPw.value = "";
  } catch (e) {
    pwMsg.value = { kind: "err", text: (e as Error).message };
  } finally {
    savingPw.value = false;
  }
};
</script>

<template>
  <div class="modal-overlay" data-testid="settings-dialog" @click="onClose">
    <div class="settings-modal" @click.stop>
      <!-- left nav -->
      <aside class="settings-nav">
        <div class="settings-nav-title">Settings</div>
        <div v-for="g in NAV" :key="g.group" class="settings-nav-group">
          <div class="settings-nav-group-label">{{ g.group }}</div>
          <button
            v-for="it in g.items" :key="it.key"
            :class="['settings-nav-item', { active: active === it.key }]"
            :data-testid="`settings-nav-${it.key}`"
            @click="active = it.key"
          >
            <component :is="it.icon" :size="16" />
            <span class="settings-nav-label">{{ it.label }}</span>
            <span v-if="it.soon" class="settings-soon">soon</span>
          </button>
        </div>
      </aside>

      <!-- content -->
      <section class="settings-content">
        <div class="settings-content-head">
          <span>{{ activeLabel }}</span>
          <button class="icon-btn" data-testid="settings-close" title="Close" @click="onClose">✕</button>
        </div>

        <div class="settings-content-body">
          <div v-if="loadError" class="gate-error">{{ loadError }}</div>
          <div v-else-if="!me" class="fake">Loading…</div>

          <!-- ACCOUNT -->
          <template v-else-if="active === 'account'">
            <div class="acct-id">
              <Avatar :type="me.actor.type === 'agent' ? 'agent' : 'human'" :id="me.actor.id" :size="56" />
              <div>
                <div class="acct-id-name">{{ me.displayName }}</div>
                <div class="acct-id-handle">@{{ me.handle ?? me.actor.id }}</div>
              </div>
            </div>

            <label class="acct-label">Name</label>
            <input class="acct-input" data-testid="account-name" :value="me.handle ?? me.actor.id" readonly disabled />
            <div class="field-hint">Your handle is your identity across the workspace and can't be changed here.</div>

            <label class="acct-label">Display Name</label>
            <input class="acct-input" data-testid="account-displayname" v-model="displayName" maxlength="80" placeholder="Your name" @keydown.enter="saveProfile" />

            <label class="acct-label">Email</label>
            <div class="acct-email-row">
              <input class="acct-input" data-testid="account-email" :value="me.email ?? '—'" readonly disabled />
              <span v-if="me.email" class="verified-pill"><Check :size="12" /> Verified</span>
            </div>

            <div v-if="profileMsg" :class="['acct-msg', profileMsg.kind]" data-testid="profile-msg">{{ profileMsg.text }}</div>
            <button class="nb-btn primary acct-save" data-testid="save-profile" :disabled="!profileDirty || savingProfile" @click="saveProfile">
              {{ savingProfile ? "Saving…" : "Save Profile" }}
            </button>

            <div class="acct-divider" />

            <!-- Connected accounts (OAuth — needs provider config, shown as coming soon) -->
            <div class="acct-section-label">Connected accounts</div>
            <div class="conn-acct" v-for="p in [{ n: 'Google' }, { n: 'GitHub' }]" :key="p.n">
              <div class="conn-acct-name">{{ p.n }}<span class="conn-acct-sub">Not connected</span></div>
              <button class="nb-btn" disabled title="Coming soon">Connect</button>
            </div>

            <div class="acct-divider" />

            <!-- Change password -->
            <button class="acct-collapse" data-testid="toggle-password" @click="pwOpen = !pwOpen">
              <component :is="pwOpen ? ChevronDown : ChevronRight" :size="16" /> Change Password
            </button>
            <div v-if="pwOpen" class="acct-pw">
              <label class="acct-label">Current password</label>
              <input class="acct-input" type="password" data-testid="cur-password" v-model="curPw" placeholder="••••••••" />
              <label class="acct-label">New password <span class="hint">(min 8 chars)</span></label>
              <input class="acct-input" type="password" data-testid="new-password" v-model="newPw" placeholder="••••••••" />
              <label class="acct-label">Confirm new password</label>
              <input class="acct-input" type="password" data-testid="confirm-password" v-model="confirmPw" placeholder="••••••••" @keydown.enter="savePassword" />
              <div v-if="newPw && confirmPw && newPw !== confirmPw" class="acct-msg err">Passwords don't match</div>
              <div v-if="pwMsg" :class="['acct-msg', pwMsg.kind]" data-testid="pw-msg">{{ pwMsg.text }}</div>
              <button class="nb-btn primary acct-save" data-testid="save-password" :disabled="!pwValid || savingPw" @click="savePassword">
                {{ savingPw ? "Saving…" : "Update Password" }}
              </button>
            </div>

            <div class="acct-divider" />

            <!-- Session -->
            <div class="acct-section-label">Session</div>
            <div class="conn-acct">
              <div class="conn-acct-name">
                Log out
                <span class="conn-acct-sub">Sign out of this browser. Your account and data stay; you can sign back in any time.</span>
              </div>
              <button class="nb-btn danger" data-testid="settings-signout" @click="onLogout"><LogOut :size="14" /> Log out</button>
            </div>
            <div class="conn-line acct-conn">
              <span :class="`dot ${connected ? 'online' : 'offline'}`" />
              {{ connected ? "Connected (realtime)" : "Disconnected" }}
            </div>
          </template>

          <!-- placeholder sections -->
          <template v-else>
            <div class="settings-soon-panel" data-testid="settings-soon-panel">
              <Palette :size="32" :stroke-width="1.6" />
              <div class="settings-soon-title">{{ activeLabel }}</div>
              <div class="settings-soon-text">This section is coming soon.</div>
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>
