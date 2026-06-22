<script setup lang="ts">
/** Activity timeline:@提及我 / 回复我 / 我的任务更新。只读聚合,点条目跳频道。 */

import { ref, onMounted } from "vue";
import { AtSign, MessageSquare, CheckSquare, RefreshCw } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import { api } from "../api.js";
import type { ActivityFeedItem, Channel, Member } from "../types.js";

const props = defineProps<{
  channels: Channel[];
  agents: Member[];
  humans: Member[];
  onJump: (channelId: string) => void;
}>();

const KIND_ICON = { mention: AtSign, reply: MessageSquare, task: CheckSquare } as const;
const KIND_LABEL = { mention: "mentioned you", reply: "replied to you", task: "task" } as const;

const items = ref<ActivityFeedItem[] | null>(null);
const error = ref<string | null>(null);

function load() {
  error.value = null;
  api.activity().then((v) => { items.value = v; }).catch((e) => { error.value = (e as Error).message; });
}
onMounted(load);

const chanName = (id: string) => {
  const c = props.channels.find((x) => x.id === id);
  return c ? (c.kind === "dm" ? `@${c.name ?? c.slug}` : `#${c.name ?? c.slug}`) : "channel";
};
const actorName = (t: string, id: string) =>
  t === "agent" ? (props.agents.find((a) => a.handle === id)?.displayName ?? id)
  : t === "human" ? (props.humans.find((h) => h.handle === id)?.displayName ?? id)
  : id;
const when = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-US"); };
</script>

<template>
  <div class="activity-view" data-testid="activity-view">
    <div class="act-toolbar" :style="{ padding: '8px 16px' }">
      <span class="profile-sect" :style="{ margin: '0' }">ACTIVITY</span>
      <span class="grow" />
      <button class="nb-btn" data-testid="activity-view-refresh" @click="load"><RefreshCw :size="13" /></button>
    </div>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <div v-if="items === null && !error" class="placeholder"><div class="fake">Loading…</div></div>
    <div v-if="items?.length === 0" class="placeholder"><div class="big">No activity</div><div class="fake">@mentions, replies to you, and your task updates show up here.</div></div>
    <div class="act-feed">
      <div
        v-for="it in (items ?? [])"
        :key="`${it.kind}:${it.id}`"
        class="act-item"
        data-testid="activity-item"
        @click="onJump(it.channelId)"
      >
        <span class="act-ic"><component :is="KIND_ICON[it.kind]" :size="16" /></span>
        <Avatar v-if="it.kind !== 'task'" :type="(it.actorType as 'agent' | 'human')" :id="it.actorId" :size="26" />
        <div class="act-main">
          <div class="act-line1">
            <b>{{ it.kind === "task" ? `#${it.text}` : actorName(it.actorType, it.actorId) }}</b>
            <span class="act-kindtag">{{ KIND_LABEL[it.kind] }}{{ it.meta ? ` · ${it.meta.replace("_", " ")}` : "" }}</span>
            <span class="act-where">{{ chanName(it.channelId) }}</span>
            <span class="grow" />
            <span class="act-when">{{ when(it.at) }}</span>
          </div>
          <div v-if="it.kind !== 'task'" class="act-text">{{ it.text }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
