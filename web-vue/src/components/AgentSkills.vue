<script setup lang="ts">
/** Profile 里的 SKILLS 区:按 scope 分 Workspace / Global 两组卡片。 */

import { ref, computed, watch } from "vue";
import { api } from "../api.js";
import type { SkillInfo } from "../types.js";

const props = defineProps<{ handle: string }>();

const skills = ref<SkillInfo[] | null>(null);
const error = ref<string | null>(null);

watch(() => props.handle, (h) => {
  skills.value = null; error.value = null;
  api.agentSkills(h).then((s) => { skills.value = s; }).catch((e) => { error.value = (e as Error).message; });
}, { immediate: true });

const ws = computed(() => skills.value?.filter((s) => s.scope === "workspace") ?? []);
const global = computed(() => skills.value?.filter((s) => s.scope === "global") ?? []);
const groups = computed(() => [
  { label: "Workspace", testid: "skills-workspace", items: ws.value },
  { label: "Global", testid: "skills-global", items: global.value },
]);
</script>

<template>
  <div class="profile-sect">SKILLS {{ skills ? `(${skills.length})` : "" }}</div>
  <div v-if="error" class="fake" data-testid="skills-note">{{ error }}</div>
  <div v-if="!error && skills === null" class="fake">Loading…</div>
  <div v-if="!error && skills && skills.length === 0" class="fake">No skills detected</div>
  <template v-for="g in groups" :key="g.label">
    <div v-if="g.items.length > 0" class="skill-group" :data-testid="g.testid">
      <div class="skill-group-head">{{ g.label }} <span class="count">({{ g.items.length }})</span></div>
      <div class="skill-cards">
        <div v-for="s in g.items" :key="`${s.scope}:${s.name}`" class="skill-card" data-testid="skill-card">
          <div class="skill-name">{{ s.name }}</div>
          <div v-if="s.description" class="skill-desc">{{ s.description }}</div>
        </div>
      </div>
    </div>
  </template>
</template>
