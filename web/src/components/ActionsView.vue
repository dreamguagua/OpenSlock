<script setup lang="ts">
/** Action inbox:agent 为 human 准备的待执行动作卡。执行 = 以 human 身份运行(如建频道/agent)。 */

import { ref, watch, onMounted } from "vue";
import { Zap, RefreshCw, Check, X } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import { api } from "../api.js";
import type { ActionCard } from "../types.js";

const props = defineProps<{ reloadKey?: number; onChanged?: () => void }>();

const KIND_LABEL: Record<string, string> = {
  "channel:create": "Create channel",
  "agent:create": "Create agent",
};

function summarize(c: ActionCard): string {
  const p = c.payload;
  if (c.kind === "channel:create") return `#${String(p.name ?? "?")}${p.isPrivate ? " (private)" : ""}`;
  if (c.kind === "agent:create") return `@${String(p.handle ?? "?")} — ${String(p.displayName ?? "")}`;
  return JSON.stringify(p);
}

const items = ref<ActionCard[] | null>(null);
const error = ref<string | null>(null);
const busy = ref<string | null>(null);

function load() {
  error.value = null;
  api.actions().then((v) => { items.value = v; }).catch((e) => { error.value = (e as Error).message; });
}
onMounted(load);
watch(() => props.reloadKey, load);

async function act(id: string, kind: "execute" | "dismiss") {
  busy.value = id; error.value = null;
  try {
    await (kind === "execute" ? api.executeAction(id) : api.dismissAction(id));
    load();
    props.onChanged?.();
  } catch (e) {
    error.value = (e as Error).message;
  } finally { busy.value = null; }
}
</script>

<template>
  <div class="activity-view" data-testid="actions-view">
    <div class="act-toolbar" :style="{ padding: '8px 16px' }">
      <span class="profile-sect" :style="{ margin: '0' }">ACTIONS</span>
      <span class="grow" />
      <button class="nb-btn" data-testid="actions-refresh" @click="load"><RefreshCw :size="13" /></button>
    </div>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <div v-if="items === null && !error" class="placeholder"><div class="fake">Loading…</div></div>
    <div v-if="items?.length === 0" class="placeholder"><div class="big">No pending actions</div><div class="fake">Agents can prepare actions (e.g. create a channel) for you to approve here.</div></div>
    <div class="act-feed">
      <div v-for="c in (items ?? [])" :key="c.id" class="act-item" data-testid="action-item" :style="{ cursor: 'default' }">
        <span class="act-ic"><Zap :size="16" /></span>
        <Avatar :type="c.preparedBy.type === 'agent' ? 'agent' : 'human'" :id="c.preparedBy.id" :size="26" />
        <div class="act-main">
          <div class="act-line1">
            <b>{{ KIND_LABEL[c.kind] ?? c.kind }}</b>
            <span class="act-kindtag">prepared by @{{ c.preparedBy.id }}</span>
          </div>
          <div class="act-text">{{ summarize(c) }}</div>
        </div>
        <div :style="{ display: 'flex', gap: '6px' }">
          <button class="nb-btn primary" data-testid="action-execute" :disabled="busy === c.id" @click="act(c.id, 'execute')"><Check :size="13" /> Execute</button>
          <button class="nb-btn" data-testid="action-dismiss" :disabled="busy === c.id" @click="act(c.id, 'dismiss')"><X :size="13" /></button>
        </div>
      </div>
    </div>
  </div>
</template>
