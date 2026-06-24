<script setup lang="ts">
/** 登录门:邮箱密码登录,或注册新工作区 → 换取 sk_user_* 令牌。 */

import { ref, computed } from "vue";
import { Users } from "lucide-vue-next";
import { login, register } from "../api.js";

const props = defineProps<{ onConnect: (token: string) => void }>();

const mode = ref<"signin" | "register">("signin");
const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const workspaceName = ref("");
const displayName = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailOk = computed(() => EMAIL_RE.test(email.value.trim()));
// 即时校验提示(注册模式;字段非空时才提示,避免一进来就报红)
const emailHint = computed(() => mode.value === "register" && email.value.trim() && !emailOk.value ? "Enter a valid email address" : "");
const pwHint = computed(() => mode.value === "register" && password.value && password.value.length < 8 ? "Password must be at least 8 characters" : "");
const confirmHint = computed(() => mode.value === "register" && confirmPassword.value && confirmPassword.value !== password.value ? "Passwords don't match" : "");

const canSubmit = computed(() => mode.value === "signin"
  ? Boolean(email.value.trim() && password.value)
  : Boolean(emailOk.value && password.value.length >= 8 && password.value === confirmPassword.value && workspaceName.value.trim()));

const go = async () => {
  if (!canSubmit.value || busy.value) return;
  busy.value = true; error.value = null;
  try {
    const r = mode.value === "signin"
      ? await login(email.value.trim(), password.value)
      : await register({ email: email.value.trim(), password: password.value, workspaceName: workspaceName.value.trim(), ...(displayName.value.trim() ? { displayName: displayName.value.trim() } : {}) });
    props.onConnect(r.token);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};

const toggleMode = () => {
  mode.value = mode.value === "signin" ? "register" : "signin";
  error.value = null;
  confirmPassword.value = "";
};
</script>

<template>
  <div class="gate" data-testid="login-gate">
    <div class="gate-brand"><Users :size="26" :stroke-width="2.4" /> OpenSlock</div>
    <div class="gate-card">
      <h1>{{ mode === "signin" ? "Sign In" : "Create Workspace" }}</h1>
      <p>Where humans and AI agents build together</p>

      <template v-if="mode === 'register'">
        <label>Workspace name</label>
        <input data-testid="ws-name-input" placeholder="Acme Crew" v-model="workspaceName" @keydown.enter="go" />
        <label>Your name <span class="hint">(optional)</span></label>
        <input data-testid="display-name-input" placeholder="Alice" v-model="displayName" @keydown.enter="go" />
      </template>

      <label>Email</label>
      <input data-testid="email-input" type="email" placeholder="you@example.com" v-model="email" @keydown.enter="go" />
      <div v-if="emailHint" class="field-hint err" data-testid="email-hint">{{ emailHint }}</div>
      <label>Password <span v-if="mode === 'register'" class="hint">(min 8 chars)</span></label>
      <input data-testid="password-input" type="password" placeholder="••••••••" v-model="password" @keydown.enter="go" />
      <div v-if="pwHint" class="field-hint err" data-testid="pw-hint">{{ pwHint }}</div>
      <template v-if="mode === 'register'">
        <label>Confirm password</label>
        <input data-testid="confirm-password-input" type="password" placeholder="••••••••" v-model="confirmPassword" @keydown.enter="go" />
        <div v-if="confirmHint" class="field-hint err" data-testid="confirm-hint">{{ confirmHint }}</div>
      </template>
      <div v-if="error" class="gate-error" data-testid="login-error">{{ error }}</div>
      <button class="nb-btn primary" data-testid="signin-btn" :disabled="busy || !canSubmit" @click="go">
        {{ busy ? "Working…" : mode === "signin" ? "Sign In" : "Create Workspace" }}
      </button>
      <button class="gate-toggle" data-testid="toggle-mode" type="button" @click="toggleMode">
        {{ mode === "signin" ? "New here? Create a workspace" : "Already have an account? Sign in" }}
      </button>
    </div>
  </div>
</template>
