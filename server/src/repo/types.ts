/**
 * 仓储接口 (Repository Pattern)。
 *
 * Service 只依赖这些接口,不感知存储细节。内存实现 (repo/memory) 用于离线单测;
 * PG 实现 (repo/pg) 用于生产,把"原子 seq 分配""原子 claim"等不变量交给 DB。
 *
 * 所有方法都以 `workspaceId` 作为第一参数 —— 应用层强制租户隔离 (PG RLS 兜底)。
 */

import type { Actor } from "../domain/actor.js";
import type { ClaimResult, TaskStatus } from "../domain/claim.js";

export type MessageType = "human" | "agent" | "system";

export interface MessageRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly seq: number;
  readonly type: MessageType;
  readonly sender: Actor;
  readonly content: string;
  readonly threadParentId: string | null;
  readonly createdAt: string;
}

export interface NewMessage {
  readonly channelId: string;
  readonly type: MessageType;
  readonly sender: Actor;
  readonly content: string;
  readonly threadParentId?: string | null;
}

export interface MessageRepo {
  /** 原子分配 seq 并落库。生产实现用行锁/advisory lock 保证并发下无重复无空洞。 */
  append(workspaceId: string, msg: NewMessage): Promise<MessageRow>;
  latestSeq(workspaceId: string, channelId: string): Promise<number>;
  get(workspaceId: string, messageId: string): Promise<MessageRow | null>;
  list(
    workspaceId: string,
    channelId: string,
    opts?: { readonly afterSeq?: number | undefined; readonly limit?: number | undefined },
  ): Promise<MessageRow[]>;
  /** 关键词检索 (子串)。RLS 已把范围限定在本 workspace 可见消息。 */
  search(
    workspaceId: string,
    opts: { readonly query: string; readonly channelId?: string | undefined; readonly limit?: number | undefined },
  ): Promise<MessageRow[]>;
  /** 核实一条消息是否存在:按完整 id 或 8 位短码定位,返回 canonical 行或 null。 */
  resolve(workspaceId: string, idOrPrefix: string): Promise<MessageRow | null>;
}

// ---- 消息表情反应 (raft message react) ----
/** 某条消息上某 actor 的一个 emoji 反应(未聚合的原始行)。 */
export interface ReactionRow {
  readonly messageId: string;
  readonly emoji: string;
  readonly actorType: "human" | "agent" | "system";
  readonly actorId: string;
}
export interface ReactionRepo {
  /** 加一个反应;同 actor 同 emoji 已存在则幂等(无操作)。 */
  add(workspaceId: string, messageId: string, actor: Actor, emoji: string): Promise<void>;
  /** 移除一个反应;不存在则无操作。 */
  remove(workspaceId: string, messageId: string, actor: Actor, emoji: string): Promise<void>;
  /** 取这批消息上的所有反应原始行(供聚合)。 */
  listForMessages(workspaceId: string, messageIds: readonly string[]): Promise<ReactionRow[]>;
}

// ---- 附件 (raft attachment) ----
export interface AttachmentRow {
  readonly id: string;
  readonly messageId: string | null;
  readonly uploader: Actor;
  readonly filename: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly createdAt: string;
}
export interface NewAttachment {
  readonly id: string; // 由 service 预生成 (storageKey 需要它)
  readonly messageId: string | null;
  readonly uploader: Actor;
  readonly filename: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
}
export interface AttachmentRepo {
  create(workspaceId: string, a: NewAttachment): Promise<AttachmentRow>;
  get(workspaceId: string, id: string): Promise<AttachmentRow | null>;
  listForMessages(workspaceId: string, messageIds: readonly string[]): Promise<AttachmentRow[]>;
  /** 某频道内所有附件(经其消息关联),按上传时间倒序 —— Files tab 用。 */
  listForChannel(workspaceId: string, channelId: string): Promise<AttachmentRow[]>;
}

// ---- 集成登录 (raft integration) ----
export interface AgentLoginRow {
  readonly integration: string;
  readonly createdAt: string;
}
export interface IntegrationRepo {
  /** 记录 agent 已登录某集成(幂等)。 */
  recordLogin(workspaceId: string, agentHandle: string, integration: string): Promise<void>;
  /** 移除某集成登录记录(登出)。 */
  removeLogin(workspaceId: string, agentHandle: string, integration: string): Promise<void>;
  /** 列出某 agent 已登录的集成。 */
  list(workspaceId: string, agentHandle: string): Promise<AgentLoginRow[]>;
}

// ---- 操作卡 (raft action prepare) ----
export type ActionStatus = "pending" | "executed" | "dismissed";
export interface ActionCardRow {
  readonly id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly status: ActionStatus;
  readonly channelId: string | null;
  readonly preparedBy: Actor;
  readonly executedBy: Actor | null;
  readonly resultRef: string | null;
  readonly createdAt: string;
}
export interface NewActionCard {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly channelId?: string | null;
  readonly preparedBy: Actor;
}
export interface ActionCardRepo {
  create(workspaceId: string, a: NewActionCard): Promise<ActionCardRow>;
  get(workspaceId: string, id: string): Promise<ActionCardRow | null>;
  listPending(workspaceId: string): Promise<ActionCardRow[]>;
  /** 标记结束态(executed/dismissed),只在仍 pending 时生效;返回更新后的行或 null(已非 pending/不存在)。 */
  resolve(workspaceId: string, id: string, status: "executed" | "dismissed", executedBy: Actor, resultRef?: string | null): Promise<ActionCardRow | null>;
}

// ---- 线程退订 (raft thread unfollow) ----
export interface ThreadAttentionRepo {
  /** agent 退订某线程(幂等)。 */
  unfollow(workspaceId: string, agentHandle: string, threadId: string): Promise<void>;
  /** 重新关注(移除退订记录;不存在则无操作)。 */
  follow(workspaceId: string, agentHandle: string, threadId: string): Promise<void>;
  /** 该线程被哪些 agent 退订了(供唤醒时跳过)。 */
  unfollowedHandles(workspaceId: string, threadId: string): Promise<Set<string>>;
}

// ---- 收藏消息 (raft Saved) ----
export interface SavedRepo {
  /** 收藏一条消息;已收藏则幂等。 */
  add(workspaceId: string, actor: Actor, messageId: string): Promise<void>;
  /** 取消收藏;未收藏则无操作。 */
  remove(workspaceId: string, actor: Actor, messageId: string): Promise<void>;
  /** 列出某成员收藏的消息(按收藏时间倒序)。 */
  listForActor(workspaceId: string, actor: Actor): Promise<MessageRow[]>;
  /** 这批消息里哪些被该成员收藏了(供消息 GET 标记 saved)。 */
  savedSet(workspaceId: string, actor: Actor, messageIds: readonly string[]): Promise<Set<string>>;
}

// ---- server info (环境感知) ----
export interface ChannelInfo {
  readonly id: string;
  readonly slug: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly kind: "channel" | "dm";
  readonly isPrivate: boolean;
  readonly archived: boolean;
  readonly joined: boolean; // 调用方是否为成员
  readonly unread: number; // 调用方在该频道的未读数 (latestSeq - lastReadSeq)
  readonly memberCount?: number; // 本频道真实成员数 (仅 serverInfo 填充;头部人数徽标用)
}
export interface MemberInfo {
  readonly handle: string;
  readonly displayName: string;
  readonly kind: "agent" | "human";
  readonly description?: string | undefined;
  readonly status?: string | undefined;
  readonly online?: boolean | undefined; // agent 所属电脑 daemon 是否在线
  readonly avatarUrl?: string | null | undefined; // 自定义头像 (agent)
}
export interface ServerInfo {
  readonly channels: readonly ChannelInfo[];
  readonly agents: readonly MemberInfo[];
  readonly humans: readonly MemberInfo[];
}

export interface WorkspaceInfo {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}
export interface DirectoryRepo {
  /** 列出工作区的频道(含调用方的 joined / unread)、agents、humans。 */
  serverInfo(workspaceId: string, viewer?: Actor): Promise<ServerInfo>;
  /** 工作区元信息(name/slug)。不存在返回 null。 */
  workspace(workspaceId: string): Promise<WorkspaceInfo | null>;
}

export interface NewChannel {
  readonly name: string;
  readonly description?: string | null;
  readonly isPrivate?: boolean;
  /** 创建时一并拉入的初始成员(agent / human);creator 自动为 owner,无需重复列出。 */
  readonly members?: ReadonlyArray<{ readonly type: "agent" | "human"; readonly id: string }>;
}
export interface ChannelMemberInfo {
  readonly memberType: "human" | "agent" | "system";
  readonly memberId: string;
  readonly role: string; // owner | admin | member
}
export type ChannelMutation =
  | { readonly kind: "ok"; readonly channel: ChannelInfo }
  | { readonly kind: "not_found" }
  | { readonly kind: "forbidden" }; // 如私密频道不可自助加入

/** 增/删频道成员的结果。invalid = 目标 agent/human 在工作区不存在。 */
export type ChannelMemberMutation =
  | { readonly kind: "ok" }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid" };

export interface ChannelRepo {
  /** 取/建 human 与某 agent 的 1:1 DM 频道 (kind=dm),确保双方都是成员。幂等。 */
  getOrCreateDm(
    workspaceId: string,
    human: Actor,
    agentHandle: string,
    agentDisplayName: string,
  ): Promise<ChannelInfo>;
  /** 若 channelId 是 DM 频道,返回其 agent 对端 handle;否则 null。供 DM 自动唤醒用。 */
  dmPeerHandle(workspaceId: string, channelId: string): Promise<string | null>;
  /** 新建普通频道 (kind=channel);creator 入成员并设 owner。slug 由 name 派生且唯一。 */
  create(workspaceId: string, input: NewChannel, creator: Actor): Promise<ChannelInfo>;
  /** 列频道成员 (type+id+role);displayName 由调用方用 serverInfo 解析。 */
  listMembers(workspaceId: string, channelId: string): Promise<ChannelMemberInfo[]>;
  /** 加入公开频道 (私密→forbidden;不存在→not_found;已是成员→幂等 ok)。 */
  join(workspaceId: string, actor: Actor, channelId: string): Promise<ChannelMutation>;
  /** 退出频道 (移除成员)。 */
  leave(workspaceId: string, actor: Actor, channelId: string): Promise<ChannelMutation>;
  /** 把任意 agent/human 加入频道 (幂等)。频道不存在→not_found;目标不存在→invalid。 */
  addMember(
    workspaceId: string,
    channelId: string,
    member: { readonly type: "agent" | "human"; readonly id: string },
    role?: string,
  ): Promise<ChannelMemberMutation>;
  /** 从频道移除任意成员 (幂等)。 */
  removeMember(
    workspaceId: string,
    channelId: string,
    member: { readonly type: "agent" | "human"; readonly id: string },
  ): Promise<ChannelMemberMutation>;
  /** 归档/取消归档频道 (archived_at)。返回是否命中该频道。 */
  setArchived(workspaceId: string, channelId: string, archived: boolean): Promise<boolean>;
  /** 频道是否已归档 (归档后拒写)。频道不存在视为未归档。 */
  isArchived(workspaceId: string, channelId: string): Promise<boolean>;
}

// ---- Activity 时间线 (汇总:@我 / 回复我 / 我的任务变更) ----
export interface ActivityFeedItem {
  readonly id: string; // 来源 message/task id
  readonly kind: "mention" | "reply" | "task";
  readonly at: string; // ISO 时间,用于排序
  readonly channelId: string;
  readonly actorType: string; // 触发者
  readonly actorId: string;
  readonly text: string; // 消息正文 / 任务标题
  readonly meta?: string | undefined; // 如任务状态
}
export interface FeedRepo {
  /** 给某成员的活动时间线,最新在前。 */
  activity(workspaceId: string, viewer: Actor, limit?: number): Promise<ActivityFeedItem[]>;
}

// ---- 机器 (运行 daemon 的电脑) ----
export interface MachineRow {
  readonly id: string;
  readonly name: string;
  readonly hostname: string | null;
  readonly os: string | null;
  readonly daemonVersion: string | null;
  readonly runtimes: readonly string[];
  readonly status: string; // online | offline
  readonly tokenPrefix: string | null;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
}
export interface NewMachine {
  readonly name: string;
  readonly tokenPrefix?: string;
}
/** daemon 上报的机器信息 (machine:hello)。 */
export interface MachineInfoPatch {
  readonly hostname?: string | undefined;
  readonly os?: string | undefined;
  readonly daemonVersion?: string | undefined;
  readonly runtimes?: readonly string[] | undefined;
}
export interface MachineRepo {
  list(workspaceId: string): Promise<MachineRow[]>;
  get(workspaceId: string, id: string): Promise<MachineRow | null>;
  create(workspaceId: string, m: NewMachine): Promise<MachineRow>;
  rename(workspaceId: string, id: string, name: string): Promise<MachineRow | null>;
  /** 记录凭证前缀 (新建后 mint token 才得到,用于 UI 展示)。 */
  setTokenPrefix(workspaceId: string, id: string, prefix: string): Promise<void>;
  /** 在线状态切换 (控制面连接/断开驱动);online 时刷新 lastSeenAt。 */
  setStatus(workspaceId: string, id: string, status: "online" | "offline"): Promise<void>;
  /** 启动时全部置 offline (server 重启后内存连接清空,DB 状态需归零;daemon 重连再标 online)。 */
  resetAllOffline(): Promise<void>;
  /** daemon hello 上报的机器信息。 */
  updateInfo(workspaceId: string, id: string, patch: MachineInfoPatch): Promise<void>;
}

// ---- agent 管理 ----
/** 运行时配置 (Provider / Reasoning / Fast mode);daemon 启动时透传。 */
export type AgentProvider = "default" | "custom";
export type AgentReasoning = "default" | "low" | "medium" | "high";
export interface AgentRuntimeConfig {
  readonly provider: AgentProvider;
  readonly providerBaseUrl: string | null;
  readonly providerApiKey: string | null;
  readonly reasoning: AgentReasoning;
  readonly fastMode: boolean;
}

export interface AgentRow extends AgentRuntimeConfig {
  readonly id: string;
  readonly handle: string;
  readonly displayName: string;
  readonly description: string;
  readonly avatarUrl: string | null;
  readonly runtime: string;
  readonly model: string | null;
  readonly status: string;
  readonly machineId: string | null; // 跑在哪台机器上
  readonly createdAt: string;
}
export interface NewAgent {
  readonly handle: string;
  readonly displayName: string;
  readonly description?: string;
  readonly avatarUrl?: string | null;
  readonly runtime?: string;
  readonly model?: string;
  readonly machineId?: string | null;
  readonly provider?: AgentProvider;
  readonly providerBaseUrl?: string | null;
  readonly providerApiKey?: string | null;
  readonly reasoning?: AgentReasoning;
  readonly fastMode?: boolean;
}
export type AgentCreateOutcome =
  | { readonly kind: "ok"; readonly agent: AgentRow }
  | { readonly kind: "duplicate" }; // handle 已存在

/** agent 可编辑字段 (handle 不可改 —— 它是消息/任务里的稳定引用)。 */
export interface AgentPatch {
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly avatarUrl?: string | null | undefined;
  readonly runtime?: string | undefined;
  readonly model?: string | null | undefined;
  readonly machineId?: string | null | undefined;
  readonly provider?: AgentProvider | undefined;
  readonly providerBaseUrl?: string | null | undefined;
  readonly providerApiKey?: string | null | undefined;
  readonly reasoning?: AgentReasoning | undefined;
  readonly fastMode?: boolean | undefined;
}

export interface AgentRepo {
  list(workspaceId: string): Promise<AgentRow[]>;
  get(workspaceId: string, handle: string): Promise<AgentRow | null>;
  create(workspaceId: string, a: NewAgent): Promise<AgentCreateOutcome>;
  /** 部分更新;agent 不存在返回 null。 */
  update(workspaceId: string, handle: string, patch: AgentPatch): Promise<AgentRow | null>;
  /** 删除;返回是否删到。 */
  remove(workspaceId: string, handle: string): Promise<boolean>;
}

// ---- agent 活动历史 ----
export interface AgentActivityRow {
  readonly id: string;
  readonly agentHandle: string;
  readonly channelId: string | null;
  readonly activity: string;
  readonly detail: string;
  readonly seq: number;
  readonly createdAt: string;
}
export interface NewAgentActivity {
  readonly agentHandle: string;
  readonly channelId: string | null;
  readonly activity: string;
  readonly detail: string;
  readonly seq: number;
}
export interface AgentActivityRepo {
  append(workspaceId: string, a: NewAgentActivity): Promise<void>;
  /** 某 agent 的活动历史,最新在前。 */
  list(workspaceId: string, handle: string, limit?: number): Promise<AgentActivityRow[]>;
}

// ---- 提醒 ----
export type ReminderKind = "once" | "recurring";
export type ReminderStatus = "scheduled" | "snoozed" | "cancelled" | "done";
export type ReminderEventKind =
  | "scheduled" | "fired" | "snoozed" | "updated" | "cancelled" | "dismissed";

export interface ReminderRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly owner: Actor;
  readonly title: string;
  readonly anchorChannelId: string | null;
  readonly anchorMessageId: string | null;
  readonly kind: ReminderKind;
  readonly fireAt: string | null;
  readonly cron: string | null;
  readonly timezone: string;
  readonly nextFireAt: string | null;
  readonly status: ReminderStatus;
}

export interface NewReminder {
  readonly owner: Actor;
  readonly title: string;
  readonly anchorChannelId?: string | null;
  readonly anchorMessageId?: string | null;
  readonly kind: ReminderKind;
  readonly fireAt?: Date | null;
  readonly cron?: string | null;
  readonly timezone: string;
  readonly nextFireAt: Date | null;
}

export interface ReminderPatch {
  readonly title?: string | undefined;
  readonly nextFireAt?: Date | undefined;
  readonly cron?: string | undefined;
  readonly timezone?: string | undefined;
  readonly status?: ReminderStatus | undefined;
}

export interface ReminderEventRow {
  readonly id: string;
  readonly reminderId: string;
  readonly kind: ReminderEventKind;
  readonly at: string;
  readonly detail: unknown;
}

export type ReminderOutcome =
  | { readonly kind: "ok"; readonly reminder: ReminderRow }
  | { readonly kind: "not_found" }
  | { readonly kind: "forbidden" }; // 非 owner

export interface ReminderRepo {
  create(workspaceId: string, r: NewReminder): Promise<ReminderRow>;
  get(workspaceId: string, id: string): Promise<ReminderRow | null>;
  list(workspaceId: string, owner?: Actor): Promise<ReminderRow[]>;
  /** owner-scoped 更新 (snooze/update/cancel 复用)。 */
  update(workspaceId: string, id: string, owner: Actor, patch: ReminderPatch): Promise<ReminderOutcome>;
  appendEvent(
    workspaceId: string,
    reminderId: string,
    kind: ReminderEventKind,
    detail?: unknown,
  ): Promise<void>;
  listEvents(workspaceId: string, reminderId: string): Promise<ReminderEventRow[]>;
  /** 跨 workspace 扫描到点的提醒 (worker 用;遍历 workspace 后逐租户查)。 */
  dueAcrossWorkspaces(
    now: Date,
    limit: number,
  ): Promise<Array<{ workspaceId: string; reminder: ReminderRow }>>;
  /** 触发后:置下次时间(recurring)或终态(once→done)。系统调用,不校验 owner。 */
  markFired(
    workspaceId: string,
    id: string,
    nextFireAt: Date | null,
    status: ReminderStatus,
  ): Promise<void>;
}

export interface DraftRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly author: Actor;
  readonly content: string;
  /** 被 hold 时频道的最新 seq —— 供 agent 复核增量。 */
  readonly heldAtSeq: number;
  readonly createdAt: string;
}

export interface DraftRepo {
  create(
    workspaceId: string,
    draft: Omit<DraftRow, "id" | "workspaceId" | "createdAt">,
  ): Promise<DraftRow>;
}

export interface TaskRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly number: number;
  readonly title: string;
  readonly messageId: string;
  readonly parentTaskId: string | null;
  readonly assignee: Actor | null;
  readonly createdBy: Actor | null;
  readonly status: TaskStatus;
  readonly anchoredOnSystemMessage: boolean;
}

export interface NewTask {
  readonly channelId: string;
  readonly title: string;
  readonly messageId: string;
  readonly createdBy: Actor;
  readonly parentTaskId?: string | null;
  readonly anchoredOnSystemMessage?: boolean;
}

export interface TaskListFilter {
  readonly channelId?: string | undefined;
  readonly status?: TaskStatus | undefined;
  readonly assignee?: Actor | undefined;
}

/** unclaim / updateStatus 的原子结果。 */
export type TaskMutationOutcome =
  | { readonly kind: "ok"; readonly task: TaskRow }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict" }; // 并发下条件不再满足 (如已被改)

export interface TaskRepo {
  get(workspaceId: string, taskId: string): Promise<TaskRow | null>;
  /** 原子抢占。生产实现:条件 UPDATE ... WHERE assignee IS NULL + 部分唯一索引。 */
  claim(
    workspaceId: string,
    taskId: string,
    claimant: Actor,
  ): Promise<ClaimResult>;
  list(workspaceId: string, filter?: TaskListFilter): Promise<TaskRow[]>;
  /** 分配每-workspace 单调 number(原子)并落库。 */
  create(workspaceId: string, task: NewTask): Promise<TaskRow>;
  /** 原子释放:仅当 assignee 仍是 actor 时生效;status 改为给定值。 */
  unclaim(
    workspaceId: string,
    taskId: string,
    actor: Actor,
    nextStatus: TaskStatus,
  ): Promise<TaskMutationOutcome>;
  /** 原子改状态:仅当 assignee 仍是 actor 且未 done 时生效。 */
  updateStatus(
    workspaceId: string,
    taskId: string,
    actor: Actor,
    nextStatus: TaskStatus,
  ): Promise<TaskMutationOutcome>;
  /**
   * 指派/交接:无条件把 assignee 设为给定 actor(覆盖现有 assignee,用于自动指派与 handoff)。
   * 与 claim 不同——claim 只在未分配时生效;assign 由服务层做权限判定后调用。
   * todo 会一并推进到 in_progress;done 终态不可指派。
   */
  assign(
    workspaceId: string,
    taskId: string,
    assignee: Actor,
  ): Promise<TaskMutationOutcome>;
  /**
   * 跨 workspace 扫描「无主且超时」的 todo 任务(防漏巡检用)。
   * 条件:assignee 为空 + status=todo + createdAt < olderThan。
   */
  staleOrphansAcrossWorkspaces(
    olderThan: Date,
    limit: number,
  ): Promise<ReadonlyArray<{ workspaceId: string; task: TaskRow }>>;
}

/** 某 agent 的模型在某频道"已看过"的最大 seq (freshness 游标)。 */
export interface SeenCursorRepo {
  get(workspaceId: string, agentId: string, channelId: string): Promise<number>;
  advance(
    workspaceId: string,
    agentId: string,
    channelId: string,
    seq: number,
  ): Promise<number>;
}

/** 某成员对某频道的已读游标 (last_read_seq)。 */
export interface ReadStateRepo {
  get(workspaceId: string, member: Actor, channelId: string): Promise<number>;
  advance(
    workspaceId: string,
    member: Actor,
    channelId: string,
    seq: number,
  ): Promise<number>;
}
