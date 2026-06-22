<script setup lang="ts">
/** Computers 栏(第二列):COMPUTERS 列表 + 新增。 */

import { Plus, Monitor } from "lucide-vue-next";
import type { Machine } from "../types.js";

defineProps<{
  machines: Machine[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}>();
</script>

<template>
  <div class="col" data-testid="computers-column">
    <div class="col-head">Computers</div>
    <div class="col-scroll">
      <div class="sect">
        <span>COMPUTERS</span><span class="count">{{ machines.length }}</span>
        <span class="grow" />
        <button class="sect-add" data-testid="add-computer-btn" title="Add computer" @click="onAdd">
          <Plus :size="15" />
        </button>
      </div>
      <div v-if="machines.length === 0" class="member-row"><span class="nm" :style="{ color: '#999' }">No computers yet — click + to add</span></div>
      <div
        v-for="m in machines"
        :key="m.id"
        data-testid="computer-row"
        :class="`member-row ${m.id === selectedId ? 'active' : ''}`"
        @click="onSelect(m.id)"
      >
        <span class="mono-icon"><Monitor :size="18" /></span>
        <span class="comp-text">
          <span class="nm">{{ m.name }}</span>
          <span class="member-sub">daemon {{ m.daemonVersion ?? "—" }}</span>
        </span>
        <span :class="`dot ${m.status === 'online' ? 'on' : 'idle'}`" :title="m.status" />
      </div>
    </div>
  </div>
</template>
