/** OpenSlock 前端状态:连接、频道、当前频道消息/任务,WS 事件驱动刷新。
 *  Vue 版:逻辑与 React 的 useCrew hook 等价,返回 reactive 对象(属性访问自动解包 ref)。 */

import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { api, setToken } from "../api.js";
import { connectWs } from "../ws.js";
import { deriveStatus, ACTIVITY_TTL_MS, TERMINAL_ACTIVITIES } from "../status.js";
import type { AgentActivity, AgentPatch, AgentProfile, AgentStatusInfo, Channel, ChannelMember, CreateMachineResult, ImportRaftInput, Machine, Member, Message, NewAgentInput, Task } from "../types.js";

export interface CrewState {
  connected: boolean;
  error: string | null;
  channels: Channel[];
  agents: Member[];
  humans: Member[];
  selectedChannelId: string | null;
  messages: Message[];
  tasks: Task[];
  agentActivity: Record<string, AgentActivity>;
  /** 全站单一数据源:每个 agent handle → 派生状态(online/busy/offline)。 */
  agentStatus: Record<string, AgentStatusInfo>;
  selectChannel: (id: string) => void;
  send: (content: string, asTask?: boolean) => Promise<void>;
  reply: (parentId: string, content: string) => Promise<void>;
  claimTask: (taskId: string) => Promise<void>;
  setTaskStatus: (taskId: string, status: string) => Promise<void>;
  unclaimTask: (taskId: string) => Promise<void>;
  moveTask: (taskId: string, status: string) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string, mine: boolean) => Promise<void>;
  toggleSave: (messageId: string, saved: boolean) => Promise<void>;
  actionsTick: number;
  sendWithFiles: (content: string, asTask: boolean, files: File[]) => Promise<void>;
  replyWithFiles: (parentId: string, content: string, files: File[]) => Promise<void>;
  createTask: (title: string) => Promise<void>;
  search: (query: string) => Promise<Message[]>;
  createAgent: (input: NewAgentInput) => Promise<AgentProfile>;
  importAgent: (input: ImportRaftInput) => Promise<AgentProfile>;
  editAgent: (handle: string, patch: AgentPatch) => Promise<AgentProfile>;
  removeAgent: (handle: string) => Promise<void>;
  openDm: (agentHandle: string) => Promise<string>;
  createChannel: (input: { name: string; description?: string; isPrivate?: boolean; members?: Array<{ type: "agent" | "human"; id: string }> }) => Promise<string>;
  joinChannel: (channelId: string) => Promise<void>;
  leaveChannel: (channelId: string) => Promise<void>;
  archiveChannel: (channelId: string, archived: boolean) => Promise<void>;
  addChannelMember: (channelId: string, member: { type: "agent" | "human"; id: string }) => Promise<ChannelMember[]>;
  removeChannelMember: (channelId: string, member: { type: "agent" | "human"; id: string }) => Promise<ChannelMember[]>;
  machines: Machine[];
  refreshMachines: () => Promise<void>;
  createMachine: (name?: string) => Promise<CreateMachineResult>;
  renameMachine: (id: string, name: string) => Promise<Machine>;
  deleteMachine: (id: string) => Promise<void>;
}

export function useCrew(token: string): CrewState {
  const connected = ref(false);
  const error = ref<string | null>(null);
  const channels = ref<Channel[]>([]);
  const agents = ref<Member[]>([]);
  const humans = ref<Member[]>([]);
  const selectedChannelId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const tasks = ref<Task[]>([]);
  const agentActivity = ref<Record<string, AgentActivity>>({});
  const actionsTick = ref(0);
  const machines = ref<Machine[]>([]);

  const loadServerInfo = async () => {
    try {
      const info = await api.serverInfo();
      channels.value = info.channels;
      agents.value = info.agents;
      humans.value = info.humans;
      if (selectedChannelId.value == null) selectedChannelId.value = info.channels[0]?.id ?? null;
      error.value = null;
    } catch (e) {
      error.value = (e as Error).message;
    }
  };

  const loadChannel = async (channelId: string) => {
    const [msgs, tks] = await Promise.all([api.messages(channelId), api.tasks(channelId)]);
    if (selectedChannelId.value === channelId) {
      messages.value = msgs;
      tasks.value = tks;
      // 看过即标记已读:推进 read 游标 → 该频道未读清零;再刷 server-info 更新徽标
      const maxSeq = msgs.reduce((m, x) => Math.max(m, x.seq), 0);
      if (maxSeq > 0) {
        try { await api.markRead(channelId, maxSeq); } catch { /* 忽略 */ }
      }
      void loadServerInfo();
    }
  };

  // 初始化:设 token → 拉 server-info → 连 WS
  let disconnect: (() => void) | null = null;
  onMounted(() => {
    setToken(token);
    void loadServerInfo();
    disconnect = connectWs(
      token,
      (e) => {
        if (e.type === "message.created" || e.type === "task.updated" || e.type === "reaction.updated") {
          const ch = selectedChannelId.value;
          if (ch) void loadChannel(ch);
          else void loadServerInfo(); // 没选频道也刷新未读徽标
        } else if (e.type === "action.prepared" || e.type === "action.updated") {
          actionsTick.value += 1; // 触发 ActionsView 重拉
          if (e.type === "action.updated") void loadServerInfo(); // 执行后可能新建了频道/agent
        } else if (e.type === "machine.updated") {
          // 机器上线/下线 → 刷新 Computers 列表,同时刷新 agents:
          // agent.online 由「所属机器是否在线」派生,机器状态变了 agent 状态也得跟着变。
          void refreshMachines();
          void loadServerInfo();
        } else if (e.type === "agent.activity") {
          // 全局收集(不再按频道过滤):头像角标等需要跨频道反映 agent 状态。
          // 频道底部的活动条在消费侧按 channelId 过滤。
          const next = { ...agentActivity.value };
          if (TERMINAL_ACTIVITIES.has(e.activity)) delete next[e.agentHandle];
          else next[e.agentHandle] = { activity: e.activity, detail: e.detail, ts: Date.now(), channelId: e.channelId };
          agentActivity.value = next;
        }
      },
      (v) => { connected.value = v; },
    );
  });
  onUnmounted(() => { disconnect?.(); });

  // 切换频道时加载其消息/任务(活动指示是全局的,不在切换时清空)
  watch(selectedChannelId, (id) => {
    if (id) void loadChannel(id);
  });

  // 过期清理:超过 TTL 未更新的活动视为已结束
  let ttlTimer: ReturnType<typeof setInterval> | null = null;
  onMounted(() => {
    ttlTimer = setInterval(() => {
      const now = Date.now();
      const prev = agentActivity.value;
      const next: Record<string, AgentActivity> = {};
      let changed = false;
      for (const [h, a] of Object.entries(prev)) {
        if (now - a.ts < ACTIVITY_TTL_MS) next[h] = a;
        else changed = true;
      }
      if (changed) agentActivity.value = next;
    }, 4000);
  });
  onUnmounted(() => { if (ttlTimer) clearInterval(ttlTimer); });

  // 派生全站单一状态源:agents 的 online + 实时 activity → 每个 handle 的状态
  const agentStatus = computed<Record<string, AgentStatusInfo>>(() => {
    const map: Record<string, AgentStatusInfo> = {};
    for (const a of agents.value) map[a.handle] = deriveStatus(a.online, agentActivity.value[a.handle]);
    // activity 可能先于 agents 列表到达(或来自不在列表的 handle):兜底补全
    for (const [handle, act] of Object.entries(agentActivity.value)) {
      if (!map[handle]) map[handle] = deriveStatus(true, act);
    }
    return map;
  });

  const selectChannel = (id: string) => { selectedChannelId.value = id; };

  const send = async (content: string, asTask?: boolean) => {
    if (!selectedChannelId.value) return;
    await api.send(selectedChannelId.value, content, asTask ? { asTask: true } : undefined);
    await loadChannel(selectedChannelId.value);
  };

  const claimTask = async (taskId: string) => {
    await api.claimTask(taskId);
    if (selectedChannelId.value) await loadChannel(selectedChannelId.value);
  };
  const setTaskStatus = async (taskId: string, status: string) => {
    await api.setTaskStatus(taskId, status);
    if (selectedChannelId.value) await loadChannel(selectedChannelId.value);
  };
  const unclaimTask = async (taskId: string) => {
    await api.unclaimTask(taskId);
    if (selectedChannelId.value) await loadChannel(selectedChannelId.value);
  };
  // 拖拽流转:确保认领(幂等)后改状态。被他人认领则 setStatus 抛错由卡片提示。
  const moveTask = async (taskId: string, status: string) => {
    try { await api.claimTask(taskId); } catch { /* 已被他人认领 → 下一步会失败并提示 */ }
    await api.setTaskStatus(taskId, status);
    if (selectedChannelId.value) await loadChannel(selectedChannelId.value);
  };

  const createTask = async (title: string) => {
    if (!selectedChannelId.value) return;
    await api.createTask(selectedChannelId.value, title);
    await loadChannel(selectedChannelId.value);
  };

  const reply = async (parentId: string, content: string) => {
    if (!selectedChannelId.value) return;
    await api.send(selectedChannelId.value, content, { threadParentId: parentId });
    await loadChannel(selectedChannelId.value);
  };

  // 线程回复 + 附件:在该线程下发消息拿到 id,逐个上传附件锚定到该消息,刷新。
  const replyWithFiles = async (parentId: string, content: string, files: File[]) => {
    if (!selectedChannelId.value) return;
    const text = content.trim() || (files.length ? files.map((f) => f.name).join(", ") : "");
    if (!text) return;
    const msg = await api.send(selectedChannelId.value, text, { threadParentId: parentId });
    for (const f of files) await api.uploadAttachment(selectedChannelId.value, msg.id, f);
    await loadChannel(selectedChannelId.value);
  };

  // 发消息 + 附件:先发消息拿到 id,再把每个文件上传锚定到该消息,最后刷新。
  const sendWithFiles = async (content: string, asTask: boolean, files: File[]) => {
    if (!selectedChannelId.value) return;
    const text = content.trim() || (files.length ? files.map((f) => f.name).join(", ") : "");
    if (!text) return;
    const msg = await api.send(selectedChannelId.value, text, asTask ? { asTask: true } : {});
    for (const f of files) await api.uploadAttachment(selectedChannelId.value, msg.id, f);
    await loadChannel(selectedChannelId.value);
  };

  // 收藏 toggle:已收藏则取消,否则收藏;完成后刷新当前频道(更新书签态)。
  const toggleSave = async (messageId: string, saved: boolean) => {
    if (saved) await api.unsaveMessage(messageId);
    else await api.saveMessage(messageId);
    if (selectedChannelId.value) await loadChannel(selectedChannelId.value);
  };

  // 表情反应 toggle:已反应过则去,否则加;完成后刷新当前频道。
  const toggleReaction = async (messageId: string, emoji: string, mine: boolean) => {
    if (!selectedChannelId.value) return;
    if (mine) await api.removeReaction(selectedChannelId.value, messageId, emoji);
    else await api.addReaction(selectedChannelId.value, messageId, emoji);
    await loadChannel(selectedChannelId.value);
  };

  const search = (query: string) => api.search(query);

  const createAgent = async (input: NewAgentInput) => {
    const agent = await api.createAgent(input);
    await loadServerInfo();
    return agent;
  };

  const importAgent = async (input: ImportRaftInput) => {
    const agent = await api.importAgent(input);
    await loadServerInfo();
    return agent;
  };

  const editAgent = async (handle: string, patch: AgentPatch) => {
    const agent = await api.updateAgent(handle, patch);
    await loadServerInfo();
    return agent;
  };
  const removeAgent = async (handle: string) => {
    await api.deleteAgent(handle);
    await loadServerInfo();
  };

  const createChannel = async (input: { name: string; description?: string; isPrivate?: boolean; members?: Array<{ type: "agent" | "human"; id: string }> }) => {
    const ch = await api.createChannel(input);
    await loadServerInfo();
    selectedChannelId.value = ch.id;
    return ch.id;
  };
  const joinChannel = async (channelId: string) => {
    await api.joinChannel(channelId); await loadServerInfo();
  };
  const leaveChannel = async (channelId: string) => {
    await api.leaveChannel(channelId); await loadServerInfo();
  };
  const archiveChannel = async (channelId: string, archived: boolean) => {
    await api.archiveChannel(channelId, archived); await loadServerInfo();
  };
  const addChannelMember = async (channelId: string, member: { type: "agent" | "human"; id: string }) => {
    const members = await api.addChannelMember(channelId, member);
    await loadServerInfo(); // 刷新头部人数徽标
    return members;
  };
  const removeChannelMember = async (channelId: string, member: { type: "agent" | "human"; id: string }) => {
    const members = await api.removeChannelMember(channelId, member);
    await loadServerInfo();
    return members;
  };

  // 打开与某 agent 的 DM:建/取频道 → 刷新列表 → 选中,返回频道 id
  const openDm = async (agentHandle: string) => {
    const ch = await api.openDm(agentHandle);
    await loadServerInfo();
    selectedChannelId.value = ch.id;
    return ch.id;
  };

  const refreshMachines = async () => {
    try { machines.value = await api.machines(); } catch { /* 忽略 */ }
  };
  const createMachine = async (name?: string) => {
    const r = await api.createMachine(name);
    await refreshMachines();
    return r;
  };
  const renameMachine = async (id: string, name: string) => {
    const m = await api.renameMachine(id, name);
    await refreshMachines();
    return m;
  };
  const deleteMachine = async (id: string) => {
    await api.deleteMachine(id);
    await refreshMachines();
    await loadServerInfo(); // 机器上的 agent 被解绑(machineId→null),刷新 agent 列表
  };

  // 初次加载机器列表
  onMounted(() => { void refreshMachines(); });

  // reactive 包装:消费侧用 c.channels / c.connected 即自动解包 ref(与 React 的 c.x 访问一致)
  return reactive({
    connected, error, channels, agents, humans,
    selectedChannelId, messages, tasks, agentActivity, agentStatus,
    selectChannel, send, reply, createTask, search, createAgent, importAgent, editAgent, removeAgent, openDm,
    createChannel, joinChannel, leaveChannel, archiveChannel, addChannelMember, removeChannelMember,
    claimTask, setTaskStatus, unclaimTask, moveTask, toggleReaction, toggleSave, sendWithFiles, replyWithFiles,
    machines, refreshMachines, createMachine, renameMachine, deleteMachine,
    actionsTick,
  }) as CrewState;
}
