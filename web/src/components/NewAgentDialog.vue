<script setup lang="ts">
/** Create Agent dialog —— 单一 NAME 字段(@mention handle 自动派生)+ Computer / Description /
 *  Runtime / Model。后端为真相源(重名 → 409,非法 → 400)。 */

import { ref, computed } from "vue";
import ModelPicker from "./ModelPicker.vue";
import RuntimeConfigFields from "./RuntimeConfigFields.vue";
import { DEFAULT_RT, type RtConfig } from "./runtimeConfig.js";
import type { Machine, NewAgentInput, AgentProfile } from "../types.js";

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;

const RUNTIMES: ReadonlyArray<readonly [string, string]> = [
  ["claude", "Claude Code"],
  ["codex", "Codex CLI"],
  ["cursor", "Cursor CLI"],
  ["gemini", "Gemini CLI"],
  ["opencode", "OpenCode"],
];

/** 从显示名派生 @mention handle(小写 ascii slug)。 */
function deriveHandle(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 31);
}

const props = defineProps<{
  machines: Machine[];
  preselectedMachineId?: string;
  onCreate: (input: NewAgentInput) => Promise<AgentProfile>;
  onClose: () => void;
  onCreated: (handle: string) => void;
}>();

const name = ref("");
const description = ref("");
const avatarUrl = ref("");
const runtime = ref("claude");
const model = ref("");
const machineId = ref(props.preselectedMachineId ?? ""); // 从电脑详情页打开时预选本机
const rt = ref<RtConfig>({ ...DEFAULT_RT });
const error = ref<string | null>(null);
const busy = ref(false);

const handle = computed(() => deriveHandle(name.value));
const valid = computed(() => HANDLE_RE.test(handle.value));
const setModel = (v: string) => { model.value = v; };
const setRt = (next: RtConfig) => { rt.value = next; };

const submit = async () => {
  if (!valid.value || busy.value) return;
  busy.value = true; error.value = null;
  try {
    const created = await props.onCreate({
      handle: handle.value,
      displayName: name.value.trim(),
      runtime: runtime.value,
      ...(description.value.trim() ? { description: description.value.trim() } : {}),
      ...(avatarUrl.value.trim() ? { avatarUrl: avatarUrl.value.trim() } : {}),
      ...(model.value.trim() ? { model: model.value.trim() } : {}),
      ...(machineId.value ? { machineId: machineId.value } : {}),
      provider: rt.value.provider, reasoning: rt.value.reasoning, fastMode: rt.value.fastMode,
      ...(rt.value.provider === "custom" ? { providerBaseUrl: rt.value.providerBaseUrl.trim() || null, providerApiKey: rt.value.providerApiKey.trim() || null } : {}),
    });
    props.onCreated(created.handle);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <div class="modal-overlay" data-testid="new-agent-dialog" @click="onClose">
    <div class="modal" @click.stop>
      <div class="modal-head">Create Agent</div>
      <div class="modal-body">
        <label>Computer <span class="hint">(which machine runs it; blank = unassigned)</span></label>
        <select data-testid="agent-machine-select" v-model="machineId">
          <option value="">Unassigned (assign later)</option>
          <option v-for="m in machines" :key="m.id" :value="m.id">{{ m.name }}{{ m.status === "online" ? " ● online" : " ○ offline" }}</option>
        </select>
        <div v-if="machines.length === 0" class="field-warn">No computers yet — add one in the Computers panel first.</div>

        <label>Name</label>
        <input data-testid="agent-name-input" placeholder="e.g. Alice" autofocus v-model="name" @keydown.enter="submit" />
        <template v-if="name.trim()">
          <div v-if="valid" class="field-hint" data-testid="derived-handle">Mentioned as <code>@{{ handle }}</code></div>
          <div v-else class="field-warn">Use latin letters/numbers so it can be @mentioned</div>
        </template>

        <label>Description <span class="hint">(optional)</span></label>
        <textarea
          class="modal-textarea" data-testid="agent-desc-input" :rows="4" :maxlength="3000"
          placeholder="Leave blank for a general-purpose agent, or describe a role…"
          v-model="description"
        />
        <div class="char-count">{{ description.length }}/3000</div>

        <label>Avatar URL <span class="hint">(optional)</span></label>
        <input data-testid="agent-avatar-input" placeholder="https://…/avatar.png" v-model="avatarUrl" />

        <label>Runtime</label>
        <select data-testid="agent-runtime-select" v-model="runtime">
          <option v-for="[v, label] in RUNTIMES" :key="v" :value="v">{{ label }}</option>
        </select>

        <label>Model <span class="hint">(optional, defaults to daemon)</span></label>
        <ModelPicker :value="model" :onChange="setModel" testid="agent-model-input" />

        <RuntimeConfigFields :value="rt" :onChange="setRt" />
        <div v-if="error" class="gate-error" data-testid="new-agent-error">{{ error }}</div>
      </div>
      <div class="modal-foot">
        <button class="nb-btn" @click="onClose" :disabled="busy">Cancel</button>
        <button class="nb-btn primary" data-testid="agent-create-submit" @click="submit" :disabled="!valid || busy">
          {{ busy ? "Creating…" : "Create Agent" }}
        </button>
      </div>
    </div>
  </div>
</template>
