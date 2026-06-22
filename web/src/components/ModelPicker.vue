<script setup lang="ts">
/** Model 选择器:预设下拉 + "Custom…" → 自由文本输入。
 *  value = 原始 model 字符串(""=交给 daemon 默认)。 */

import { ref } from "vue";

const props = defineProps<{
  value: string;
  onChange: (v: string) => void;
  controlClass?: string;
  testid?: string;
}>();

const MODEL_PRESETS: ReadonlyArray<readonly [string, string]> = [
  ["", "Default (daemon)"],
  ["claude-opus-4-8", "Claude Opus 4.8"],
  ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
  ["claude-fable-5", "Claude Fable 5"],
];
const CUSTOM = "__custom__";

const isPreset = MODEL_PRESETS.some(([v]) => v === props.value);
const custom = ref(props.value !== "" && !isPreset);
const customTestid = props.testid ? `${props.testid}-custom` : undefined;

function onSelect(e: Event) {
  const val = (e.target as HTMLSelectElement).value;
  if (val === CUSTOM) { custom.value = true; props.onChange(""); }
  else { custom.value = false; props.onChange(val); }
}
function onCustomInput(e: Event) {
  props.onChange((e.target as HTMLInputElement).value);
}
</script>

<template>
  <select :class="controlClass" :data-testid="testid" :value="custom ? CUSTOM : value" @change="onSelect">
    <option v-for="[v, label] in MODEL_PRESETS" :key="v || 'default'" :value="v">{{ label }}</option>
    <option :value="CUSTOM">Custom…</option>
  </select>
  <input
    v-if="custom"
    :class="controlClass"
    :data-testid="customTestid"
    placeholder="Custom model id, e.g. gpt-5.5"
    :value="value"
    :style="{ marginTop: '8px' }"
    @input="onCustomInput"
  />
</template>
