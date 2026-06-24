<script setup lang="ts">
/** 根组件:
 *  - /join/<token> → JoinPage(邀请入区,登录/注册或已登录直接加入)
 *  - 无 token → 登录门(Sign In / Create Account / Create Workspace 多步)
 *  - 有 token → 工作区(token 变化时 remount 重置 useCrew;切换工作区即换 token) */

import { ref, computed } from "vue";
import { api } from "./api.js";
import TokenGate from "./components/TokenGate.vue";
import JoinPage from "./components/JoinPage.vue";
import Workspace from "./components/Workspace.vue";

const TOKEN_KEY = "crew_token";
const token = ref(localStorage.getItem(TOKEN_KEY) ?? "");

// 手动路由:仅识别 /join/<token>(无 vue-router)。
const path = ref(window.location.pathname);
const inviteToken = computed(() => {
  const m = path.value.match(/^\/join\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
});

const clearRoute = () => {
  if (window.location.pathname !== "/") window.history.replaceState({}, "", "/");
  path.value = "/";
};

const onConnect = (t: string) => {
  localStorage.setItem(TOKEN_KEY, t);
  token.value = t;
  clearRoute();
};
const onLogout = () => {
  void api.logout().catch(() => {});
  localStorage.removeItem(TOKEN_KEY);
  token.value = "";
};
</script>

<template>
  <JoinPage
    v-if="inviteToken"
    :invite-token="inviteToken"
    :logged-in="Boolean(token)"
    :on-connect="onConnect"
    :on-dismiss="clearRoute"
  />
  <TokenGate v-else-if="!token" :on-connect="onConnect" />
  <Workspace v-else :key="token" :token="token" :on-logout="onLogout" :on-connect="onConnect" />
</template>
