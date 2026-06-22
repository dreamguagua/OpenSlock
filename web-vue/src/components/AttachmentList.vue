<script setup lang="ts">
/** 渲染一条消息的附件列表。 */

import AttachmentItem from "./AttachmentItem.vue";
import type { AttachmentMeta } from "../types.js";

defineProps<{ attachments: AttachmentMeta[] }>();
</script>

<template>
  <div v-if="attachments.length > 0" class="attachments" data-testid="attachments">
    <AttachmentItem v-for="a in attachments" :key="a.id" :att="a" />
  </div>
</template>
