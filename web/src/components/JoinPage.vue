<script setup lang="ts">
/** Join 页(对标 raft 的 "Join this server"):预览邀请 → 接受入区。
 *  已登录:一键接受;未登录:choose / signin / create 三态。 */

import { ref, onMounted } from "vue";
import { Users } from "lucide-vue-next";
import { previewInvite, acceptInvitePublic, registerAccount } from "../api.js";
import { api } from "../api.js";
import type { InvitePreview } from "../types.js";

const props = defineProps<{
  inviteToken: string;
  loggedIn: boolean;
  onConnect: (token: string) => void;
  onDismiss: () => void;
}>();

type View = "choose" | "signin" | "create";

const preview = ref<InvitePreview | null>(null);
const loading = ref(true);
const loadFailed = ref(false);
const view = ref<View>("choose");
const name = ref("");
const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

onMounted(async () => {
  try {
    preview.value = await previewInvite(props.inviteToken);
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
});

const acceptLoggedIn = async () => {
  if (busy.value) return;
  busy.value = true; error.value = null;
  try {
    const r = await api.acceptInvite(props.inviteToken);
    props.onConnect(r.token);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};

const doSignin = async () => {
  if (busy.value) return;
  busy.value = true; error.value = null;
  try {
    const r = await acceptInvitePublic(props.inviteToken, { email: email.value.trim(), password: password.value });
    props.onConnect(r.token);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};

const doCreate = async () => {
  if (busy.value) return;
  busy.value = true; error.value = null;
  try {
    await registerAccount({ name: name.value.trim(), email: email.value.trim(), password: password.value });
    const r = await acceptInvitePublic(props.inviteToken, { email: email.value.trim(), password: password.value, displayName: name.value.trim() });
    props.onConnect(r.token);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};

const switchTo = (v: View) => { view.value = v; error.value = null; };
</script>

<template>
  <div class="gate" data-testid="join-page">
    <div class="gate-brand"><Users :size="26" :stroke-width="2.4" /> OpenSlock</div>
    <div class="gate-card">
      <template v-if="loading">
        <p>Loading…</p>
      </template>

      <template v-else-if="loadFailed">
        <h1>Invite unavailable</h1>
        <div class="gate-error" data-testid="join-error">This invite link is invalid or expired.</div>
        <button class="nb-btn primary" @click="onDismiss">Go to OpenSlock</button>
      </template>

      <template v-else-if="preview">
        <h1>Join this server</h1>
        <p>Use this link to join <b>{{ preview.workspaceName }}</b> on OpenSlock.</p>
        <p>Meet <b>{{ preview.humans }} humans</b> and <b>{{ preview.agents }} agents</b> inside.</p>

        <!-- logged in: one-click join -->
        <template v-if="loggedIn">
          <div v-if="error" class="gate-error">{{ error }}</div>
          <button class="nb-btn primary" data-testid="join-accept" :disabled="busy" @click="acceptLoggedIn">
            {{ busy ? "Joining…" : `Join ${preview.workspaceName}` }}
          </button>
          <button class="gate-toggle" type="button" @click="onDismiss">Not now</button>
        </template>

        <!-- logged out: choose / signin / create -->
        <template v-else>
          <template v-if="view === 'choose'">
            <p>Sign in or create an account to accept this invite.</p>
            <div v-if="error" class="gate-error">{{ error }}</div>
            <button class="nb-btn primary" @click="switchTo('signin')">Sign In</button>
            <button class="gate-toggle" type="button" @click="switchTo('create')">
              <span class="gate-toggle-link">Create Account</span>
            </button>
          </template>

          <template v-else-if="view === 'signin'">
            <label>Email</label>
            <input type="email" placeholder="you@example.com" v-model="email" @keydown.enter="doSignin" />
            <label>Password</label>
            <input type="password" placeholder="••••••••" v-model="password" @keydown.enter="doSignin" />
            <div v-if="error" class="gate-error">{{ error }}</div>
            <button class="nb-btn primary" data-testid="join-accept" :disabled="busy" @click="doSignin">
              {{ busy ? "Working…" : "Sign In" }}
            </button>
            <button class="gate-toggle" type="button" @click="switchTo('choose')">
              <span class="gate-toggle-link">Back</span>
            </button>
          </template>

          <template v-else>
            <label>Name</label>
            <input placeholder="Letters, numbers, hyphens, underscores" v-model="name" @keydown.enter="doCreate" />
            <label>Email</label>
            <input type="email" placeholder="you@example.com" v-model="email" @keydown.enter="doCreate" />
            <label>Password</label>
            <input type="password" placeholder="••••••••" v-model="password" @keydown.enter="doCreate" />
            <div v-if="error" class="gate-error">{{ error }}</div>
            <button class="nb-btn primary" data-testid="join-accept" :disabled="busy" @click="doCreate">
              {{ busy ? "Working…" : "Create Account & Join" }}
            </button>
            <button class="gate-toggle" type="button" @click="switchTo('choose')">
              <span class="gate-toggle-link">Back</span>
            </button>
          </template>
        </template>
      </template>
    </div>
  </div>
</template>
