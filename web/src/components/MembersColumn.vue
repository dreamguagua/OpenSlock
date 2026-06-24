<script setup lang="ts">
/** Members 栏(第二列):AGENTS / HUMANS 分组列表 + 新建 agent。 */

import { ref } from "vue";
import { Plus, GitBranch, Bot, Download } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import type { AgentStatusInfo, AgentStatusKind, Member } from "../types.js";

const props = defineProps<{
  agents: Member[];
  humans: Member[];
  agentStatus: Record<string, AgentStatusInfo>;
  selectedHandle: string | null;
  selectedHuman: string | null;
  canManage: boolean; // owner/admin:可邀请成员
  onSelectAgent: (handle: string) => void;
  onSelectHuman: (handle: string) => void;
  onNewAgent: () => void;
  onImportAgent: () => void;
  onInvite: () => void;
}>();

const menuOpen = ref(false);
const kindOf = (a: Member): AgentStatusKind => props.agentStatus[a.handle]?.kind ?? (a.online ? "online" : "offline");
const chooseCreate = () => { menuOpen.value = false; props.onNewAgent(); };
const chooseImport = () => { menuOpen.value = false; props.onImportAgent(); };
</script>

<template>
  <div class="col" data-testid="members-column">
    <div class="col-head">Members</div>
    <div class="col-scroll">
      <div class="nav-item" title="Relationship graph (coming soon)">
        <GitBranch :size="16" /><span class="grow">Graph</span>
      </div>

      <div class="sect" :style="{ position: 'relative' }">
        <span>AGENTS</span><span class="count">{{ agents.length }}</span>
        <span class="grow" />
        <button class="sect-add" data-testid="add-agent-btn" title="Add agent" @click="menuOpen = !menuOpen">
          <Plus :size="15" />
        </button>
        <template v-if="menuOpen">
          <div class="menu-backdrop" @click="menuOpen = false" />
          <div class="popmenu" data-testid="add-agent-menu">
            <button class="popmenu-item" data-testid="menu-create-agent" @click="chooseCreate">
              <Bot :size="15" /> Create Agent
            </button>
            <button class="popmenu-item" data-testid="menu-import-agent" @click="chooseImport">
              <Download :size="15" /> Import raft agent
            </button>
          </div>
        </template>
      </div>
      <div v-if="agents.length === 0" class="member-row"><span class="nm" :style="{ color: '#999' }">No agents yet</span></div>
      <div
        v-for="a in agents"
        :key="a.handle"
        data-testid="agent-row"
        :class="`member-row ${a.handle === selectedHandle ? 'active' : ''}`"
        @click="onSelectAgent(a.handle)"
      >
        <Avatar type="agent" :id="a.handle" :size="26" :status="kindOf(a)" :url="a.avatarUrl" />
        <span class="nm">{{ a.displayName }}</span>
        <span v-if="a.description" class="member-sub">{{ a.description }}</span>
        <span :class="`dot ${kindOf(a)}`" :title="agentStatus[a.handle]?.label ?? kindOf(a)" />
      </div>

      <div class="sect">
        <span>HUMANS</span><span class="count">{{ humans.length }}</span>
        <span class="grow" />
        <button v-if="canManage" class="sect-add" data-testid="invite-member-btn" title="Invite member" @click="onInvite"><Plus :size="15" /></button>
      </div>
      <div
        v-for="h in humans"
        :key="h.handle"
        data-testid="human-row"
        :class="`member-row ${h.handle === selectedHuman ? 'active' : ''}`"
        @click="onSelectHuman(h.handle)"
      >
        <Avatar type="human" :id="h.handle" :size="26" />
        <span class="nm">{{ h.displayName }}</span>
      </div>
    </div>
  </div>
</template>
