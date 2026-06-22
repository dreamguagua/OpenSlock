<script setup lang="ts">
/** Create-channel dialog:name / description / visibility / 初始成员(agents + humans)。 */

import { ref, computed } from "vue";
import { Search, Check, Hash, Lock } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import type { Member } from "../types.js";

type Picked = { type: "agent" | "human"; id: string };

const props = defineProps<{
  agents: Member[];
  humans: Member[];
  onCreate: (input: { name: string; description?: string; isPrivate?: boolean; members?: Picked[] }) => Promise<string>;
  onClose: () => void;
  onCreated: () => void;
}>();

const name = ref("");
const description = ref("");
const isPrivate = ref(false);
const query = ref("");
const picked = ref<Picked[]>([]);
const busy = ref(false);
const error = ref<string | null>(null);

const candidates = computed(() => {
  const q = query.value.trim().toLowerCase();
  const tag = (m: Member, kind: "agent" | "human") => ({ kind, handle: m.handle, displayName: m.displayName, avatarUrl: m.avatarUrl });
  const all = [...props.agents.map((a) => tag(a, "agent")), ...props.humans.map((h) => tag(h, "human"))];
  return q ? all.filter((m) => m.displayName.toLowerCase().includes(q) || m.handle.toLowerCase().includes(q)) : all;
});

const isPicked = (kind: "agent" | "human", id: string) => picked.value.some((p) => p.type === kind && p.id === id);
const toggle = (kind: "agent" | "human", id: string) => {
  picked.value = isPicked(kind, id)
    ? picked.value.filter((p) => !(p.type === kind && p.id === id))
    : [...picked.value, { type: kind, id }];
};

const submit = async () => {
  if (!name.value.trim() || busy.value) return;
  busy.value = true; error.value = null;
  try {
    await props.onCreate({
      name: name.value.trim(),
      ...(description.value.trim() ? { description: description.value.trim() } : {}),
      isPrivate: isPrivate.value,
      ...(picked.value.length ? { members: picked.value } : {}),
    });
    props.onCreated();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <div class="modal-overlay" data-testid="new-channel-dialog" @click="onClose">
    <div class="modal" @click.stop>
      <div class="modal-head">Create Channel</div>
      <div class="modal-body">
        <label>Name <span class="req">*</span></label>
        <input data-testid="channel-name-input" placeholder="e.g. ai-research" autofocus v-model="name" @keydown.enter="submit" />

        <label>Description <span class="hint">(optional)</span></label>
        <textarea
          class="modal-textarea" data-testid="channel-desc-input" :rows="4" :maxlength="2000"
          placeholder="What is this channel about?"
          v-model="description"
        />

        <label>Visibility</label>
        <div class="seg" data-testid="channel-visibility">
          <button type="button" :class="`seg-btn ${!isPrivate ? 'active' : ''}`" data-testid="vis-public" @click="isPrivate = false">
            <Hash :size="14" /> Public
          </button>
          <button type="button" :class="`seg-btn ${isPrivate ? 'active' : ''}`" data-testid="vis-private" @click="isPrivate = true">
            <Lock :size="13" /> Private
          </button>
        </div>

        <label>Members <span class="hint">(optional)</span></label>
        <div class="member-search">
          <Search :size="14" />
          <input data-testid="member-search" placeholder="Search members by name" v-model="query" />
        </div>
        <div class="member-picklist" data-testid="member-picklist">
          <div v-if="candidates.length === 0" class="fake" :style="{ padding: '8px 10px' }">No matches</div>
          <button
            v-for="m in candidates"
            :key="`${m.kind}:${m.handle}`"
            type="button"
            :class="`member-pick ${isPicked(m.kind, m.handle) ? 'on' : ''}`"
            data-testid="member-pick"
            @click="toggle(m.kind, m.handle)"
          >
            <Avatar :type="m.kind" :id="m.handle" :size="24" :url="m.avatarUrl" />
            <span class="mp-name">{{ m.displayName }}</span>
            <span class="mp-kind">{{ m.kind }}</span>
            <Check v-if="isPicked(m.kind, m.handle)" :size="15" class="mp-check" />
          </button>
        </div>
        <div v-if="picked.length > 0" class="field-hint" data-testid="member-count">{{ picked.length }} member{{ picked.length === 1 ? "" : "s" }} selected (you'll be the owner)</div>

        <div v-if="error" class="gate-error" data-testid="new-channel-error">{{ error }}</div>
      </div>
      <div class="modal-foot">
        <button class="nb-btn" @click="onClose" :disabled="busy">Cancel</button>
        <button class="nb-btn primary" data-testid="channel-create-submit" @click="submit" :disabled="!name.trim() || busy">
          {{ busy ? "Creating…" : "Create Channel" }}
        </button>
      </div>
    </div>
  </div>
</template>
