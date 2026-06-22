<script setup lang="ts">
/** 添加电脑弹窗(两步):
 *  1) 选类型 —— YOUR COMPUTER / CLOUD COMPUTER(占位)→ Next
 *  2) 连接 —— 新建机器拿到「在该电脑终端执行的命令」,展示+复制;轮询直到 online → Done */

import { ref, watch, onUnmounted } from "vue";
import { Monitor, Cloud, Copy, Terminal, CheckCircle2, Loader } from "lucide-vue-next";
import { api } from "../api.js";
import type { CreateMachineResult } from "../types.js";

type Step = "choose" | "connect";

const props = defineProps<{
  onCreate: (name?: string) => Promise<CreateMachineResult>;
  onConnected: (machineId: string) => void;
  onClose: () => void;
}>();

const step = ref<Step>("choose");
const name = ref("");
const result = ref<CreateMachineResult | null>(null);
const online = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const next = async () => {
  if (busy.value) return;
  busy.value = true; error.value = null;
  try {
    const r = await props.onCreate(name.value.trim() || undefined);
    result.value = r;
    step.value = "connect";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};

// 进入 connect 步:轮询该机器在线状态
watch([step, result], () => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (step.value !== "connect" || !result.value) return;
  const id = result.value.machine.id;
  pollTimer = setInterval(async () => {
    try {
      const m = await api.machine(id);
      if (m.status === "online") {
        online.value = true;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      }
    } catch { /* 忽略 */ }
  }, 2000);
});
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer); });

const copy = () => { if (result.value) void navigator.clipboard?.writeText(result.value.connectCommand).catch(() => {}); };
</script>

<template>
  <div class="modal-overlay" data-testid="add-computer-dialog" @click="onClose">
    <div class="modal" @click.stop>
      <div class="modal-head">{{ step === "choose" ? "Add Computer" : "Connect Computer" }}</div>

      <template v-if="step === 'choose'">
        <div class="modal-body">
          <div class="choose-grid">
            <div class="choose-card selected" data-testid="choose-your-computer">
              <Monitor :size="20" />
              <div class="cc-title">YOUR COMPUTER</div>
              <div class="cc-sub">Run agents on your own computer</div>
            </div>
            <div class="choose-card disabled" title="Coming soon">
              <Cloud :size="20" />
              <div class="cc-title">CLOUD COMPUTER</div>
              <div class="cc-sub">Coming soon</div>
            </div>
          </div>
          <label :style="{ marginTop: '14px' }">Computer name <span class="hint">(optional, defaults to hostname)</span></label>
          <input data-testid="computer-name-input" placeholder="My Computer" v-model="name" />
          <div v-if="error" class="gate-error">{{ error }}</div>
        </div>
        <div class="modal-foot">
          <button class="nb-btn" @click="onClose" :disabled="busy">Cancel</button>
          <button class="nb-btn primary" data-testid="add-computer-next" @click="next" :disabled="busy">
            {{ busy ? "Creating…" : "Next" }}
          </button>
        </div>
      </template>

      <template v-if="step === 'connect' && result">
        <div class="modal-body">
          <div class="connect-hint"><Terminal :size="15" /> Run this command in the terminal of that computer to connect:</div>
          <div class="cmd-box">
            <code data-testid="connect-command">{{ result.connectCommand }}</code>
            <button class="nb-btn" data-testid="copy-command" title="Copy" @click="copy"><Copy :size="13" /></button>
          </div>
          <div :class="`wait-banner ${online ? 'ok' : ''}`" data-testid="connect-status">
            <template v-if="online"><CheckCircle2 :size="14" /> Connected! You can click Done now</template>
            <template v-else><Loader :size="14" /> Waiting for computer to connect…</template>
          </div>
          <div class="fake" :style="{ marginTop: '8px' }">
            The command template is generated from server config; once connected, this computer reports its OS / runtimes.
          </div>
        </div>
        <div class="modal-foot">
          <button class="nb-btn" @click="onClose">Cancel</button>
          <button class="nb-btn primary" data-testid="connect-done" :disabled="!online" @click="onConnected(result.machine.id)">
            Done
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
