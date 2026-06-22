/**
 * 把仓储 + 实时总线组装成路由层使用的 AppServices。
 * 路由不直接 new service / 不感知 repo 细节,便于注入 (PG 或内存) 做测试。
 */

import { MessageService, type SendInput, type SendResult } from "../services/message.service.js";
import {
  TaskService,
  type ClaimSuccess,
  type CreateTaskInput,
} from "../services/task.service.js";
import { ReadStateService } from "../services/read-state.service.js";
import { DirectoryService } from "../services/directory.service.js";
import {
  ReminderService,
  type ReminderScheduleInput,
} from "../services/reminder.service.js";
import { WakeService, type WakeMessage, type RosterEntry, type TriageTask } from "../services/wake.service.js";
import { AgentService } from "../services/agent.service.js";
import { ReactionService, type ReactionSummary } from "../services/reaction.service.js";
import { AttachmentService, type AttachmentDTO, type ChannelFileDTO } from "../services/attachment.service.js";
import { SavedService } from "../services/saved.service.js";
import { ActionService } from "../services/action.service.js";
import { type BlobStore, defaultBlobStore } from "../storage/blob-store.js";
import { MachineService, type MintFn } from "../services/machine.service.js";
import { DaemonHub, defaultDaemonHub } from "../realtime/daemon-hub.js";
import { DomainError } from "../domain/errors.js";
import type {
  AgentActivityRepo,
  AgentActivityRow,
  NewAgentActivity,
  AgentPatch,
  AgentRepo,
  AgentRow,
  ChannelInfo,
  ChannelRepo,
  ChannelMemberInfo,
  ChannelMemberMutation,
  ChannelMutation,
  NewChannel,
  ActivityFeedItem,
  FeedRepo,
  DirectoryRepo,
  DraftRepo,
  MachineInfoPatch,
  MachineRepo,
  MachineRow,
  MessageRepo,
  MessageRow,
  NewAgent,
  ReactionRepo,
  AttachmentRepo,
  AttachmentRow,
  SavedRepo,
  ThreadAttentionRepo,
  ActionCardRepo,
  ActionCardRow,
  IntegrationRepo,
  AgentLoginRow,
  ReadStateRepo,
  ReminderEventRow,
  ReminderRepo,
  ReminderRow,
  SeenCursorRepo,
  ServerInfo,
  WorkspaceInfo,
  TaskListFilter,
  TaskRepo,
  TaskRow,
} from "../repo/types.js";
import type { Actor } from "../domain/actor.js";
import type { EmitFn } from "../realtime/bus.js";

export interface AppRepos {
  readonly messages: MessageRepo;
  readonly reactions: ReactionRepo;
  readonly attachments: AttachmentRepo;
  readonly saved: SavedRepo;
  readonly threadAttention: ThreadAttentionRepo;
  readonly actionCards: ActionCardRepo;
  readonly integrations: IntegrationRepo;
  readonly drafts: DraftRepo;
  readonly tasks: TaskRepo;
  readonly seen: SeenCursorRepo;
  readonly readState: ReadStateRepo;
  readonly directory: DirectoryRepo;
  readonly channels: ChannelRepo;
  readonly feed: FeedRepo;
  readonly reminders: ReminderRepo;
  readonly agents: AgentRepo;
  readonly machines: MachineRepo;
  readonly activities: AgentActivityRepo;
}

export interface AppServices {
  readonly messages: {
    sendAsAgent(ws: string, agent: Actor, input: SendInput): Promise<SendResult>;
    sendAsHuman(ws: string, human: Actor, input: SendInput): Promise<MessageRow>;
    listForActor(
      ws: string,
      channelId: string,
      opts?: { afterSeq?: number | undefined; limit?: number | undefined },
    ): Promise<MessageRow[]>;
    search(
      ws: string,
      opts: { query: string; channelId?: string | undefined; limit?: number | undefined },
    ): Promise<MessageRow[]>;
    resolve(ws: string, idOrPrefix: string): Promise<MessageRow>;
  };
  readonly reactions: {
    add(ws: string, actor: Actor, messageId: string, emoji: string): Promise<void>;
    remove(ws: string, actor: Actor, messageId: string, emoji: string): Promise<void>;
    /** 聚合这批消息的反应:messageId → [{emoji,count,mine}]。 */
    summaryFor(ws: string, messageIds: readonly string[], viewer: Actor): Promise<Map<string, ReactionSummary[]>>;
  };
  readonly attachments: {
    upload(ws: string, uploader: Actor, input: { messageId: string | null; filename: string; mime: string; data: Buffer }): Promise<AttachmentRow>;
    download(ws: string, id: string): Promise<{ row: AttachmentRow; data: Buffer }>;
    /** 聚合这批消息的附件:messageId → DTO[]。 */
    forMessages(ws: string, messageIds: readonly string[]): Promise<Map<string, AttachmentDTO[]>>;
    /** 某频道全部附件 (Files tab)。 */
    forChannel(ws: string, channelId: string): Promise<ChannelFileDTO[]>;
  };
  readonly threads: {
    /** agent 退订 / 重新关注某线程。 */
    unfollow(ws: string, agentHandle: string, threadId: string): Promise<void>;
    follow(ws: string, agentHandle: string, threadId: string): Promise<void>;
  };
  readonly integrations: {
    /** agent 记录/移除/列出自己已登录的三方集成(凭证本身在 daemon 隔离的 XDG 目录)。 */
    login(ws: string, agentHandle: string, integration: string): Promise<void>;
    logout(ws: string, agentHandle: string, integration: string): Promise<void>;
    list(ws: string, agentHandle: string): Promise<AgentLoginRow[]>;
  };
  readonly actions: {
    /** agent 备好一个操作卡(channel:create / agent:create)。 */
    prepare(ws: string, by: Actor, kind: string, payload: unknown, channelId?: string | null): Promise<ActionCardRow>;
    list(ws: string): Promise<ActionCardRow[]>;
    /** 人类执行(以本人身份)/ 驳回。 */
    execute(ws: string, human: Actor, id: string): Promise<ActionCardRow>;
    dismiss(ws: string, human: Actor, id: string): Promise<ActionCardRow>;
  };
  readonly saved: {
    save(ws: string, actor: Actor, messageId: string): Promise<void>;
    unsave(ws: string, actor: Actor, messageId: string): Promise<void>;
    list(ws: string, actor: Actor): Promise<MessageRow[]>;
    /** 这批消息里该成员收藏了哪些(供消息 GET 标 saved)。 */
    savedSet(ws: string, actor: Actor, messageIds: readonly string[]): Promise<Set<string>>;
  };
  readonly directory: {
    serverInfo(ws: string, viewer?: Actor): Promise<ServerInfo>;
    workspace(ws: string): Promise<WorkspaceInfo | null>;
  };
  readonly channels: {
    /** 打开/创建 human 与某 agent 的 DM 频道。 */
    openDm(ws: string, human: Actor, agentHandle: string): Promise<ChannelInfo>;
    dmPeerHandle(ws: string, channelId: string): Promise<string | null>;
    create(ws: string, input: NewChannel, creator: Actor): Promise<ChannelInfo>;
    listMembers(ws: string, channelId: string): Promise<ChannelMemberInfo[]>;
    join(ws: string, actor: Actor, channelId: string): Promise<ChannelMutation>;
    leave(ws: string, actor: Actor, channelId: string): Promise<ChannelMutation>;
    addMember(ws: string, channelId: string, member: { type: "agent" | "human"; id: string }, role?: string): Promise<ChannelMemberMutation>;
    removeMember(ws: string, channelId: string, member: { type: "agent" | "human"; id: string }): Promise<ChannelMemberMutation>;
    /** 归档/取消归档;频道不存在抛 NOT_FOUND。 */
    setArchived(ws: string, channelId: string, archived: boolean): Promise<void>;
  };
  readonly agents: {
    list(ws: string): Promise<AgentRow[]>;
    get(ws: string, handle: string): Promise<AgentRow | null>;
    create(ws: string, input: NewAgent): Promise<AgentRow>;
    update(ws: string, handle: string, patch: AgentPatch): Promise<AgentRow>;
    remove(ws: string, handle: string): Promise<void>;
    /** 预览:读 raft 工作区的 MEMORY.md,反填 name/description(不建 agent、不复制)。 */
    inspectRaft(ws: string, machineId: string, raftPath: string): Promise<RaftInspectData>;
    /** 导入一个已有的 raft agent:从其工作区复制内容并按 MEMORY.md 反填资料。 */
    importRaft(ws: string, input: ImportRaftInput): Promise<AgentRow>;
  };
  readonly machines: {
    list(ws: string): Promise<MachineRow[]>;
    get(ws: string, id: string): Promise<MachineRow | null>;
    /** 新建机器:签发 sk_machine_*,返回机器 + 明文 token + 连接命令。requestOrigin=客户端访问 server 的 base URL(用于生成命令里的可达地址)。 */
    create(ws: string, name?: string, requestOrigin?: string): Promise<{ machine: MachineRow; token: string; connectCommand: string }>;
    /** 为已有机器重新签发 token + 连接命令 (Generate Connect Command)。 */
    regenerateCommand(ws: string, id: string, requestOrigin?: string): Promise<{ token: string; connectCommand: string } | null>;
    rename(ws: string, id: string, name: string): Promise<MachineRow | null>;
    setStatus(ws: string, id: string, status: "online" | "offline"): Promise<void>;
    updateInfo(ws: string, id: string, patch: MachineInfoPatch): Promise<void>;
  };
  readonly tasks: {
    claim(ws: string, claimant: Actor, taskId: string): Promise<ClaimSuccess>;
    list(ws: string, filter?: TaskListFilter): Promise<TaskRow[]>;
    create(
      ws: string,
      creator: Actor,
      input: CreateTaskInput,
    ): Promise<{ task: TaskRow; message: MessageRow }>;
    createBatch(
      ws: string,
      creator: Actor,
      input: { channelId: string; titles: readonly string[]; parentTaskId?: string },
    ): Promise<Array<{ task: TaskRow; message: MessageRow }>>;
    createFromMessage(
      ws: string,
      creator: Actor,
      input: { channelId: string; title: string; messageId: string },
    ): Promise<TaskRow>;
    unclaim(ws: string, actor: Actor, taskId: string): Promise<TaskRow>;
    updateStatus(
      ws: string,
      actor: Actor,
      taskId: string,
      status: string,
    ): Promise<TaskRow>;
    assign(ws: string, byActor: Actor, taskId: string, toHandle: string): Promise<TaskRow>;
  };
  readonly reads: {
    markRead(ws: string, member: Actor, channelId: string, upToSeq: number): Promise<number>;
    unread(ws: string, member: Actor, channelId: string): Promise<number>;
  };
  readonly reminders: {
    schedule(ws: string, owner: Actor, input: ReminderScheduleInput): Promise<ReminderRow>;
    list(ws: string, owner: Actor): Promise<ReminderRow[]>;
    snooze(ws: string, owner: Actor, id: string, duration: string): Promise<ReminderRow>;
    update(
      ws: string, owner: Actor, id: string,
      patch: {
        title?: string | undefined; at?: string | undefined;
        in?: string | undefined; cron?: string | undefined;
      },
    ): Promise<ReminderRow>;
    cancel(ws: string, owner: Actor, id: string): Promise<ReminderRow>;
    log(ws: string, owner: Actor, id: string): Promise<ReminderEventRow[]>;
  };
  readonly wake: {
    onMessage(ws: string, msg: WakeMessage): Promise<string[]>;
    wakeAgent(ws: string, handle: string, channelId: string, content: string, senderId: string, threadParentId?: string | null): Promise<boolean>;
    triage(ws: string, roster: readonly RosterEntry[], task: TriageTask): Promise<boolean>;
  };
  readonly workspace: {
    /** 列目录 / 读文件 / 列技能:解析 agent→所属在线机器,经控制面 RPC 取。 */
    list(ws: string, handle: string, path: string): Promise<unknown>;
    read(ws: string, handle: string, path: string): Promise<unknown>;
    skills(ws: string, handle: string): Promise<unknown>;
  };
  readonly activities: {
    append(ws: string, a: NewAgentActivity): Promise<void>;
    list(ws: string, handle: string, limit?: number): Promise<AgentActivityRow[]>;
  };
  readonly feed: {
    activity(ws: string, viewer: Actor, limit?: number): Promise<ActivityFeedItem[]>;
  };
  readonly emit: EmitFn;
}

export function createServices(
  repos: AppRepos,
  emit: EmitFn,
  hub: DaemonHub = defaultDaemonHub,
  mint?: MintFn,
  store: BlobStore = defaultBlobStore(),
): AppServices {
  const messageSvc = new MessageService(repos.messages, repos.drafts, repos.seen, repos.channels);
  const taskSvc = new TaskService(repos.tasks, repos.seen, repos.messages);
  const readSvc = new ReadStateService(repos.readState, repos.seen, repos.messages);
  const dirSvc = new DirectoryService(repos.directory);
  const remSvc = new ReminderService(repos.reminders);
  const agentSvc = new AgentService(repos.agents);
  const reactionSvc = new ReactionService(repos.reactions);
  const actionSvc = new ActionService(repos.actionCards, {
    createChannel: async (ws, input, human) => {
      const ch = await repos.channels.create(ws, input, human);
      return { slug: ch.slug };
    },
    createAgent: async (ws, input) => {
      const a = await agentSvc.create(ws, { handle: input.handle, displayName: input.displayName, ...(input.description ? { description: input.description } : {}) });
      return { handle: a.handle };
    },
  });
  const attachmentSvc = new AttachmentService(repos.attachments, store);
  const savedSvc = new SavedService(repos.saved, repos.messages);
  const machineSvc = mint ? new MachineService(repos.machines, mint) : new MachineService(repos.machines);
  const wakeSvc = new WakeService(
    hub,
    async (ws) => (await repos.agents.list(ws)).map((a) => ({ handle: a.handle, machineId: a.machineId })),
    (ws, threadId) => repos.threadAttention.unfollowedHandles(ws, threadId),
    // 频道 agent 成员(人类消息广播投递)
    async (ws, channelId) =>
      (await repos.channels.listMembers(ws, channelId)).filter((m) => m.memberType === "agent").map((m) => m.memberId),
  );

  return {
    messages: {
      sendAsAgent: (ws, agent, input) => messageSvc.sendAsAgent(ws, agent, input),
      sendAsHuman: (ws, human, input) => messageSvc.sendAsHuman(ws, human, input),
      listForActor: (ws, channelId, opts) => repos.messages.list(ws, channelId, opts),
      search: (ws, opts) => messageSvc.search(ws, opts),
      resolve: (ws, idOrPrefix) => messageSvc.resolve(ws, idOrPrefix),
    },
    reactions: {
      add: (ws, actor, messageId, emoji) => reactionSvc.add(ws, actor, messageId, emoji),
      remove: (ws, actor, messageId, emoji) => reactionSvc.remove(ws, actor, messageId, emoji),
      summaryFor: (ws, messageIds, viewer) => reactionSvc.summaryFor(ws, messageIds, viewer),
    },
    attachments: {
      upload: (ws, uploader, input) => attachmentSvc.upload(ws, uploader, input),
      download: (ws, id) => attachmentSvc.download(ws, id),
      forMessages: (ws, messageIds) => attachmentSvc.forMessages(ws, messageIds),
      forChannel: (ws, channelId) => attachmentSvc.forChannel(ws, channelId),
    },
    threads: {
      unfollow: (ws, handle, threadId) => repos.threadAttention.unfollow(ws, handle, threadId),
      follow: (ws, handle, threadId) => repos.threadAttention.follow(ws, handle, threadId),
    },
    integrations: {
      login: (ws, h, name) => repos.integrations.recordLogin(ws, h, name),
      logout: (ws, h, name) => repos.integrations.removeLogin(ws, h, name),
      list: (ws, h) => repos.integrations.list(ws, h),
    },
    actions: {
      prepare: (ws, by, kind, payload, channelId) => actionSvc.prepare(ws, by, kind, payload, channelId),
      list: (ws) => actionSvc.list(ws),
      execute: (ws, human, id) => actionSvc.execute(ws, human, id),
      dismiss: (ws, human, id) => actionSvc.dismiss(ws, human, id),
    },
    saved: {
      save: (ws, actor, messageId) => savedSvc.save(ws, actor, messageId),
      unsave: (ws, actor, messageId) => savedSvc.unsave(ws, actor, messageId),
      list: (ws, actor) => savedSvc.list(ws, actor),
      savedSet: (ws, actor, messageIds) => savedSvc.savedSet(ws, actor, messageIds),
    },
    directory: {
      serverInfo: (ws, viewer) => dirSvc.serverInfo(ws, viewer),
      workspace: (ws) => dirSvc.workspace(ws),
    },
    agents: {
      list: (ws) => agentSvc.list(ws),
      get: (ws, handle) => agentSvc.get(ws, handle),
      create: (ws, input) => agentSvc.create(ws, input),
      update: (ws, handle, patch) => agentSvc.update(ws, handle, patch),
      remove: (ws, handle) => agentSvc.remove(ws, handle),
      inspectRaft: (ws, machineId, raftPath) => inspectRaftWorkspace(repos, hub, ws, machineId, raftPath),
      importRaft: (ws, input) => importRaftAgent(repos, hub, agentSvc, ws, input),
    },
    machines: {
      list: (ws) => machineSvc.list(ws),
      get: (ws, id) => machineSvc.get(ws, id),
      create: (ws, name, requestOrigin) => machineSvc.create(ws, name, requestOrigin),
      regenerateCommand: (ws, id, requestOrigin) => machineSvc.regenerateCommand(ws, id, requestOrigin),
      rename: (ws, id, name) => machineSvc.rename(ws, id, name),
      setStatus: (ws, id, status) => machineSvc.setStatus(ws, id, status),
      updateInfo: (ws, id, patch) => machineSvc.updateInfo(ws, id, patch),
    },
    // 注:wake 用 serverInfo() 取 agent 列表(无 viewer),不受影响
    reminders: {
      schedule: (ws, owner, input) => remSvc.schedule(ws, owner, input),
      list: (ws, owner) => remSvc.list(ws, owner),
      snooze: (ws, owner, id, dur) => remSvc.snooze(ws, owner, id, dur),
      update: (ws, owner, id, patch) => remSvc.update(ws, owner, id, patch),
      cancel: (ws, owner, id) => remSvc.cancel(ws, owner, id),
      log: (ws, owner, id) => remSvc.log(ws, owner, id),
    },
    wake: {
      onMessage: (ws, msg) => wakeSvc.onMessage(ws, msg),
      wakeAgent: (ws, handle, channelId, content, senderId, threadParentId) =>
        wakeSvc.wakeAgentByHandle(ws, handle, channelId, content, senderId, threadParentId),
      triage: (ws, roster, task) => wakeSvc.dispatchTriage(ws, roster, task),
    },
    channels: {
      openDm: async (ws, human, agentHandle) => {
        const agent = await repos.agents.get(ws, agentHandle);
        if (!agent) throw new DomainError("NOT_FOUND", `agent not found: ${agentHandle}`, { agentHandle });
        return repos.channels.getOrCreateDm(ws, human, agent.handle, agent.displayName);
      },
      dmPeerHandle: (ws, channelId) => repos.channels.dmPeerHandle(ws, channelId),
      create: (ws, input, creator) => repos.channels.create(ws, input, creator),
      listMembers: (ws, channelId) => repos.channels.listMembers(ws, channelId),
      join: (ws, actor, channelId) => repos.channels.join(ws, actor, channelId),
      leave: (ws, actor, channelId) => repos.channels.leave(ws, actor, channelId),
      addMember: (ws, channelId, member, role) => repos.channels.addMember(ws, channelId, member, role),
      removeMember: (ws, channelId, member) => repos.channels.removeMember(ws, channelId, member),
      setArchived: async (ws, channelId, archived) => {
        const found = await repos.channels.setArchived(ws, channelId, archived);
        if (!found) throw new DomainError("NOT_FOUND", `channel not found: ${channelId}`, { channelId });
      },
    },
    workspace: {
      list: (ws, handle, path) => workspaceFetch(repos, hub, ws, handle, "fs:list", path),
      read: (ws, handle, path) => workspaceFetch(repos, hub, ws, handle, "fs:read", path),
      skills: (ws, handle) => workspaceFetch(repos, hub, ws, handle, "skills:list", ""),
    },
    activities: {
      append: (ws, a) => repos.activities.append(ws, a),
      list: (ws, handle, limit) => repos.activities.list(ws, handle, limit),
    },
    feed: {
      activity: (ws, viewer, limit) => repos.feed.activity(ws, viewer, limit),
    },
    tasks: {
      claim: (ws, claimant, taskId) => taskSvc.claim(ws, claimant, taskId),
      list: (ws, filter) => taskSvc.list(ws, filter),
      create: (ws, creator, input) => taskSvc.create(ws, creator, input),
      createBatch: (ws, creator, input) => taskSvc.createBatch(ws, creator, input),
      createFromMessage: (ws, creator, input) => taskSvc.createFromMessage(ws, creator, input),
      unclaim: (ws, actor, taskId) => taskSvc.unclaim(ws, actor, taskId),
      updateStatus: (ws, actor, taskId, status) =>
        taskSvc.updateStatus(ws, actor, taskId, status),
      assign: (ws, byActor, taskId, toHandle) => taskSvc.assign(ws, byActor, taskId, toHandle),
    },
    reads: {
      markRead: (ws, member, channelId, upToSeq) =>
        readSvc.markRead(ws, member, channelId, upToSeq),
      unread: (ws, member, channelId) => readSvc.unread(ws, member, channelId),
    },
    emit,
  };
}

export interface ImportRaftInput {
  readonly machineId: string;
  readonly raftPath: string;
  readonly name?: string | undefined; // 留空则从 MEMORY.md 的 H1 反填
  readonly description?: string | undefined; // 留空则从 MEMORY.md 的 ## Role 反填
  readonly runtime?: string | undefined;
}

interface RaftInspectData {
  readonly name: string;
  readonly description: string;
  readonly fileCount: number;
}

/** 显示名 → 可 @ 的 ascii handle;无 ascii 可用时回退 "agent"。 */
function slugifyHandle(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 31);
  return s.length >= 2 ? s : "agent";
}

/** 在已有 handle 集合里取唯一名:base、base-2、base-3 … */
function uniqueHandle(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const cand = `${base.slice(0, 29)}-${i}`;
    if (!taken.has(cand)) return cand;
  }
  throw new DomainError("CONFLICT", `could not derive a unique handle from ${base}`, { base });
}

/** 校验机器在线 + RPC daemon inspect raft 工作区,返回反填的 name/description。 */
async function inspectRaftWorkspace(
  repos: AppRepos,
  hub: DaemonHub,
  ws: string,
  machineId: string,
  raftPath: string,
): Promise<RaftInspectData> {
  const machine = await repos.machines.get(ws, machineId);
  if (!machine) throw new DomainError("NOT_FOUND", `computer not found: ${machineId}`, { machineId });
  if (!hub.isMachineOnline(ws, machineId)) {
    throw new DomainError("CONFLICT", "The selected computer is offline; connect its daemon first", { machineId });
  }
  try {
    const res = await hub.request(ws, machineId, { type: "raft:inspect", handle: "", path: raftPath });
    if (!res.ok) throw new DomainError("VALIDATION", res.error ?? "could not read raft workspace", { raftPath });
    return res.data as RaftInspectData;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError("CONFLICT", (e as Error).message, { raftPath });
  }
}

/**
 * 导入一个已有的 raft agent:
 *   1. RPC daemon inspect raft 工作区 → 反填 name/description(含机器在线校验)
 *   2. 用新 uuid 建 agent 行(handle 由 name 派生并去重),绑定该机器
 *   3. RPC daemon 复制工作区用户内容到 <agentsRoot>/<handle>/;失败则回滚 agent 行
 */
async function importRaftAgent(
  repos: AppRepos,
  hub: DaemonHub,
  agentSvc: AgentService,
  ws: string,
  input: ImportRaftInput,
): Promise<AgentRow> {
  // 1) inspect:反填资料(同时校验机器存在/在线)
  const inspected = await inspectRaftWorkspace(repos, hub, ws, input.machineId, input.raftPath);

  const name = (input.name?.trim() || inspected.name || "").trim();
  if (!name) {
    throw new DomainError("VALIDATION", "Could not determine the agent name — MEMORY.md has no top-level heading; provide a name", { raftPath: input.raftPath });
  }
  const description = (input.description?.trim() || inspected.description || "").trim();

  // 2) 唯一 handle + 建 agent 行(新 uuid 由 repo 生成)
  const taken = new Set((await repos.agents.list(ws)).map((a) => a.handle));
  const handle = uniqueHandle(slugifyHandle(name), taken);
  const agent = await agentSvc.create(ws, {
    handle,
    displayName: name,
    machineId: input.machineId,
    runtime: input.runtime ?? "claude",
    ...(description ? { description } : {}),
  });

  // 3) import:复制工作区内容;失败回滚,避免留下空壳 agent
  try {
    const res = await hub.request(ws, input.machineId, { type: "raft:import", handle, path: input.raftPath });
    if (!res.ok) throw new DomainError("VALIDATION", res.error ?? "failed to copy workspace", { handle });
  } catch (e) {
    await agentSvc.remove(ws, handle).catch(() => {});
    if (e instanceof DomainError) throw e;
    throw new DomainError("CONFLICT", (e as Error).message, { handle });
  }

  return agent;
}

/**
 * 解析 agent→所属在线机器,经控制面 RPC 取其工作区目录/文件。
 * agent 不存在→NOT_FOUND;未绑定机器或机器离线→CONFLICT;fs 错误→VALIDATION。
 */
async function workspaceFetch(
  repos: AppRepos,
  hub: DaemonHub,
  ws: string,
  handle: string,
  type: "fs:list" | "fs:read" | "skills:list",
  path: string,
): Promise<unknown> {
  const agent = await repos.agents.get(ws, handle);
  if (!agent) throw new DomainError("NOT_FOUND", `agent not found: ${handle}`, { handle });
  if (!agent.machineId) throw new DomainError("CONFLICT", "Agent is not assigned to a computer; no workspace to view", { handle });
  if (!hub.isMachineOnline(ws, agent.machineId)) {
    throw new DomainError("CONFLICT", "The agent's computer is offline; cannot read its workspace", { handle });
  }
  let result;
  try {
    result = await hub.request(ws, agent.machineId, { type, handle, path });
  } catch (e) {
    throw new DomainError("CONFLICT", (e as Error).message, { handle });
  }
  if (!result.ok) throw new DomainError("VALIDATION", result.error ?? "fs error", { handle, path });
  return result.data;
}
