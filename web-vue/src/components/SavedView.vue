<script setup lang="ts">
/** Saved messages:只读的书签消息列表。点条目跳频道。 */

import { ref, onMounted } from "vue";
import { Bookmark, RefreshCw } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import { api } from "../api.js";
import type { Channel, Message } from "../types.js";

const props = defineProps<{
  channels: Channel[];
  onJump: (channelId: string) => void;
}>();

const items = ref<Message[] | null>(null);
const error = ref<string | null>(null);

function load() {
  error.value = null;
  api.savedMessages().then((v) => { items.value = v; }).catch((e) => { error.value = (e as Error).message; });
}
onMounted(load);

const chanName = (id: string) => {
  const c = props.channels.find((x) => x.id === id);
  return c ? (c.kind === "dm" ? `@${c.name ?? c.slug}` : `#${c.name ?? c.slug}`) : "channel";
};
</script>

<template>
  <div class="activity-view" data-testid="saved-view">
    <div class="act-toolbar" :style="{ padding: '8px 16px' }">
      <span class="profile-sect" :style="{ margin: '0' }">SAVED</span>
      <span class="grow" />
      <button class="nb-btn" data-testid="saved-refresh" @click="load"><RefreshCw :size="13" /></button>
    </div>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <div v-if="items === null && !error" class="placeholder"><div class="fake">Loading…</div></div>
    <div v-if="items?.length === 0" class="placeholder"><div class="big">No saved messages</div><div class="fake">Click the bookmark icon on any message to save it here.</div></div>
    <div class="act-feed">
      <div
        v-for="m in (items ?? [])"
        :key="m.id"
        class="act-item"
        data-testid="saved-item"
        @click="onJump(m.channelId)"
      >
        <span class="act-ic"><Bookmark :size="16" /></span>
        <Avatar :type="(m.type as 'agent' | 'human')" :id="m.sender.id" :size="26" />
        <div class="act-main">
          <div class="act-line1">
            <b>{{ m.sender.id }}</b>
            <span class="act-where">{{ chanName(m.channelId) }}</span>
          </div>
          <div class="act-text">{{ m.content }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
