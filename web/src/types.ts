export type ActorType = "human" | "agent" | "system";
export interface Actor { type: ActorType; id: string }

export interface Channel {
  id: string;
  slug: string;
  name: string | null;
  description: string | null;
  kind: "channel" | "dm";
  isPrivate: boolean;
  archived: boolean;
  joined: boolean;
  unread: number;
  memberCount?: number; // 本频道真实成员数(serverInfo 提供;头部人数徽标用)
}
export interface Member {
  handle: string;
  displayName: string;
  kind: "agent" | "human";
  description?: string;
  status?: string;
  online?: boolean; // agent 所属电脑 daemon 是否在线
  avatarUrl?: string | null;
}
export interface ServerInfo {
  channels: Channel[];
  agents: Member[];
  humans: Member[];
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean; // 当前用户是否反应过
}
export interface AttachmentMeta {
  id: string;
  filename: string;
  mime: string;
  size: number;
  url: string; // 需带 token 经 fetch 取
}
export interface ChannelFile extends AttachmentMeta {
  uploader: Actor;
  createdAt: string;
}
export interface Me {
  tier: string;
  actor: Actor;
  handle?: string;
  displayName: string;
  email?: string | null;
  workspace: { id: string; name: string; slug: string };
}
export interface ActionCard {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: "pending" | "executed" | "dismissed";
  channelId: string | null;
  preparedBy: Actor;
  executedBy: Actor | null;
  resultRef: string | null;
  createdAt: string;
}
export interface Message {
  id: string;
  channelId: string;
  seq: number;
  type: ActorType;
  sender: Actor;
  content: string;
  threadParentId: string | null;
  createdAt: string;
  reactions?: ReactionSummary[];
  attachments?: AttachmentMeta[];
  saved?: boolean; // 当前用户是否收藏
}

export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "closed";
export interface Task {
  id: string;
  number: number;
  title: string;
  status: TaskStatus;
  assignee: Actor | null;
  createdBy: Actor | null;
  channelId: string;
  messageId: string; // 锚定的消息(点任务卡 → 打开它的 thread)
}

export type RealtimeEvent =
  | { type: "ready"; workspaceId: string }
  | { type: "message.created"; message: Message }
  | { type: "reaction.updated"; channelId: string; messageId: string }
  | { type: "action.prepared"; actionId: string }
  | { type: "action.updated"; actionId: string }
  | { type: "task.updated"; taskId: string }
  | { type: "agent.activity"; agentHandle: string; channelId: string; activity: string; detail: string; seq: number }
  | { type: "machine.updated"; machineId: string; status: "online" | "offline" };

export interface AgentActivity { activity: string; detail: string; ts: number; channelId: string }

/** 派生出的 agent 实时状态(单一数据源):驱动全站头像角标 / 状态点的颜色与文案。 */
export type AgentStatusKind = "online" | "busy" | "offline";
export interface AgentStatusInfo {
  kind: AgentStatusKind; // online=绿 / busy=黄 / offline=灰
  label: string;         // "Online" | "Offline" | "thinking" 等
  activity?: string;     // busy 时的原始活动字符串
}

/** Persisted activity history row (Activity timeline). */
export interface AgentActivityItem {
  id: string;
  agentHandle: string;
  channelId: string | null;
  activity: string;
  detail: string;
  seq: number;
  createdAt: string;
}

/** agent 完整档案 (Members 详情 Profile 用)。 */
export type AgentProvider = "default" | "custom";
export type AgentReasoning = "default" | "low" | "medium" | "high";
export interface AgentRuntimeConfig {
  provider: AgentProvider;
  providerBaseUrl: string | null;
  providerApiKey: string | null;
  reasoning: AgentReasoning;
  fastMode: boolean;
}
export interface AgentProfile extends AgentRuntimeConfig {
  id: string;
  handle: string;
  displayName: string;
  description: string;
  avatarUrl: string | null;
  runtime: string;
  model: string | null;
  status: string;
  machineId: string | null;
  createdAt: string;
}
export interface ImportRaftInput {
  machineId: string;
  raftPath: string;
  name?: string;
  description?: string;
  runtime?: string;
}
export interface RaftInspectResult {
  name: string;
  description: string;
  fileCount: number;
  entries: string[];
}
export interface NewAgentInput {
  avatarUrl?: string | null;
  handle: string;
  displayName: string;
  description?: string;
  runtime?: string;
  model?: string;
  machineId?: string;
  provider?: AgentProvider;
  providerBaseUrl?: string | null;
  providerApiKey?: string | null;
  reasoning?: AgentReasoning;
  fastMode?: boolean;
}

/** Agent workspace file tree (served by the daemon). */
export interface FsEntry { name: string; type: "dir" | "file"; size?: number }
export interface FsList { root: string; path: string; entries: FsEntry[] }
export interface FsFile { path: string; content: string; truncated: boolean; size: number }

/** Agent skill (from workspace ./skills or global ~/.claude/skills). */
export interface SkillInfo { scope: "workspace" | "global"; name: string; description: string }

/** Channel member (type+id+role); displayName resolved from serverInfo. */
export interface ChannelMember { memberType: "human" | "agent" | "system"; memberId: string; role: string }

/** Activity timeline item (@me / reply / my task). */
export interface ActivityFeedItem {
  id: string;
  kind: "mention" | "reply" | "task";
  at: string;
  channelId: string;
  actorType: string;
  actorId: string;
  text: string;
  meta?: string;
}

/** Editable agent fields (handle is immutable). null clears model/machine. */
export interface AgentPatch {
  displayName?: string;
  description?: string;
  avatarUrl?: string | null;
  runtime?: string;
  model?: string | null;
  machineId?: string | null;
  provider?: AgentProvider;
  providerBaseUrl?: string | null;
  providerApiKey?: string | null;
  reasoning?: AgentReasoning;
  fastMode?: boolean;
}

/** 运行 daemon 的电脑。 */
export interface Machine {
  id: string;
  name: string;
  hostname: string | null;
  os: string | null;
  daemonVersion: string | null;
  runtimes: string[];
  status: string; // online | offline
  tokenPrefix: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}
/** 新建机器返回:机器 + 明文 token + 在该电脑终端执行的连接命令。 */
export interface CreateMachineResult {
  machine: Machine;
  token: string;
  connectCommand: string;
}
