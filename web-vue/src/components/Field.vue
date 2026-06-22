<script setup lang="ts">
/** Profile 字段块:标签 + 值(slot)。 */
defineProps<{ label: string }>();
</script>

<template>
  <div class="field-block">
    <div class="field-label">{{ label }}</div>
    <div class="field-value"><slot /></div>
  </div>
</template>
