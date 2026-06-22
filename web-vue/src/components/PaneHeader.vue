<script setup lang="ts">
/** 非频道视图(Members/Computers/Activity/…)的统一头部:首字母方块 + 标题 + Sign out。 */
defineProps<{ title: string; connected: boolean; onLogout: () => void }>();
</script>

<template>
  <div class="ch-head">
    <div class="sq">{{ title.slice(0, 1) }}</div>
    <div class="nm">{{ title }}</div>
    <div class="right">
      <button class="nb-btn" @click="onLogout">Sign out</button>
    </div>
  </div>
</template>
