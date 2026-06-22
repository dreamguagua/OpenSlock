<script setup lang="ts">
/** Channel members panel:列出成员+角色,添加任意 agent/human,移除成员,或离开频道。 */

import { ref, computed, watch } from "vue";
import { Plus, X } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import { api } from "../api.js";
import type { ChannelMember, Member } from "../types.js";

const props = defineProps<{
  channelId: string;
  channelName: string;
  joined: boolean;
  agents: Member[];
  humans: Member[];
  onLeave: (channelId: string) => Promise<void>;
  onAdd: (channelId: string, member: { type: "agent" | "human"; id: string }) => Promise<ChannelMember[]>;
  onRemove: (channelId: string, member: { type: "agent" | "human"; id: string }) => Promise<ChannelMember[]>;
  onClose: () => void;
}>();

const members = ref<ChannelMember[] | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const adding = ref(false);

watch(() => props.channelId, (id) => {
  members.value = null; error.value = null;
  api.channelMembers(id).then((m) => { members.value = m; }).catch((e) => { error.value = (e as Error).message; });
}, { immediate: true });

const nameOf = (type: ChannelMember["memberType"], id: string): string => {
  if (type === "agent") return props.agents.find((a) => a.handle === id)?.displayName ?? id;
  if (type === "human") return props.humans.find((h) => h.handle === id)?.displayName ?? id;
  return id;
};

// 候选 = 工作区里尚未加入本频道的 agent / human
const candidates = computed(() => {
  const present = new Set((members.value ?? []).map((m) => `${m.memberType}:${m.memberId}`));
  const agents = props.agents
    .filter((a) => !present.has(`agent:${a.handle}`))
    .map((a) => ({ type: "agent" as const, id: a.handle, name: a.displayName }));
  const humans = props.humans
    .filter((h) => !present.has(`human:${h.handle}`))
    .map((h) => ({ type: "human" as const, id: h.handle, name: h.displayName }));
  return [...agents, ...humans];
});

const mutate = async (fn: () => Promise<ChannelMember[]>) => {
  busy.value = true; error.value = null;
  try { members.value = await fn(); }
  catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
};

const leave = async () => {
  busy.value = true;
  try { await props.onLeave(props.channelId); props.onClose(); }
  finally { busy.value = false; }
};
</script>

<template>
  <div class="modal-overlay" data-testid="channel-members-dialog" @click="onClose">
    <div class="modal" @click.stop>
      <div class="modal-head">Members — #{{ channelName }}</div>
      <div class="modal-body">
        <div v-if="error" class="gate-error">{{ error }}</div>
        <div v-if="members === null && !error" class="fake">Loading…</div>
        <div v-if="members?.length === 0" class="fake">No members</div>
        <div
          v-for="m in (members ?? [])"
          :key="`${m.memberType}:${m.memberId}`"
          class="member-row"
          :style="{ cursor: 'default' }"
          data-testid="channel-member"
        >
          <Avatar v-if="m.memberType !== 'system'" :type="m.memberType" :id="m.memberId" :size="26" />
          <span class="nm">{{ nameOf(m.memberType, m.memberId) }}</span>
          <span class="member-sub">{{ m.role }}</span>
          <span class="grow" />
          <button
            v-if="m.memberType !== 'system' && m.role !== 'owner'"
            class="hbtn icon" data-testid="member-remove" title="Remove from channel" :disabled="busy"
            @click="mutate(() => onRemove(channelId, { type: m.memberType as 'agent' | 'human', id: m.memberId }))"
          ><X :size="14" /></button>
        </div>

        <template v-if="members !== null">
          <div v-if="adding" class="member-add" data-testid="member-add-list">
            <div class="member-sub" :style="{ padding: '6px 2px' }">Add agent or human</div>
            <div v-if="candidates.length === 0" class="fake">Everyone is already a member</div>
            <div v-for="cand in candidates" :key="`${cand.type}:${cand.id}`" class="member-row">
              <Avatar :type="cand.type" :id="cand.id" :size="26" />
              <span class="nm">{{ cand.name }}</span>
              <span class="member-sub">{{ cand.type }}</span>
              <span class="grow" />
              <button class="nb-btn" data-testid="member-add" :disabled="busy" @click="mutate(() => onAdd(channelId, { type: cand.type, id: cand.id }))">Add</button>
            </div>
            <button class="nb-btn" :style="{ marginTop: '6px' }" @click="adding = false">Done</button>
          </div>
          <button v-else class="nb-btn" data-testid="member-add-toggle" :style="{ marginTop: '8px' }" @click="adding = true">
            <Plus :size="14" /> Add member
          </button>
        </template>
      </div>
      <div class="modal-foot">
        <button v-if="joined" class="nb-btn danger" data-testid="channel-leave" :disabled="busy" @click="leave">
          Leave channel
        </button>
        <span class="grow" />
        <button class="nb-btn" @click="onClose">Close</button>
      </div>
    </div>
  </div>
</template>
