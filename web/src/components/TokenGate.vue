<script setup lang="ts">
/** 登录门(多步,对标 raft):
 *  signin         邮箱密码登录 + "No account? Create One"
 *  createAccount  Name/Email/Password 建全局账号(邮箱验证后期再做,这里直接进入下一步)
 *  createWorkspace 建首个工作区(注册后无邀请时;或登录账号尚无工作区时)
 *  换取 sk_user_* 令牌后回调 onConnect。 */

import { ref, computed } from "vue";
import { Users } from "lucide-vue-next";
import { login, registerAccount, createWorkspacePublic } from "../api.js";

const props = defineProps<{ onConnect: (token: string) => void }>();

type Mode = "signin" | "createAccount" | "createWorkspace";
const mode = ref<Mode>("signin");
const name = ref("");
const email = ref("");
const password = ref("");
const workspaceName = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailOk = computed(() => EMAIL_RE.test(email.value.trim()));
const emailHint = computed(() => mode.value === "createAccount" && email.value.trim() && !emailOk.value ? "Enter a valid email address" : "");
const pwHint = computed(() => mode.value === "createAccount" && password.value && password.value.length < 8 ? "Password must be at least 8 characters" : "");

const heading = computed(() => mode.value === "signin" ? "Sign In" : mode.value === "createAccount" ? "Create Account" : "Create Workspace");
const cta = computed(() => mode.value === "signin" ? "Sign In" : mode.value === "createAccount" ? "Create Account" : "Create Workspace");

const canSubmit = computed(() => {
  if (busy.value) return false;
  if (mode.value === "signin") return Boolean(email.value.trim() && password.value);
  if (mode.value === "createAccount") return Boolean(name.value.trim() && emailOk.value && password.value.length >= 8);
  return Boolean(workspaceName.value.trim());
});

const go = async () => {
  if (!canSubmit.value) return;
  busy.value = true; error.value = null;
  try {
    if (mode.value === "signin") {
      const r = await login(email.value.trim(), password.value);
      if (r.needsWorkspace) { mode.value = "createWorkspace"; return; } // 账号还没工作区
      props.onConnect(r.token);
    } else if (mode.value === "createAccount") {
      await registerAccount({ name: name.value.trim(), email: email.value.trim(), password: password.value });
      mode.value = "createWorkspace"; // 第二步:建工作区(沿用刚填的邮箱密码核验)
    } else {
      const r = await createWorkspacePublic({
        email: email.value.trim(),
        password: password.value,
        workspaceName: workspaceName.value.trim(),
        ...(name.value.trim() ? { displayName: name.value.trim() } : {}),
      });
      props.onConnect(r.token);
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};

const switchTo = (m: Mode) => { mode.value = m; error.value = null; };
</script>

<template>
  <div class="gate" data-testid="login-gate">
    <div class="gate-brand"><Users :size="26" :stroke-width="2.4" /> OpenSlock</div>
    <div class="gate-card">
      <h1>{{ heading }}</h1>
      <p v-if="mode === 'createWorkspace'">Name your workspace — you can invite people later</p>
      <p v-else>Where humans and AI agents build together</p>

      <!-- Create Account: Name -->
      <template v-if="mode === 'createAccount'">
        <label>Name</label>
        <input data-testid="name-input" placeholder="Letters, numbers, hyphens, underscores" v-model="name" @keydown.enter="go" />
      </template>

      <!-- Create Workspace step -->
      <template v-if="mode === 'createWorkspace'">
        <label>Workspace name</label>
        <input data-testid="ws-name-input" placeholder="Acme Crew" v-model="workspaceName" @keydown.enter="go" />
        <label>Your name <span class="hint">(optional)</span></label>
        <input data-testid="display-name-input" placeholder="Alice" v-model="name" @keydown.enter="go" />
      </template>

      <!-- signin + createAccount: email/password -->
      <template v-if="mode !== 'createWorkspace'">
        <label>Email</label>
        <input data-testid="email-input" type="email" placeholder="you@example.com" v-model="email" @keydown.enter="go" />
        <div v-if="emailHint" class="field-hint err" data-testid="email-hint">{{ emailHint }}</div>
        <label>Password <span v-if="mode === 'createAccount'" class="hint">(min 8 chars)</span></label>
        <input data-testid="password-input" type="password" placeholder="••••••••" v-model="password" @keydown.enter="go" />
        <div v-if="pwHint" class="field-hint err" data-testid="pw-hint">{{ pwHint }}</div>
      </template>

      <div v-if="error" class="gate-error" data-testid="login-error">{{ error }}</div>
      <button class="nb-btn primary" data-testid="signin-btn" :disabled="!canSubmit" @click="go">
        {{ busy ? "Working…" : cta }}
      </button>

      <button v-if="mode === 'signin'" class="gate-toggle" data-testid="toggle-mode" type="button" @click="switchTo('createAccount')">
        No account? <span class="gate-toggle-link">Create One</span>
      </button>
      <button v-else-if="mode === 'createAccount'" class="gate-toggle" data-testid="toggle-mode" type="button" @click="switchTo('signin')">
        Already have an account? <span class="gate-toggle-link">Sign in</span>
      </button>
    </div>
  </div>
</template>
