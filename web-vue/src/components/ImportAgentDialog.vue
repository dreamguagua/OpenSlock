<script setup lang="ts">
/** Import raft agent dialog —— 指向选定电脑上已有的 raft agent 工作区;Name/Description
 *  从工作区 MEMORY.md 自动读取(输入路径后反填),仍可手改覆盖。 */

import { ref } from "vue";
import { Check } from "lucide-vue-next";
import { api } from "../api.js";
import type { Machine, ImportRaftInput, AgentProfile } from "../types.js";

const props = defineProps<{
  machines: Machine[];
  onImport: (input: ImportRaftInput) => Promise<AgentProfile>;
  onClose: () => void;
  onImported: (handle: string) => void;
}>();

const machineId = ref(props.machines[0]?.id ?? "");
const raftPath = ref("");
const name = ref("");
const description = ref("");
const edited = ref(false); // 用户是否手改过 → 不再被自动反填覆盖
const inspecting = ref(false);
const inspectedFiles = ref<number | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

const valid = () => Boolean(machineId.value) && raftPath.value.trim().length > 0;

// 输入路径后自动读取工作区 MEMORY.md 反填 Name/Description(不建 agent)
const inspect = async () => {
  if (!machineId.value || raftPath.value.trim().length === 0 || busy.value) return;
  inspecting.value = true; error.value = null; inspectedFiles.value = null;
  try {
    const r = await api.inspectRaftAgent({ machineId: machineId.value, raftPath: raftPath.value.trim() });
    inspectedFiles.value = r.fileCount;
    if (!edited.value) { name.value = r.name; description.value = r.description; } // 未手改才覆盖
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    inspecting.value = false;
  }
};

const submit = async () => {
  if (!valid() || busy.value) return;
  busy.value = true; error.value = null;
  try {
    const created = await props.onImport({
      machineId: machineId.value,
      raftPath: raftPath.value.trim(),
      ...(name.value.trim() ? { name: name.value.trim() } : {}),
      ...(description.value.trim() ? { description: description.value.trim() } : {}),
    });
    props.onImported(created.handle);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};

const onMachineChange = () => { inspectedFiles.value = null; };
const onPathInput = () => { inspectedFiles.value = null; };
const onPathEnter = (e: KeyboardEvent) => { e.preventDefault(); void inspect(); };
const onName = (e: Event) => { name.value = (e.target as HTMLInputElement).value; edited.value = true; };
const onDesc = (e: Event) => { description.value = (e.target as HTMLTextAreaElement).value; edited.value = true; };
</script>

<template>
  <div class="modal-overlay" data-testid="import-agent-dialog" @click="onClose">
    <div class="modal" @click.stop>
      <div class="modal-head">Import raft agent</div>
      <div class="modal-body">
        <label>Computer <span class="hint">(where the raft workspace lives)</span></label>
        <select data-testid="import-machine-select" v-model="machineId" @change="onMachineChange">
          <option value="">Select a computer…</option>
          <option v-for="m in machines" :key="m.id" :value="m.id">{{ m.name }}{{ m.status === "online" ? " ● online" : " ○ offline" }}</option>
        </select>
        <div v-if="machines.length === 0" class="field-warn">No computers yet — add one in the Computers panel first.</div>

        <label>Raft agent workspace path</label>
        <input
          data-testid="import-path-input" autofocus
          placeholder="e.g. ~/.slock/agents/<agent-id>"
          v-model="raftPath"
          @input="onPathInput"
          @blur="inspect"
          @keydown.enter="onPathEnter"
        />
        <div class="field-hint">
          Absolute path on the selected computer. <code>MEMORY.md</code>, notes, artifacts and files are copied; raft internals (<code>.git</code>, <code>.slock</code>) are skipped.
        </div>
        <div v-if="inspecting" class="field-hint" data-testid="inspect-status">Reading workspace…</div>
        <div
          v-if="inspectedFiles !== null && !inspecting"
          class="field-hint" data-testid="inspect-ok"
          :style="{ color: 'var(--good, #1a7f37)', display: 'inline-flex', alignItems: 'center', gap: '5px' }"
        >
          <Check :size="13" /> Read from MEMORY.md · {{ inspectedFiles }} item{{ inspectedFiles === 1 ? "" : "s" }} will be copied
        </div>

        <label>Name <span class="hint">(from MEMORY.md — edit to override)</span></label>
        <input data-testid="import-name-input" placeholder="Auto-filled from the workspace" :value="name" @input="onName" />

        <label>Description <span class="hint">(from MEMORY.md — edit to override)</span></label>
        <textarea
          class="modal-textarea" data-testid="import-desc-input" :rows="4" :maxlength="3000"
          placeholder="Auto-filled from the workspace's Role section"
          :value="description" @input="onDesc"
        />

        <div v-if="error" class="gate-error" data-testid="import-agent-error">{{ error }}</div>
      </div>
      <div class="modal-foot">
        <button class="nb-btn" @click="onClose" :disabled="busy">Cancel</button>
        <button class="nb-btn primary" data-testid="import-submit" @click="submit" :disabled="!valid() || busy">
          {{ busy ? "Importing…" : "Import agent" }}
        </button>
      </div>
    </div>
  </div>
</template>
