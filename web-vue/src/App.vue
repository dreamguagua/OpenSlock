<script setup lang="ts">
/** 根组件:无 token → 登录门;有 token → 工作区(token 变化时 remount 重置 useCrew)。 */

import { ref } from "vue";
import { api } from "./api.js";
import TokenGate from "./components/TokenGate.vue";
import Workspace from "./components/Workspace.vue";

const TOKEN_KEY = "crew_token";
const token = ref(localStorage.getItem(TOKEN_KEY) ?? "");

const onConnect = (t: string) => { localStorage.setItem(TOKEN_KEY, t); token.value = t; };
const onLogout = () => { void api.logout().catch(() => {}); localStorage.removeItem(TOKEN_KEY); token.value = ""; };
</script>

<template>
  <TokenGate v-if="!token" :on-connect="onConnect" />
  <Workspace v-else :key="token" :token="token" :on-logout="onLogout" />
</template>
