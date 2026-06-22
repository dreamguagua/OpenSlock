<script setup lang="ts">
/** Agent 详情 — Profile 只读页:hero + 字段 + INFO + RUNTIME CONFIG + SKILLS。 */

import { computed } from "vue";
import Avatar from "./Avatar.vue";
import Field from "./Field.vue";
import AgentSkills from "./AgentSkills.vue";
import type { AgentProfile, AgentStatusInfo, Machine } from "../types.js";

const props = defineProps<{ agent: AgentProfile; status: AgentStatusInfo; machines: Machine[] }>();

const createdStr = computed(() => {
  const created = new Date(props.agent.createdAt);
  return Number.isNaN(created.getTime())
    ? props.agent.createdAt
    : created.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
});
const comp = computed(() => {
  const id = props.agent.machineId;
  if (!id) return null;
  return props.machines.find((m) => m.id === id)?.name ?? id;
});
</script>

<template>
  <div class="profile" data-testid="agent-profile">
    <div class="profile-hero">
      <Avatar type="agent" :id="agent.handle" :size="64" :status="status.kind" :url="agent.avatarUrl" />
      <div>
        <div class="hero-name">{{ agent.displayName }} <span :class="`dot ${status.kind}`" /> <span class="hero-status">{{ status.label }}</span></div>
        <div class="hero-handle">@{{ agent.handle }}</div>
      </div>
    </div>

    <Field label="DISPLAY NAME">{{ agent.displayName }}</Field>
    <Field label="DESCRIPTION"><template v-if="agent.description">{{ agent.description }}</template><span v-else class="fake">No description</span></Field>

    <div class="profile-sect">INFO</div>
    <div class="kv">
      <div class="k">Computer</div>
      <div class="v"><template v-if="comp">{{ comp }}</template><span v-else class="fake">Unassigned</span></div>
      <div class="k">Created</div>
      <div class="v">{{ createdStr }}</div>
    </div>

    <div class="profile-sect">RUNTIME CONFIG</div>
    <div class="badges">
      <span class="rt-badge runtime">{{ agent.runtime }}</span>
      <span class="rt-badge model">{{ agent.model ?? "Default model" }}</span>
      <span class="rt-badge">Provider: {{ agent.provider === "custom" ? "Custom (BYOC)" : "Default" }}</span>
      <span class="rt-badge">Reasoning: {{ agent.reasoning }}</span>
      <span v-if="agent.fastMode" class="rt-badge">Fast mode</span>
    </div>

    <AgentSkills :handle="agent.handle" />
  </div>
</template>
