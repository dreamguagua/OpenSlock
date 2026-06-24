<script setup lang="ts">
/** 工作区主壳:rail + 可拖拽三栏(side / main / thread)+ 各视图 + 模态。
 *  布局用 splitpanes 复刻 react-resizable-panels(尺寸持久化到 localStorage)。 */

import { ref, computed } from "vue";
import { Splitpanes, Pane } from "splitpanes";
import { Square, Users, Archive, RotateCcw, LogOut, Hash, User, MessageSquare, ListChecks, Paperclip } from "lucide-vue-next";
import { useCrew } from "../composables/useCrew.js";
import type { RailSection } from "./railSection.js";
import type { Message, Task } from "../types.js";
import FarRail from "./FarRail.vue";
import ChannelColumn from "./ChannelColumn.vue";
import MembersColumn from "./MembersColumn.vue";
import ComputersColumn from "./ComputersColumn.vue";
import PaneHeader from "./PaneHeader.vue";
import Placeholder from "./Placeholder.vue";
import AgentDetail from "./AgentDetail.vue";
import MachineDetail from "./MachineDetail.vue";
import ActivityView from "./ActivityView.vue";
import SavedView from "./SavedView.vue";
import ActionsView from "./ActionsView.vue";
import SearchView from "./SearchView.vue";
import ChatView from "./ChatView.vue";
import TaskBoard from "./TaskBoard.vue";
import FilesView from "./FilesView.vue";
import ThreadPanel from "./ThreadPanel.vue";
import NewAgentDialog from "./NewAgentDialog.vue";
import ImportAgentDialog from "./ImportAgentDialog.vue";
import AddComputerDialog from "./AddComputerDialog.vue";
import NewChannelDialog from "./NewChannelDialog.vue";
import ChannelMembersDialog from "./ChannelMembersDialog.vue";
import SettingsDialog from "./SettingsDialog.vue";

type View = "channel" | "activity" | "saved" | "search" | "members" | "computers" | "actions";
type Tab = "chat" | "tasks" | "files";

const props = defineProps<{ token: string; onLogout: () => void }>();

const c = useCrew(props.token);

const view = ref<View>("channel");
const tab = ref<Tab>("chat");
const threadId = ref<string | null>(null);
const selectedAgent = ref<string | null>(null);
const showNewAgent = ref(false);
const newAgentMachineId = ref<string | null>(null); // 从电脑详情「+ Create」打开时预选的本机 id
const machineAgentsTick = ref(0); // 自增以让 MachineDetail 重拉本机 agent 列表(创建后)
const showImportAgent = ref(false);
const showSettings = ref(false);
const selectedMachine = ref<string | null>(null);
const showAddComputer = ref(false);
const showNewChannel = ref(false);
const showMembers = ref(false);

const machine = computed(() => c.machines.find((m) => m.id === selectedMachine.value) ?? null);
const channel = computed(() => c.channels.find((ch) => ch.id === c.selectedChannelId));
const channelName = computed(() => (channel.value ? (channel.value.name ?? channel.value.slug) : "—"));
// DM 频道 slug 形如 `dm:{humanId}:{agentHandle}` → 取出对端 agent,在头部显示其状态
const dmHandle = computed(() => (channel.value?.kind === "dm" ? (channel.value.slug.split(":").pop() ?? null) : null));
const dmStatus = computed(() => (dmHandle.value ? c.agentStatus[dmHandle.value] : undefined));
const memberCount = computed(() => channel.value?.memberCount ?? 0);

// 线程数据(从当前频道消息派生)
const threadParent = computed(() => (threadId.value ? c.messages.find((m) => m.id === threadId.value) ?? null : null));
const threadReplies = computed(() => (threadId.value ? c.messages.filter((m) => m.threadParentId === threadId.value) : []));
// 线程对应的任务(锚定在父消息上):用于 thread 头部展示「任务号 + assignee」
const threadTask = computed(() => (threadId.value ? c.tasks.find((t) => t.messageId === threadId.value) ?? null : null));
const threadOpen = computed(() => view.value === "channel" && (tab.value === "chat" || tab.value === "tasks") && threadParent.value !== null);

// @mention / #channel / #task 链接化的数据与跳转
const memberHandles = computed(() => new Set<string>([...c.agents.map((a) => a.handle), ...c.humans.map((h) => h.handle)]));
// @mention 自动补全候选:本工作区的 human + agent(humans 优先,通常更少更相关)
const mentionMembers = computed(() => [...c.humans, ...c.agents]);
const jumpChannel = (id: string) => { c.selectChannel(id); view.value = "channel"; tab.value = "chat"; threadId.value = null; };
const jumpTask = () => { view.value = "channel"; tab.value = "tasks"; };

const railActive = computed<RailSection>(() =>
  view.value === "members" ? "members" : view.value === "computers" ? "computers" : view.value === "search" ? "search" : "chat");
const navRail = (s: RailSection) => {
  if (s === "members") view.value = "members";
  else if (s === "computers") view.value = "computers";
  else if (s === "search") view.value = "search";
  else view.value = "channel";
  threadId.value = null;
};

// ===== 分栏尺寸持久化(等效 react-resizable-panels 的 autoSaveId)=====
// 只存「侧栏宽」和「线程宽」两个数,main 永远填剩余,保证三者恒等于 100%。
// splitpanes 的 resized 事件在「增/删 pane」时也会触发,且 size 可能为 null,
// 故对 payload 严格校验(全为有限数 + 在范围内 + 和≈100),非用户拖拽产生的脏值一律丢弃。
const PANES_KEY = "crew-panels-vue";
const SIDE_DEFAULT = 22, THREAD_DEFAULT = 28;
const SIDE_MIN = 14, SIDE_MAX = 40, THREAD_MIN = 16, THREAD_MAX = 50;

function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }
function loadPref(): { side: number; thread: number } {
  try {
    const v = JSON.parse(localStorage.getItem(PANES_KEY) ?? "{}") as { side?: unknown; thread?: unknown };
    const side = typeof v.side === "number" && Number.isFinite(v.side) ? clamp(v.side, SIDE_MIN, SIDE_MAX) : SIDE_DEFAULT;
    const thread = typeof v.thread === "number" && Number.isFinite(v.thread) ? clamp(v.thread, THREAD_MIN, THREAD_MAX) : THREAD_DEFAULT;
    return { side, thread };
  } catch { return { side: SIDE_DEFAULT, thread: THREAD_DEFAULT }; }
}
const pref = loadPref();
const sideW = ref(pref.side);
const threadW = ref(pref.thread);
function savePref(): void {
  try { localStorage.setItem(PANES_KEY, JSON.stringify({ side: sideW.value, thread: threadW.value })); }
  catch { /* 忽略配额/隐私模式 */ }
}

const sideSize = computed(() => sideW.value);
const threadSize = computed(() => threadW.value);
// main 填剩余,永不为 null,且让三栏恒为 100%
const mainSize = computed(() => 100 - sideW.value - (threadOpen.value ? threadW.value : 0));

const onResized = (panes: Array<{ size: number | null }>) => {
  const sizes = panes.map((p) => p.size);
  // 仅接受用户拖拽产生的合法布局:全为有限数 + 和≈100;增删 pane 的脏值(含 null)丢弃
  if (sizes.some((s) => typeof s !== "number" || !Number.isFinite(s))) return;
  const nums = sizes as number[];
  if (Math.abs(nums.reduce((a, b) => a + b, 0) - 100) > 1) return;
  sideW.value = clamp(nums[0]!, SIDE_MIN, SIDE_MAX);
  if (nums.length === 3) threadW.value = clamp(nums[2]!, THREAD_MIN, THREAD_MAX);
  savePref();
};

// 子组件回调
const onSelectChannel = (id: string) => { c.selectChannel(id); view.value = "channel"; tab.value = "chat"; };
const onAgentMessage = (h: string) => { void c.openDm(h).then(() => { view.value = "channel"; tab.value = "chat"; threadId.value = null; }); };
const openThread = (m: Message) => { threadId.value = m.id; };
const openTaskThread = (t: Task) => { threadId.value = t.messageId; };
</script>

<template>
  <div class="shell" data-testid="workspace">
    <FarRail workspace-initial="C" :active="railActive" :on-nav="navRail" :on-logout="onLogout" :on-settings="() => showSettings = true" />
    <!-- key 随 pane 数变化:splitpanes 在增/删 pane 时不会重读 :size,会把腾出的空间错误重分配
         (出现 40|50 之类不足 100% 的布局),故仅在 2↔3 栏切换时整体重挂载以重置为正确尺寸。
         key 不随频道/视图切换变化,日常聊天不会重挂载。 -->
    <Splitpanes :key="threadOpen ? 'with-thread' : 'no-thread'" class="panes" @resized="onResized">
      <Pane :size="sideSize" min-size="14" max-size="40" class="pane">
        <MembersColumn
          v-if="view === 'members'"
          :agents="c.agents" :humans="c.humans" :agent-status="c.agentStatus"
          :selected-handle="selectedAgent"
          :on-select-agent="(h) => selectedAgent = h"
          :on-new-agent="() => showNewAgent = true"
          :on-import-agent="() => showImportAgent = true"
        />
        <ComputersColumn
          v-else-if="view === 'computers'"
          :machines="c.machines" :selected-id="selectedMachine"
          :on-select="(id) => selectedMachine = id"
          :on-add="() => showAddComputer = true"
        />
        <ChannelColumn
          v-else
          :channels="c.channels" :selected-channel-id="c.selectedChannelId" :view="view"
          :on-select="onSelectChannel"
          :on-nav="(v) => view = v"
          :on-new-channel="() => showNewChannel = true"
        />
      </Pane>

      <Pane :size="mainSize" min-size="30" class="pane">
        <main class="main">
          <template v-if="view === 'members'">
            <AgentDetail
              v-if="selectedAgent"
              :handle="selectedAgent" :machines="c.machines"
              :activity="c.agentActivity[selectedAgent]" :status="c.agentStatus[selectedAgent]"
              :on-save="c.editAgent" :on-delete="c.removeAgent"
              :on-deleted="() => selectedAgent = null"
              :on-message="onAgentMessage"
            />
            <template v-else>
              <PaneHeader title="Members" :connected="c.connected" :on-logout="onLogout" />
              <Placeholder title="Select an agent" note="Click an agent on the left to view Profile / Workspace / Activity, or click + to create one" />
            </template>
          </template>

          <template v-else-if="view === 'computers'">
            <MachineDetail
              v-if="machine" :machine="machine" :agent-status="c.agentStatus" :reload-key="machineAgentsTick"
              :on-rename="c.renameMachine"
              :on-delete="async (id) => { await c.deleteMachine(id); selectedMachine = null; }"
              :on-create-agent="() => { newAgentMachineId = machine!.id; showNewAgent = true; }"
            />
            <template v-else>
              <PaneHeader title="Computers" :connected="c.connected" :on-logout="onLogout" />
              <Placeholder title="Select a computer" note="Click a computer on the left to view its info and agents, or click + to add one" />
            </template>
          </template>

          <template v-else-if="view === 'activity'">
            <PaneHeader title="Activity" :connected="c.connected" :on-logout="onLogout" />
            <ActivityView :channels="c.channels" :agents="c.agents" :humans="c.humans" :on-jump="jumpChannel" />
          </template>

          <template v-else-if="view === 'saved'">
            <PaneHeader title="Saved" :connected="c.connected" :on-logout="onLogout" />
            <SavedView :channels="c.channels" :on-jump="jumpChannel" />
          </template>

          <template v-else-if="view === 'actions'">
            <PaneHeader title="Actions" :connected="c.connected" :on-logout="onLogout" />
            <ActionsView :reload-key="c.actionsTick" />
          </template>

          <template v-else-if="view === 'search'">
            <PaneHeader title="Search" :connected="c.connected" :on-logout="onLogout" />
            <SearchView :channels="c.channels" :agent-status="c.agentStatus" :on-search="c.search" :on-jump="onSelectChannel" />
          </template>

          <template v-else-if="view === 'channel'">
            <div class="ch-head">
              <div class="sq"><User v-if="channel?.kind === 'dm'" :size="18" /><Hash v-else :size="18" /></div>
              <div>
                <div class="nm">
                  {{ channelName }}
                  <template v-if="dmStatus"> <span :class="`dot ${dmStatus.kind}`" /> <span class="hero-status">{{ dmStatus.label }}</span></template>
                </div>
                <div class="desc"><template v-if="channel?.description">{{ channel.description }}</template><span v-else class="fake">Channel description (placeholder)</span></div>
              </div>
              <div class="right head-actions">
                <span
                  :class="`live-pill ${c.connected ? 'on' : ''}`"
                  :title="c.connected ? '你的浏览器与服务器的实时连接正常(与 agent 是否在线无关)' : '正在连接服务器…'"
                >
                  <span class="live-dot" />{{ c.connected ? "Live" : "Connecting" }}
                </span>
                <button class="hbtn icon" title="Stop all agents in this channel (placeholder)"><Square :size="15" /></button>
                <button v-if="channel && channel.kind !== 'dm' && !channel.joined" class="hbtn primary" data-testid="channel-join" @click="c.joinChannel(channel.id)">Join</button>
                <button v-if="channel && channel.kind !== 'dm'" class="hbtn" data-testid="open-members" title="Members" @click="showMembers = true">
                  <Users :size="15" /><span class="hbtn-count">{{ memberCount }}</span>
                </button>
                <button
                  v-if="channel && channel.kind !== 'dm'"
                  class="hbtn" data-testid="archive-toggle"
                  :title="channel.archived ? 'Unarchive channel' : 'Archive channel (read-only)'"
                  @click="c.archiveChannel(channel.id, !channel.archived)"
                >
                  <RotateCcw v-if="channel.archived" :size="14" /><Archive v-else :size="14" />
                  {{ channel.archived ? "Unarchive" : "Archive" }}
                </button>
                <button class="hbtn" data-testid="logout-btn" title="Sign out" @click="onLogout"><LogOut :size="14" /> Sign out</button>
              </div>
            </div>

            <div class="tabs">
              <div :class="`tab ${tab === 'chat' ? 'active' : ''}`" data-testid="tab-chat" @click="tab = 'chat'"><span class="ti"><MessageSquare :size="15" /></span> Chat</div>
              <div :class="`tab ${tab === 'tasks' ? 'active' : ''}`" data-testid="tab-tasks" @click="tab = 'tasks'"><span class="ti"><ListChecks :size="15" /></span> Tasks</div>
              <div :class="`tab ${tab === 'files' ? 'active' : ''}`" data-testid="tab-files" @click="tab = 'files'"><span class="ti"><Paperclip :size="15" /></span> Files</div>
            </div>

            <div v-if="c.error" class="error-banner" data-testid="error-banner">{{ c.error }}</div>

            <ChatView
              v-if="tab === 'chat'"
              :channel-name="channelName" :channel-id="c.selectedChannelId"
              :messages="c.messages" :tasks="c.tasks"
              :disabled="!c.selectedChannelId || Boolean(channel?.archived)" :archived="Boolean(channel?.archived)"
              :active-thread-id="threadId" :channels="c.channels" :member-handles="memberHandles"
              :mention-members="mentionMembers"
              :agent-activity="c.agentActivity" :agent-status="c.agentStatus"
              :on-channel="jumpChannel" :on-task="jumpTask"
              :on-send="c.send" :on-send-files="c.sendWithFiles"
              :on-open-thread="openThread"
              :on-toggle-reaction="c.toggleReaction" :on-toggle-save="c.toggleSave"
              :on-set-status="c.setTaskStatus"
            />
            <TaskBoard
              v-else-if="tab === 'tasks'"
              :tasks="c.tasks" :disabled="!c.selectedChannelId"
              :on-create="c.createTask" :on-claim="c.claimTask" :on-set-status="c.setTaskStatus"
              :on-unclaim="c.unclaimTask" :on-move="c.moveTask" :on-open-task="openTaskThread"
            />
            <template v-else-if="tab === 'files'">
              <FilesView v-if="c.selectedChannelId" :channel-id="c.selectedChannelId" />
              <Placeholder v-else title="Files" note="Select a channel" />
            </template>
          </template>
        </main>
      </Pane>

      <Pane v-if="threadOpen && threadParent" :size="threadSize" min-size="16" max-size="50" class="pane">
        <ThreadPanel
          :channel-name="channelName" :parent="threadParent" :replies="threadReplies" :task="threadTask"
          :channels="c.channels" :member-handles="memberHandles" :mention-members="mentionMembers" :agent-status="c.agentStatus"
          :on-channel="jumpChannel" :on-task="jumpTask"
          :on-reply="(content) => c.reply(threadParent!.id, content)"
          :on-reply-files="(content, files) => c.replyWithFiles(threadParent!.id, content, files)"
          :on-close="() => threadId = null"
          :on-set-status="c.setTaskStatus"
        />
      </Pane>
    </Splitpanes>

    <NewAgentDialog
      v-if="showNewAgent"
      :machines="c.machines" :preselected-machine-id="newAgentMachineId ?? undefined" :on-create="c.createAgent"
      :on-close="() => { showNewAgent = false; newAgentMachineId = null; }"
      :on-created="(handle) => { showNewAgent = false; newAgentMachineId = null; selectedAgent = handle; machineAgentsTick++; }"
    />

    <SettingsDialog
      v-if="showSettings"
      :connected="c.connected"
      :on-close="() => showSettings = false"
      :on-logout="() => { showSettings = false; onLogout(); }"
      :on-profile-saved="() => c.refreshDirectory()"
    />

    <ImportAgentDialog
      v-if="showImportAgent"
      :machines="c.machines" :on-import="c.importAgent"
      :on-close="() => showImportAgent = false"
      :on-imported="(handle) => { showImportAgent = false; view = 'members'; selectedAgent = handle; }"
    />

    <AddComputerDialog
      v-if="showAddComputer"
      :on-create="c.createMachine"
      :on-close="() => showAddComputer = false"
      :on-connected="(id) => { showAddComputer = false; selectedMachine = id; void c.refreshMachines(); }"
    />

    <NewChannelDialog
      v-if="showNewChannel"
      :agents="c.agents" :humans="c.humans" :on-create="c.createChannel"
      :on-close="() => showNewChannel = false"
      :on-created="() => { showNewChannel = false; view = 'channel'; tab = 'chat'; }"
    />

    <ChannelMembersDialog
      v-if="showMembers && channel"
      :channel-id="channel.id" :channel-name="channelName" :joined="channel.joined"
      :agents="c.agents" :humans="c.humans"
      :on-leave="c.leaveChannel" :on-add="c.addChannelMember" :on-remove="c.removeChannelMember"
      :on-close="() => showMembers = false"
    />
  </div>
</template>
