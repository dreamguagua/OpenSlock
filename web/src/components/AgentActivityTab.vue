<script setup lang="ts">
/** Agent 详情 — Activity 页:实时活动条 + 历史活动列表。 */

import { ref, watch, onUnmounted } from "vue";
import { Activity as ActivityIcon, RefreshCw } from "lucide-vue-next";
import { api } from "../api.js";
import type { AgentActivity, AgentActivityItem } from "../types.js";

const props = defineProps<{ handle: string; activity?: AgentActivity }>();

const history = ref<AgentActivityItem[] | null>(null);
const error = ref<string | null>(null);

function load() {
  error.value = null;
  api.agentActivity(props.handle).then((v) => { history.value = v; }).catch((e) => { error.value = (e as Error).message; });
}

// 初次加载 + handle 变化时重拉
watch(() => props.handle, () => { history.value = null; load(); }, { immediate: true });

// 实时活动到来时刷新历史(落库是异步的,延后再拉)
let t: ReturnType<typeof setTimeout> | null = null;
watch(() => props.activity, (a) => {
  if (!a) return;
  if (t) clearTimeout(t);
  t = setTimeout(load, 800);
});
onUnmounted(() => { if (t) clearTimeout(t); });

const ts = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-US"); };
</script>

<template>
  <div class="activity-log" data-testid="agent-activity">
    <div class="act-toolbar">
      <span class="profile-sect" :style="{ margin: '0' }">ACTIVITY</span>
      <span class="grow" />
      <button class="nb-btn" data-testid="activity-refresh" @click="load"><RefreshCw :size="13" /></button>
    </div>

    <div v-if="activity" class="act-row live" data-testid="activity-live">
      <span class="dot on" />
      <span class="act-kind">{{ activity.activity }}</span>
      <span class="act-detail">{{ activity.detail }}</span>
      <span class="act-time">live</span>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>
    <div v-if="history === null && !error" class="fake" :style="{ padding: '8px' }">Loading…</div>
    <div v-if="history?.length === 0 && !activity" class="activity-empty"><ActivityIcon :size="28" /><div>No activity yet</div>
      <div class="fake">Activity is recorded when this agent works in a channel.</div>
    </div>
    <div v-for="h in (history ?? [])" :key="h.id" class="act-row" data-testid="activity-row">
      <span class="dot idle" />
      <span class="act-kind">{{ h.activity }}</span>
      <span class="act-detail">{{ h.detail }}</span>
      <span class="act-time">{{ ts(h.createdAt) }}</span>
    </div>
  </div>
</template>
