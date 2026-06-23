<script setup lang="ts">
/** Thread 面板(右侧第 4 栏):父消息 + 回复串 + 线程内发送。 */

import { ref, watch } from "vue";
import { Paperclip } from "lucide-vue-next";
import type { AgentStatusInfo, Channel, Member, Message, Task } from "../types.js";
import Avatar from "./Avatar.vue";
import TaskChip from "./TaskChip.vue";
import MentionTextarea from "./MentionTextarea.vue";
import MessageText from "./MessageText.vue";
import AttachmentList from "./AttachmentList.vue";
import PendingFiles from "./PendingFiles.vue";
import { imagesFromClipboard } from "../lib/clipboard.js";

const props = defineProps<{
  channelName: string;
  parent: Message;
  replies: Message[];
  task: Task | null;
  channels: Channel[];
  memberHandles: Set<string>;
  mentionMembers: Member[];
  agentStatus: Record<string, AgentStatusInfo>;
  onChannel: (id: string) => void;
  onTask: () => void;
  onReply: (content: string) => Promise<void>;
  onReplyFiles: (content: string, files: File[]) => Promise<void>;
  onClose: () => void;
  onSetStatus: (taskId: string, status: string) => Promise<void>;
}>();

const endRef = ref<HTMLDivElement | null>(null);
const text = ref("");
const busy = ref(false);
const files = ref<File[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);

watch(() => props.replies.length, () => { endRef.value?.scrollIntoView({ behavior: "smooth" }); }, { flush: "post", immediate: true });

const submit = async () => {
  const t = text.value.trim();
  if ((!t && files.value.length === 0) || busy.value) return;
  busy.value = true;
  try {
    if (files.value.length) await props.onReplyFiles(t, files.value);
    else await props.onReply(t);
    text.value = ""; files.value = [];
  } finally { busy.value = false; }
};

const removeFile = (i: number) => { files.value = files.value.filter((_, j) => j !== i); };
const onPaste = (e: ClipboardEvent) => {
  const imgs = imagesFromClipboard(e);
  if (imgs.length) { e.preventDefault(); files.value = [...files.value, ...imgs]; }
};
const onFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  files.value = [...files.value, ...Array.from(input.files ?? [])];
  if (fileInputRef.value) fileInputRef.value.value = "";
};
</script>

<template>
  <aside class="thread" data-testid="thread-panel">
    <div class="thread-head">
      <div class="thread-head-title">
        <b>Thread</b> <span class="meta">— #{{ channelName }}</span>
        <TaskChip v-if="task" :task="task" :agent-status="agentStatus" :on-open="() => {}" :on-set-status="onSetStatus" />
      </div>
      <button class="nb-btn" data-testid="thread-close" @click="onClose">×</button>
    </div>
    <div class="thread-body">
      <div class="thread-parent">
        <div :class="`msg ${parent.type}`" data-testid="thread-msg">
          <Avatar :type="parent.type" :id="parent.sender.id" :size="28" :status="parent.type === 'agent' ? agentStatus[parent.sender.id]?.kind : undefined" />
          <div class="body">
            <div class="line1"><span class="who">{{ parent.sender.id }}</span><span class="meta mono">#{{ parent.seq }}</span></div>
            <div class="content"><MessageText :content="parent.content" :channels="channels" :memberHandles="memberHandles" :onChannel="onChannel" :onTask="onTask" /></div>
            <AttachmentList :attachments="parent.attachments ?? []" />
          </div>
        </div>
      </div>
      <div class="thread-divider">{{ replies.length }} {{ replies.length === 1 ? "reply" : "replies" }}</div>
      <div v-if="replies.length === 0" class="fake" :style="{ padding: '12px' }">No replies yet — start the discussion below</div>
      <div v-for="m in replies" :key="m.id" :class="`msg ${m.type}`" data-testid="thread-msg">
        <Avatar :type="m.type" :id="m.sender.id" :size="28" :status="m.type === 'agent' ? agentStatus[m.sender.id]?.kind : undefined" />
        <div class="body">
          <div class="line1"><span class="who">{{ m.sender.id }}</span><span class="meta mono">#{{ m.seq }}</span></div>
          <div class="content"><MessageText :content="m.content" :channels="channels" :memberHandles="memberHandles" :onChannel="onChannel" :onTask="onTask" /></div>
          <AttachmentList :attachments="m.attachments ?? []" />
        </div>
      </div>
      <div ref="endRef" />
    </div>
    <div class="composer composer-col">
      <PendingFiles :files="files" :onRemove="removeFile" />
      <MentionTextarea
        test-id="thread-input"
        placeholder="Reply to thread… (Enter to send)"
        v-model="text"
        :members="mentionMembers"
        :disabled="busy"
        @paste="onPaste"
        @enter="submit"
      />
      <div class="composer-foot">
        <input
          ref="fileInputRef" type="file" multiple data-testid="thread-file-input" :style="{ display: 'none' }"
          @change="onFileChange"
        />
        <button class="nb-btn" data-testid="thread-attach-btn" title="Attach files" :disabled="busy" @click="fileInputRef?.click()">
          <Paperclip :size="14" />
        </button>
        <span class="grow" />
        <button class="nb-btn primary" data-testid="thread-send" :disabled="busy || (!text.trim() && files.length === 0)" @click="submit">Send</button>
      </div>
    </div>
  </aside>
</template>
