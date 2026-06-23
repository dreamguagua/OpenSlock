<script setup lang="ts">
/** 电脑详情(主面板):头部 + NAME(可改名)+ INFO + DETECTED RUNTIMES + CONNECTION
 *  + AGENTS ON THIS COMPUTER。 */

import { ref, watch } from "vue";
import { Monitor, Pencil, Check, RefreshCw, Copy, Plus, Trash2 } from "lucide-vue-next";
import Avatar from "./Avatar.vue";
import { api } from "../api.js";
import type { AgentProfile, AgentStatusInfo, Machine } from "../types.js";

const props = defineProps<{
  machine: Machine;
  agentStatus: Record<string, AgentStatusInfo>;
  onRename: (id: string, name: string) => Promise<Machine>;
  onDelete: (id: string) => Promise<void>;
  onCreateAgent: () => void;
  // 父级在「创建 agent 后」自增此值,触发本机 agent 列表重拉(AgentProfile 才带 machineId/runtime,故单独拉)
  reloadKey?: number;
}>();

const agents = ref<AgentProfile[]>([]);
const editing = ref(false);
const name = ref(props.machine.name);
const command = ref<string | null>(null);
const genBusy = ref(false);
const confirmDelete = ref(false);
const deleting = ref(false);

const loadAgents = () => {
  api.agents().then((all) => { agents.value = all.filter((a) => a.machineId === props.machine.id); }).catch(() => {});
};

watch([() => props.machine.id, () => props.machine.name, () => props.reloadKey], () => {
  name.value = props.machine.name; editing.value = false; command.value = null; confirmDelete.value = false;
  loadAgents();
}, { immediate: true });

const doDelete = async () => {
  if (deleting.value) return;
  deleting.value = true;
  try { await props.onDelete(props.machine.id); confirmDelete.value = false; }
  catch { /* 失败保留弹窗 */ }
  finally { deleting.value = false; }
};

const generate = async () => {
  if (genBusy.value) return;
  genBusy.value = true;
  try { command.value = (await api.connectCommand(props.machine.id)).connectCommand; }
  catch { /* 忽略 */ }
  finally { genBusy.value = false; }
};
const copyCmd = () => { if (command.value) void navigator.clipboard?.writeText(command.value).catch(() => {}); };

const saveName = async () => {
  const next = name.value.trim();
  if (next && next !== props.machine.name) await props.onRename(props.machine.id, next);
  editing.value = false;
};

const createdStr = () => {
  const created = new Date(props.machine.createdAt);
  return Number.isNaN(created.getTime())
    ? props.machine.createdAt
    : created.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
};
</script>

<template>
  <div class="agent-detail" data-testid="machine-detail">
    <div class="ch-head">
      <span class="mono-icon big"><Monitor :size="22" /></span>
      <div>
        <div class="nm">{{ machine.name }}</div>
        <div class="desc">
          <span :class="`dot ${machine.status === 'online' ? 'on' : 'idle'}`" /> {{ machine.status === "online" ? "Connected" : "Offline" }}{{ machine.hostname ? ` · ${machine.hostname}` : "" }}
        </div>
      </div>
    </div>

    <div class="agent-pane">
      <div class="profile" :style="{ maxWidth: '720px' }">
        <div class="field-block">
          <div class="field-label">NAME</div>
          <div v-if="editing" class="inline-edit">
            <input data-testid="machine-name-input" v-model="name" autofocus @keydown.enter="saveName" />
            <button class="nb-btn" data-testid="machine-name-save" @click="saveName"><Check :size="14" /></button>
          </div>
          <div v-else class="field-value">
            {{ machine.name }}
            <button class="icon-btn" data-testid="machine-rename" title="Rename" @click="editing = true">
              <Pencil :size="13" />
            </button>
          </div>
        </div>

        <div class="profile-sect">INFO</div>
        <div class="kv">
          <div class="k">OS</div>
          <div class="v"><template v-if="machine.os">{{ machine.os }}</template><span v-else class="fake">Not reported</span></div>
          <div class="k">Daemon Version</div>
          <div class="v"><template v-if="machine.daemonVersion">{{ machine.daemonVersion }}</template><span v-else class="fake">Not connected</span></div>
          <div class="k">Created</div>
          <div class="v">{{ createdStr() }}</div>
          <div class="k">Token</div>
          <div class="v"><code>{{ machine.tokenPrefix ?? "—" }}…</code></div>
        </div>

        <div class="profile-sect">DETECTED RUNTIMES</div>
        <div class="badges">
          <span v-if="machine.runtimes.length === 0" class="fake">Not reported (detected once the daemon connects)</span>
          <span v-for="r in machine.runtimes" :key="r" class="rt-badge runtime">{{ r }}</span>
        </div>

        <div class="profile-sect">CONNECTION</div>
        <button v-if="machine.status !== 'online' && !command" class="nb-btn primary" data-testid="generate-command" @click="generate" :disabled="genBusy">
          <RefreshCw :size="14" /> {{ genBusy ? "Generating…" : "Generate Connect Command" }}
        </button>
        <div v-if="machine.status === 'online' && !command" class="fake">This computer is connected; to reconnect elsewhere, regenerate the command below.
          <div :style="{ marginTop: '8px' }">
            <button class="nb-btn" data-testid="generate-command" @click="generate" :disabled="genBusy">
              <RefreshCw :size="13" /> {{ genBusy ? "Generating…" : "Regenerate Connect Command" }}
            </button>
          </div>
        </div>
        <template v-if="command">
          <div class="connect-hint">Run this command in the terminal of that computer to connect:</div>
          <div class="cmd-box">
            <code data-testid="machine-connect-command">{{ command }}</code>
            <button class="nb-btn" title="Copy" @click="copyCmd"><Copy :size="13" /></button>
          </div>
          <div class="fake" :style="{ marginTop: '6px' }">Once run, this computer comes online and reports its OS / runtimes. Regenerating invalidates the old command.</div>
        </template>

        <div class="profile-sect profile-sect-row">
          <span>AGENTS ON THIS COMPUTER {{ agents.length }}</span>
          <button class="nb-btn" data-testid="machine-create-agent" title="Create an agent on this computer" @click="onCreateAgent">
            <Plus :size="13" /> Create
          </button>
        </div>
        <div v-if="agents.length === 0" class="fake">No agents are running on this computer yet</div>
        <div v-for="a in agents" :key="a.handle" class="member-row" data-testid="machine-agent-row" :style="{ cursor: 'default' }">
          <Avatar type="agent" :id="a.handle" :size="26" :status="agentStatus[a.handle]?.kind" />
          <span class="nm">{{ a.displayName }}</span>
          <span class="member-sub">{{ a.runtime }}{{ a.model ? ` · ${a.model}` : "" }}</span>
        </div>

        <div class="profile-sect">ACTIONS</div>
        <button class="nb-btn danger" data-testid="machine-delete" @click="confirmDelete = true">
          <Trash2 :size="13" /> Delete Computer
        </button>
        <div class="fake" :style="{ marginTop: '6px' }">
          Permanently remove this computer. Agents on it will be unassigned (their machine cleared), not deleted.
        </div>
      </div>
    </div>

    <div v-if="confirmDelete" class="modal-overlay" data-testid="machine-delete-confirm" @click="confirmDelete = false">
      <div class="modal" :style="{ maxWidth: '420px' }" @click.stop>
        <div class="modal-head">Delete Computer</div>
        <div class="modal-body">
          <p>Permanently delete <strong>{{ machine.name }}</strong>? This cannot be undone.</p>
          <p v-if="agents.length" class="fake">
            {{ agents.length }} agent{{ agents.length > 1 ? "s" : "" }} on this computer will be unassigned (not deleted) — reassign {{ agents.length > 1 ? "them" : "it" }} to another computer later.
          </p>
        </div>
        <div class="modal-foot">
          <button class="nb-btn" @click="confirmDelete = false" :disabled="deleting">Cancel</button>
          <button class="nb-btn danger" data-testid="machine-delete-confirm-btn" @click="doDelete" :disabled="deleting">
            {{ deleting ? "Deleting…" : "Delete Computer" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
