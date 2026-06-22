<script setup lang="ts">
/** 频道栏:Chat 头 + Activity/Saved 导航 + PINNED + CHANNELS 列表。 */

import { computed } from "vue";
import { Plus, Search, Activity, Bookmark, Zap, Pin, Hash, User, Lock } from "lucide-vue-next";
import type { Channel } from "../types.js";

const props = defineProps<{
  channels: Channel[];
  selectedChannelId: string | null;
  onSelect: (id: string) => void;
  onNav: (view: "activity" | "saved" | "search" | "actions") => void;
  onNewChannel: () => void;
  view: string;
}>();

const regular = computed(() => props.channels.filter((c) => c.kind !== "dm"));
const dms = computed(() => props.channels.filter((c) => c.kind === "dm"));
</script>

<template>
  <div class="col">
    <div class="col-head">Chat</div>
    <div class="col-scroll">
      <div class="nav-item" data-testid="nav-search" @click="onNav('search')">
        <Search :size="16" /><span class="grow">Search</span>
      </div>
      <div class="nav-item" @click="onNav('activity')">
        <Activity :size="16" /><span class="grow">Activity</span>
        <span class="badge" title="placeholder">99+</span>
      </div>
      <div class="nav-item" @click="onNav('saved')">
        <Bookmark :size="16" /><span class="grow">Saved</span>
        <span class="badge" title="placeholder">2</span>
      </div>
      <div class="nav-item" data-testid="nav-actions" @click="onNav('actions')">
        <Zap :size="16" /><span class="grow">Actions</span>
      </div>

      <div class="sect"><Pin :size="12" /><span>PINNED</span><span class="grow" /><span class="count">(placeholder)</span></div>
      <div class="chan"><span class="h">#</span><span class="nm" :style="{ color: '#999' }">No pinned channels yet</span></div>

      <div class="sect">
        <span>CHANNELS</span><span class="count">{{ regular.length }}</span><span class="grow" />
        <button class="sect-add" data-testid="new-channel-btn" title="New channel" @click="onNewChannel">
          <Plus :size="15" />
        </button>
      </div>
      <div v-if="regular.length === 0" class="chan"><span class="nm" :style="{ color: '#999' }">No channels</span></div>
      <div
        v-for="c in regular"
        :key="c.id"
        data-testid="channel-item"
        :class="`chan ${c.id === selectedChannelId && view === 'channel' ? 'active' : ''}`"
        @click="onSelect(c.id)"
      >
        <span class="h"><User v-if="c.kind === 'dm'" :size="15" /><Hash v-else :size="15" /></span>
        <span class="nm">{{ c.name ?? c.slug }}</span>
        <Lock v-if="c.isPrivate && c.kind !== 'dm'" :size="13" aria-label="Private" />
        <span v-if="c.unread > 0 && c.id !== selectedChannelId" class="badge" data-testid="unread-badge">{{ c.unread > 99 ? "99+" : c.unread }}</span>
      </div>

      <div class="sect">
        <span>DIRECT MESSAGES</span><span class="grow" /><span class="count">{{ dms.length }}</span>
      </div>
      <div v-if="dms.length === 0" class="chan"><span class="nm" :style="{ color: '#999' }">No DMs yet</span></div>
      <div
        v-for="c in dms"
        :key="c.id"
        data-testid="channel-item"
        :class="`chan ${c.id === selectedChannelId && view === 'channel' ? 'active' : ''}`"
        @click="onSelect(c.id)"
      >
        <span class="h"><User v-if="c.kind === 'dm'" :size="15" /><Hash v-else :size="15" /></span>
        <span class="nm">{{ c.name ?? c.slug }}</span>
        <Lock v-if="c.isPrivate && c.kind !== 'dm'" :size="13" aria-label="Private" />
        <span v-if="c.unread > 0 && c.id !== selectedChannelId" class="badge" data-testid="unread-badge">{{ c.unread > 99 ? "99+" : c.unread }}</span>
      </div>
    </div>
  </div>
</template>
