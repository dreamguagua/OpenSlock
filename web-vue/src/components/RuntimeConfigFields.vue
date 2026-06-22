<script setup lang="ts">
/** 共享的 agent 运行时配置字段:Provider(Default/Custom BYOC)、Reasoning、Fast mode。
 *  Create Agent 弹窗与 Profile 编辑表单复用。 */

import type { AgentProvider, AgentReasoning } from "../types.js";
import type { RtConfig } from "./runtimeConfig.js";

const props = defineProps<{
  value: RtConfig;
  onChange: (next: RtConfig) => void;
  controlClass?: string;
}>();

function set(patch: Partial<RtConfig>) { props.onChange({ ...props.value, ...patch }); }

function onProvider(e: Event) { set({ provider: (e.target as HTMLSelectElement).value as AgentProvider }); }
function onBaseUrl(e: Event) { set({ providerBaseUrl: (e.target as HTMLInputElement).value }); }
function onApiKey(e: Event) { set({ providerApiKey: (e.target as HTMLInputElement).value }); }
function onReasoning(e: Event) { set({ reasoning: (e.target as HTMLSelectElement).value as AgentReasoning }); }
function onFast(e: Event) { set({ fastMode: (e.target as HTMLInputElement).checked }); }
</script>

<template>
  <label class="edit-label">PROVIDER</label>
  <select :class="controlClass" data-testid="rt-provider" :value="value.provider" @change="onProvider">
    <option value="default">Default</option>
    <option value="custom">Custom</option>
  </select>
  <div class="rt-hint">Default leaves the runtime's provider settings untouched. Custom sets ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY for this agent.</div>
  <template v-if="value.provider === 'custom'">
    <input
      :class="controlClass" data-testid="rt-base-url"
      placeholder="ANTHROPIC_BASE_URL (e.g. https://my-proxy/api)"
      :value="value.providerBaseUrl" @input="onBaseUrl"
    />
    <input
      :class="controlClass" data-testid="rt-api-key" type="password"
      placeholder="ANTHROPIC_API_KEY"
      :value="value.providerApiKey" @input="onApiKey"
    />
  </template>

  <label class="edit-label">REASONING</label>
  <select :class="controlClass" data-testid="rt-reasoning" :value="value.reasoning" @change="onReasoning">
    <option value="default">Default</option>
    <option value="low">Low</option>
    <option value="medium">Medium</option>
    <option value="high">High</option>
  </select>

  <label class="edit-label">MODE</label>
  <label class="astask-toggle" title="Launch this runtime in its faster/minimal mode">
    <input type="checkbox" data-testid="rt-fast" :checked="value.fastMode" @change="onFast" />
    Fast mode
  </label>
</template>
