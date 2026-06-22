<script setup lang="ts">
/** 把消息正文里的 @handle / #channel / #N(任务) 渲染成可点链接(数据校验过的才链)。
 *  @handle:匹配到的成员高亮;#频道:跳频道;#数字:跳任务看板。 */

import { computed } from "vue";
import type { Channel } from "../types.js";

const props = defineProps<{
  content: string;
  channels: Channel[];
  memberHandles: Set<string>;
  onChannel: (id: string) => void;
  onTask: () => void;
}>();

type Seg = { p: string; cls?: string; title?: string; task?: boolean; chId?: string };

const segments = computed<Seg[]>(() => {
  const chanByName = new Map<string, string>();
  for (const c of props.channels) {
    chanByName.set(c.slug, c.id);
    if (c.name) chanByName.set(c.name, c.id);
  }
  // 拆成 普通文字 / @token / #token
  const parts = props.content.split(/(@[A-Za-z0-9_一-龥-]+|#[A-Za-z0-9_一-龥-]+)/g);
  return parts.map((p): Seg => {
    if (p.startsWith("@") && p.length > 1) {
      const handle = p.slice(1);
      if (props.memberHandles.has(handle)) return { p, cls: "tok mention", title: "Member profile / DM (coming soon)" };
      return { p };
    }
    if (p.startsWith("#") && p.length > 1) {
      const rest = p.slice(1);
      if (/^\d+$/.test(rest)) return { p, cls: "tok task", title: "Jump to task board", task: true };
      const chId = chanByName.get(rest);
      if (chId) return { p, cls: "tok channel", title: "Jump to channel", chId };
      return { p };
    }
    return { p };
  });
});
</script>

<template>
  <span>
    <template v-for="(s, i) in segments" :key="i">
      <span v-if="s.task" class="tok task" :title="s.title" @click="onTask">{{ s.p }}</span>
      <span v-else-if="s.chId" class="tok channel" :title="s.title" @click="onChannel(s.chId)">{{ s.p }}</span>
      <span v-else-if="s.cls" :class="s.cls" :title="s.title">{{ s.p }}</span>
      <span v-else>{{ s.p }}</span>
    </template>
  </span>
</template>
