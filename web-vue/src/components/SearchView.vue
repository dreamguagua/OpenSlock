<script setup lang="ts">
/** 全局搜索:输入关键词 → 后端 message search → 结果可点跳到频道。 */

import { ref } from "vue";
import type { AgentStatusInfo, Channel, Message } from "../types.js";
import Avatar from "./Avatar.vue";

const props = defineProps<{
  channels: Channel[];
  agentStatus: Record<string, AgentStatusInfo>;
  onSearch: (q: string) => Promise<Message[]>;
  onJump: (channelId: string) => void;
}>();

const q = ref("");
const results = ref<Message[] | null>(null);
const busy = ref(false);

async function run() {
  const t = q.value.trim();
  if (!t) return;
  busy.value = true;
  try { results.value = await props.onSearch(t); } finally { busy.value = false; }
}
const chanName = (id: string) => {
  const c = props.channels.find((x) => x.id === id);
  return c ? (c.name ?? c.slug) : id.slice(0, 8);
};
</script>

<template>
  <div class="chat" data-testid="search-view">
    <div class="task-toolbar">
      <input
        class="nb-btn"
        :style="{ fontWeight: '400', flex: '1' }"
        data-testid="search-input"
        autofocus
        placeholder="Search messages…"
        v-model="q"
        @keydown.enter="run"
      />
      <button class="nb-btn primary" data-testid="search-btn" :disabled="busy || !q.trim()" @click="run">Search</button>
    </div>
    <div class="msgs">
      <div v-if="results === null" class="placeholder"><div class="fake">Type a keyword to search messages visible in this workspace</div></div>
      <div v-if="results !== null && results.length === 0" class="placeholder"><div>No matches</div></div>
      <div
        v-for="m in (results ?? [])"
        :key="m.id"
        :class="`msg ${m.type}`"
        data-testid="search-result"
        :style="{ cursor: 'pointer' }"
        @click="onJump(m.channelId)"
      >
        <Avatar :type="m.type" :id="m.sender.id" :status="m.type === 'agent' ? agentStatus[m.sender.id]?.kind : undefined" />
        <div class="body">
          <div class="line1">
            <span class="who">{{ m.sender.id }}</span>
            <span class="meta mono">#{{ chanName(m.channelId) }} · #{{ m.seq }}</span>
          </div>
          <div class="content">{{ m.content }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
