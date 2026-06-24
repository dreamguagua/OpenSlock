<script setup lang="ts">
/** 最左图标栏:工作区图标 + 导航图标 + 底部头像/设置。 */

import { MessageSquare, Search, CheckCheck, Users, Monitor, Settings } from "lucide-vue-next";
import type { RailSection } from "./railSection.js";

defineProps<{
  workspaceInitial: string;
  active: RailSection;
  onNav: (s: RailSection) => void;
  onLogout: () => void;
  onSettings: () => void;
  onWorkspace: () => void;
}>();
</script>

<template>
  <nav class="rail">
    <div class="ws" title="Switch workspace" data-testid="rail-workspace" @click="onWorkspace">{{ workspaceInitial }}</div>
    <div :class="`icon ${active === 'chat' ? 'active' : ''}`" title="Chat" data-testid="rail-chat" @click="onNav('chat')"><MessageSquare :size="20" /></div>
    <div :class="`icon ${active === 'search' ? 'active' : ''}`" title="Search" data-testid="rail-search" @click="onNav('search')"><Search :size="20" /></div>
    <div class="icon" title="Tasks (placeholder)"><CheckCheck :size="20" /></div>
    <div :class="`icon ${active === 'members' ? 'active' : ''}`" title="Members" data-testid="rail-members" @click="onNav('members')"><Users :size="20" /></div>
    <div :class="`icon ${active === 'computers' ? 'active' : ''}`" title="Computers" data-testid="rail-computers" @click="onNav('computers')"><Monitor :size="20" /></div>
    <div class="spacer" />
    <div class="avatar" title="Sign out" @click="onLogout">You</div>
    <div class="icon" title="Settings" data-testid="rail-settings" @click="onSettings"><Settings :size="20" /></div>
  </nav>
</template>
