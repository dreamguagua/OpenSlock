<script setup lang="ts">
/** Agent 详情 — Profile 编辑表单(显示名/描述/runtime/model/computer/运行时配置)+ 删除。 */

import { ref, computed } from "vue";
import { Trash2 } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import ModelPicker from "./ModelPicker.vue";
import RuntimeConfigFields from "./RuntimeConfigFields.vue";
import type { RtConfig } from "./runtimeConfig.js";
import type { AgentPatch, AgentProfile, Machine } from "../types.js";

const props = defineProps<{
  agent: AgentProfile;
  machines: Machine[];
  onSave: (patch: AgentPatch) => Promise<void>;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}>();

const RUNTIMES: ReadonlyArray<readonly [string, string]> = [
  ["claude", "Claude Code"],
  ["codex", "Codex CLI"],
  ["cursor", "Cursor CLI"],
  ["gemini", "Gemini CLI"],
  ["opencode", "OpenCode"],
];

const displayName = ref(props.agent.displayName);
const description = ref(props.agent.description);
const avatarUrl = ref(props.agent.avatarUrl ?? "");
const runtime = ref(props.agent.runtime);
const model = ref(props.agent.model ?? "");
const machineId = ref(props.agent.machineId ?? "");
const rt = ref<RtConfig>({
  provider: props.agent.provider, providerBaseUrl: props.agent.providerBaseUrl ?? "", providerApiKey: props.agent.providerApiKey ?? "",
  reasoning: props.agent.reasoning, fastMode: props.agent.fastMode,
});
const busy = ref(false);
const error = ref<string | null>(null);
const confirmDel = ref(false);

const runtimeIsCustom = computed(() => !RUNTIMES.some(([v]) => v === runtime.value));
const setModel = (v: string) => { model.value = v; };
const setRt = (next: RtConfig) => { rt.value = next; };

const save = async () => {
  if (!displayName.value.trim() || busy.value) return;
  busy.value = true; error.value = null;
  try {
    await props.onSave({
      displayName: displayName.value.trim(),
      description: description.value.trim(),
      avatarUrl: avatarUrl.value.trim() ? avatarUrl.value.trim() : null,
      runtime: runtime.value,
      model: model.value.trim() ? model.value.trim() : null,
      machineId: machineId.value || null,
      provider: rt.value.provider, reasoning: rt.value.reasoning, fastMode: rt.value.fastMode,
      providerBaseUrl: rt.value.provider === "custom" ? (rt.value.providerBaseUrl.trim() || null) : null,
      providerApiKey: rt.value.provider === "custom" ? (rt.value.providerApiKey.trim() || null) : null,
    });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};

const del = async () => {
  busy.value = true; error.value = null;
  try { await props.onDelete(); }
  catch (e) { error.value = (e as Error).message; busy.value = false; }
};
</script>

<template>
  <div class="profile" data-testid="agent-profile-edit">
    <div class="profile-hero">
      <Avatar type="agent" :id="agent.handle" :size="64" :url="avatarUrl" />
      <div><div class="hero-handle">@{{ agent.handle }} <span class="fake">(handle is fixed)</span></div></div>
    </div>

    <label class="edit-label">DISPLAY NAME</label>
    <input class="edit-input" data-testid="edit-name" v-model="displayName" />

    <label class="edit-label">AVATAR URL <span class="fake">(optional)</span></label>
    <input class="edit-input" data-testid="edit-avatar" placeholder="https://…/avatar.png" v-model="avatarUrl" />

    <label class="edit-label">DESCRIPTION</label>
    <textarea
      class="edit-input edit-textarea" data-testid="edit-desc" :rows="4" :maxlength="3000"
      placeholder="Leave blank for a general-purpose agent, or describe a role…"
      v-model="description"
    />
    <div class="char-count">{{ description.length }}/3000</div>

    <label class="edit-label">COMPUTER</label>
    <select class="edit-input" data-testid="edit-machine" v-model="machineId">
      <option value="">Unassigned</option>
      <option v-for="m in machines" :key="m.id" :value="m.id">{{ m.name }}{{ m.status === "online" ? " ● online" : " ○ offline" }}</option>
    </select>

    <label class="edit-label">RUNTIME</label>
    <select class="edit-input" data-testid="edit-runtime" v-model="runtime">
      <option v-for="[v, label] in RUNTIMES" :key="v" :value="v">{{ label }}</option>
      <option v-if="runtimeIsCustom" :value="runtime">{{ runtime }}</option>
    </select>

    <label class="edit-label">MODEL <span class="hint">(optional)</span></label>
    <ModelPicker :value="model" :onChange="setModel" controlClass="edit-input" testid="edit-model" />

    <RuntimeConfigFields :value="rt" :onChange="setRt" controlClass="edit-input" />

    <div v-if="error" class="gate-error" data-testid="agent-edit-error">{{ error }}</div>

    <div class="edit-actions">
      <button class="nb-btn primary" data-testid="agent-save" :disabled="busy || !displayName.trim()" @click="save">
        {{ busy ? "Saving…" : "Save" }}
      </button>
      <button class="nb-btn" @click="onCancel" :disabled="busy">Cancel</button>
      <span class="grow" />
      <template v-if="confirmDel">
        <span class="del-confirm">Delete @{{ agent.handle }}?</span>
        <button class="nb-btn danger" data-testid="agent-delete-confirm" :disabled="busy" @click="del">Delete</button>
        <button class="nb-btn" :disabled="busy" @click="confirmDel = false">Keep</button>
      </template>
      <button v-else class="nb-btn danger" data-testid="agent-delete" :disabled="busy" @click="confirmDel = true">
        <Trash2 :size="14" /> Delete
      </button>
    </div>
  </div>
</template>
