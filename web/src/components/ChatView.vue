<script setup lang="ts">
/** Chat tab:主流只显示顶层消息;有回复的消息显示「N 条回复」可点开线程。 */

import { ref, computed, watch } from "vue";
import type { AgentActivity, AgentStatusInfo, Channel, Member, Message, Task } from "../types.js";
import Avatar from "./Avatar.vue";
import MentionTextarea from "./MentionTextarea.vue";
import MessageText from "./MessageText.vue";
import TaskChip from "./TaskChip.vue";
import ReactionBar from "./ReactionBar.vue";
import AttachmentList from "./AttachmentList.vue";
import ReactionAdd from "./ReactionAdd.vue";
import PendingFiles from "./PendingFiles.vue";
import { Paperclip, Bookmark, MessageSquare, Archive } from "lucide-vue-next";
import { imagesFromClipboard } from "../lib/clipboard.js";
import { ACTIVITY_LABEL } from "../status.js";
import { getChannelSeen, markThreadSeen } from "../threadSeen.js";

const props = defineProps<{
  channelName: string;
  channelId: string | null;
  messages: Message[];
  tasks: Task[];
  disabled: boolean;
  archived?: boolean;
  activeThreadId: string | null;
  channels: Channel[];
  memberHandles: Set<string>;
  mentionMembers: Member[];
  agentActivity: Record<string, AgentActivity>;
  agentStatus: Record<string, AgentStatusInfo>;
  onChannel: (id: string) => void;
  onTask: () => void;
  onSend: (text: string, asTask?: boolean) => Promise<void>;
  onSendFiles: (text: string, asTask: boolean, files: File[]) => Promise<void>;
  onOpenThread: (m: Message) => void;
  onToggleReaction: (messageId: string, emoji: string, mine: boolean) => void;
  onToggleSave: (messageId: string, saved: boolean) => void;
}>();

// 活动条只显示当前频道的活动(activity 是全局收集的,这里按 channelId 过滤)
const active = computed(() => Object.entries(props.agentActivity).filter(([, a]) => a.channelId === props.channelId));

const endRef = ref<HTMLDivElement | null>(null);
const text = ref("");
const busy = ref(false);
const asTask = ref(false);
const files = ref<File[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);

interface ReplyInfo { count: number; lastSeq: number; seqs: number[] }

// 顶层消息 + 每条的回复数/回复 seq 列表(用于算「X new」)
const replyInfo = computed(() => {
  const info = new Map<string, ReplyInfo>();
  for (const m of props.messages) {
    if (m.threadParentId) {
      const cur = info.get(m.threadParentId) ?? { count: 0, lastSeq: 0, seqs: [] };
      info.set(m.threadParentId, { count: cur.count + 1, lastSeq: Math.max(cur.lastSeq, m.seq), seqs: [...cur.seqs, m.seq] });
    }
  }
  return info;
});
const topLevel = computed(() => props.messages.filter((m) => !m.threadParentId));

// 消息 → 关联的 task(task.messageId 锚定):用于在消息下方显示状态彩色 chip
const taskByMessage = computed(() => {
  const map = new Map<string, Task>();
  for (const t of props.tasks) map.set(t.messageId, t);
  return map;
});

// 线程已读游标(每个 parentId → 已看到的最大回复 seq);决定「· X new」
const seen = ref<Record<string, number>>({});
// 切频道:载入该频道持久化的已读游标
watch(() => props.channelId, (ch) => { seen.value = ch ? getChannelSeen(ch) : {}; }, { immediate: true });
// 基线:首次见到的线程以当前最大回复 seq 为已读(避免历史线程全部显示为 new)
watch([() => props.channelId, replyInfo], () => {
  const ch = props.channelId;
  if (!ch) return;
  let changed = false;
  const next = { ...seen.value };
  for (const [pid, info] of replyInfo.value) {
    if (next[pid] === undefined) { next[pid] = info.lastSeq; markThreadSeen(ch, pid, info.lastSeq); changed = true; }
  }
  if (changed) seen.value = next;
}, { immediate: true });
// 当前打开的线程:新回复到达即视为已读(保持其 new=0)
watch([() => props.channelId, () => props.activeThreadId, replyInfo], () => {
  const ch = props.channelId, pid = props.activeThreadId;
  if (!ch || !pid) return;
  const info = replyInfo.value.get(pid);
  if (!info) return;
  markThreadSeen(ch, pid, info.lastSeq);
  if (seen.value[pid] !== info.lastSeq) seen.value = { ...seen.value, [pid]: info.lastSeq };
}, { immediate: true });

// 自动滚动到底(等同 React useEffect:渲染后执行)
watch(() => topLevel.value.length, () => { endRef.value?.scrollIntoView({ behavior: "smooth" }); }, { flush: "post", immediate: true });

// 打开线程:标记该线程已读(清零 new)后再交给上层切换
const openThread = (m: Message) => {
  const info = replyInfo.value.get(m.id);
  if (info && props.channelId) {
    markThreadSeen(props.channelId, m.id, info.lastSeq);
    seen.value = { ...seen.value, [m.id]: info.lastSeq };
  }
  props.onOpenThread(m);
};

const rOf = (m: Message) => replyInfo.value.get(m.id);
const taskOf = (m: Message) => taskByMessage.value.get(m.id);
const newCountOf = (m: Message) => {
  const r = rOf(m);
  return r ? r.seqs.filter((s) => s > (seen.value[m.id] ?? Infinity)).length : 0;
};

const submit = async () => {
  const t = text.value.trim();
  if ((!t && files.value.length === 0) || busy.value) return;
  busy.value = true;
  try {
    if (files.value.length) await props.onSendFiles(t, asTask.value, files.value);
    else await props.onSend(t, asTask.value);
    text.value = ""; asTask.value = false; files.value = [];
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
const placeholder = computed(() =>
  props.archived ? "Channel is archived (read-only)"
  : props.disabled ? "Select a channel first"
  : `Message #${props.channelName}… (Enter to send)`);
</script>

<template>
  <div class="chat" data-testid="chat-view">
    <div class="msgs" data-testid="message-stream">
      <div v-if="topLevel.length === 0" class="placeholder"><div>No messages in this channel yet</div></div>
      <div v-for="m in topLevel" :key="m.id" :class="`msg ${m.type}`" data-testid="message">
        <Avatar :type="m.type" :id="m.sender.id" :status="m.type === 'agent' ? agentStatus[m.sender.id]?.kind : undefined" />
        <div class="body">
          <div class="line1">
            <span class="who">{{ m.sender.id }}</span>
            <span class="meta mono">#{{ m.seq }} · {{ m.type }}</span>
            <span class="msg-actions">
              <button class="msg-act" data-testid="reply-link" title="Reply in thread" @click="openThread(m)">
                <MessageSquare :size="14" />
              </button>
              <ReactionAdd :reactions="m.reactions ?? []" :onToggle="(emoji, mine) => onToggleReaction(m.id, emoji, mine)" />
              <button
                :class="`msg-act ${m.saved ? 'saved' : ''}`"
                data-testid="save-link"
                :title="m.saved ? 'Remove from Saved' : 'Save message'"
                @click="onToggleSave(m.id, Boolean(m.saved))"
              >
                <Bookmark :size="14" :fill="m.saved ? 'currentColor' : 'none'" />
              </button>
            </span>
          </div>
          <div class="content"><MessageText :content="m.content" :channels="channels" :memberHandles="memberHandles" :onChannel="onChannel" :onTask="onTask" /></div>
          <AttachmentList :attachments="m.attachments ?? []" />
          <ReactionBar :reactions="m.reactions ?? []" :onToggle="(emoji, mine) => onToggleReaction(m.id, emoji, mine)" />
          <div v-if="taskOf(m) || rOf(m)" class="msg-foot">
            <TaskChip v-if="taskOf(m)" :task="(taskOf(m) as Task)" :onOpen="() => openThread(m)" />
            <button
              v-if="rOf(m)"
              :class="`thread-summary ${activeThreadId === m.id ? 'active' : ''}`"
              data-testid="thread-summary"
              @click="openThread(m)"
            >
              <MessageSquare :size="12" /> {{ rOf(m)!.count }} {{ rOf(m)!.count === 1 ? "reply" : "replies" }}
              <span v-if="newCountOf(m) > 0" class="new-badge" data-testid="thread-new">· {{ newCountOf(m) }} new</span>
            </button>
          </div>
        </div>
      </div>
      <div ref="endRef" />
    </div>
    <div v-if="active.length > 0" class="activity-bar" data-testid="activity-bar">
      <span v-for="[handle, a] in active" :key="handle" class="act-chip">
        <span class="act-dot" /> {{ handle }} is {{ ACTIVITY_LABEL[a.activity] ?? a.activity }}…
      </span>
    </div>
    <div class="composer composer-col" data-testid="composer">
      <PendingFiles :files="files" :onRemove="removeFile" />
      <div v-if="archived" class="archived-note" data-testid="archived-note"><Archive :size="13" /> This channel is archived (read-only).</div>
      <MentionTextarea
        test-id="composer-input"
        :placeholder="placeholder"
        v-model="text"
        :members="mentionMembers"
        :disabled="disabled || busy"
        @paste="onPaste"
        @enter="submit"
      />
      <div class="composer-foot">
        <input
          ref="fileInputRef" type="file" multiple data-testid="file-input" :style="{ display: 'none' }"
          @change="onFileChange"
        />
        <button class="nb-btn" data-testid="attach-btn" title="Attach files" :disabled="disabled || busy" @click="fileInputRef?.click()">
          <Paperclip :size="14" />
        </button>
        <label class="astask-toggle" title="Create a task from this message">
          <input type="checkbox" data-testid="as-task" v-model="asTask" :disabled="disabled || busy" />
          As task
        </label>
        <span class="grow" />
        <button class="nb-btn primary" data-testid="send-btn" :disabled="disabled || busy || (!text.trim() && files.length === 0)" @click="submit">
          {{ asTask ? "Create task" : "Send" }}
        </button>
      </div>
    </div>
  </div>
</template>
