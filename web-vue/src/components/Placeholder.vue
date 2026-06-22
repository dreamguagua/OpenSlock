<script setup lang="ts">
/** 未实现功能的占位页:显式标注假数据,功能待实现。 */
defineProps<{ title: string; note: string }>();
</script>

<template>
  <div class="placeholder" data-testid="placeholder">
    <div>
      <div class="big">{{ title }}</div>
      <div class="fake">{{ note }} (placeholder — coming soon)</div>
    </div>
  </div>
</template>
