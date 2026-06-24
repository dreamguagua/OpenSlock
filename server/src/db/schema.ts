/**
 * Drizzle schema —— M1 数据模型 (PostgreSQL)。
 *
 * 多租户:除 workspace 自身外,每张表都带 workspace_id,且启用 RLS (见 migrations 的
 * rls 文件)。多态成员统一用 `*_type` + `*_id` 两列 (human/agent/system)。
 *
 * 完整字段语义见 04 文档;此处为可执行的落地版 (M1 子集)。
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  boolean,
  jsonb,
  primaryKey,
  unique,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const actorTypeEnum = pgEnum("actor_type", ["human", "agent", "system"]);
export const channelKindEnum = pgEnum("channel_kind", ["channel", "dm"]);
export const messageTypeEnum = pgEnum("message_type", ["human", "agent", "system"]);
export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "closed", // 不处理直接关闭(不占看板列;可重新打开)
]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---- 租户根 ----
export const workspace = pgTable("workspace", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // 创建者(全局账号);账号删除则置空(工作区不随之消失)。
  createdByAccountId: uuid("created_by_account_id").references((): AnyPgColumn => account.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// ---- 成员:人 (工作区内的人物档案:handle + displayName) ----
// 账号↔工作区↔角色 的权威关系见非-RLS 的 membership 表(登录/切换需跨工作区查)。
export const appUser = pgTable("app_user", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: createdAt(),
}, (t) => ({
  uniqHandle: unique("uq_user_handle").on(t.workspaceId, t.handle),
}));

// ---- 机器 (运行 daemon 的电脑;agent 跑在某台机器上) ----
// 每台机器绑定一个 sk_machine_* 凭证 (credential.subject = {machine, machineId})。
// status/lastSeenAt 由控制面连接在线状态驱动;os/runtimes 由 daemon 上报 machine:hello。
export const machine = pgTable("machine", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // 展示名 (默认取 hostname)
  hostname: text("hostname"), // daemon 上报
  os: text("os"), // 如 "darwin arm64"
  daemonVersion: text("daemon_version"),
  runtimes: jsonb("runtimes").notNull().default(sql`'[]'::jsonb`), // 已检测到的 CLI: ["claude","codex"]
  status: text("status").notNull().default("offline"), // online | offline
  tokenPrefix: text("token_prefix"), // sk_machine_ 前 9 位,用于 UI 展示
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---- 成员:agent ----
export const agent = pgTable("agent", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description").notNull().default(""),
  avatarUrl: text("avatar_url"), // 自定义头像 (raft profile);空则用按 handle 生成的默认头像
  runtime: text("runtime").notNull().default("claude"),
  model: text("model"),
  // 运行时配置:provider(default|custom BYOC) / reasoning / fast 模式
  provider: text("provider").notNull().default("default"), // default | custom
  providerBaseUrl: text("provider_base_url"), // custom: ANTHROPIC_BASE_URL
  providerApiKey: text("provider_api_key"), // custom: ANTHROPIC_API_KEY (dev 明文,后续应加密)
  reasoning: text("reasoning").notNull().default("default"), // default | low | medium | high
  fastMode: boolean("fast_mode").notNull().default(false),
  status: text("status").notNull().default("idle"),
  machineId: uuid("machine_id").references(() => machine.id, { onDelete: "set null" }),
  createdByHandle: text("created_by_handle"), // 创建该 agent 的人(app_user.handle);用于 Human 详情页"Created Agents"
  createdAt: createdAt(),
}, (t) => ({
  uniqHandle: unique("uq_agent_handle").on(t.workspaceId, t.handle),
}));

// ---- 频道 ----
export const channel = pgTable("channel", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name"), // 展示名 (slug 是唯一键)
  description: text("description"), // 用途描述 —— 频道感知靠它
  kind: channelKindEnum("kind").notNull().default("channel"),
  isPrivate: boolean("is_private").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }), // 归档后拒写
  createdAt: createdAt(),
}, (t) => ({
  uniqSlug: unique("uq_channel_slug").on(t.workspaceId, t.slug),
}));

// ---- 频道成员 (多态) + 已读游标 ----
export const channelMember = pgTable("channel_member", {
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channel.id, { onDelete: "cascade" }),
  memberType: actorTypeEnum("member_type").notNull(),
  memberId: text("member_id").notNull(),
  role: text("role").notNull().default("member"), // owner | admin | member
  lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
  createdAt: createdAt(),
}, (t) => ({
  pk: primaryKey({ columns: [t.channelId, t.memberType, t.memberId] }),
}));

// ---- 消息 (seq 单调 + 线程自引用 + 多态 sender) ----
export const message = pgTable("message", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channel.id, { onDelete: "cascade" }),
  seq: bigint("seq", { mode: "number" }).notNull(),
  type: messageTypeEnum("type").notNull(),
  senderType: actorTypeEnum("sender_type").notNull(),
  senderId: text("sender_id").notNull(),
  content: text("content").notNull(),
  // 中文全文检索:CJK 二元分词 token(GIN @> 包含匹配,见 search-tokenize.ts)
  searchTokens: text("search_tokens").array(),
  threadParentId: uuid("thread_parent_id"),
  createdAt: createdAt(),
}, (t) => ({
  // 关键不变量:同一频道内 seq 唯一 (并发分配的兜底)
  uniqSeq: unique("uq_message_channel_seq").on(t.channelId, t.seq),
  byChannelSeq: index("idx_message_channel_seq").on(t.channelId, t.seq),
}));

// ---- @提及 (解析消息正文里的 @handle,精确驱动 activity / 未来唤醒) ----
export const mention = pgTable("mention", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  messageId: uuid("message_id")
    .notNull()
    .references(() => message.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channel.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(), // 被 @ 的 handle(精确匹配,胜过 ilike 子串)
  createdAt: createdAt(),
}, (t) => ({
  byHandle: index("idx_mention_handle").on(t.workspaceId, t.handle),
}));

// ---- 消息表情反应 (raft message react) ----
export const reaction = pgTable("reaction", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  messageId: uuid("message_id")
    .notNull()
    .references(() => message.id, { onDelete: "cascade" }),
  actorType: actorTypeEnum("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: createdAt(),
}, (t) => ({
  // 同一 actor 对同一消息同一 emoji 只能有一条 (toggle 语义)
  uniq: unique("uq_reaction_msg_actor_emoji").on(t.messageId, t.actorType, t.actorId, t.emoji),
  byMessage: index("idx_reaction_message").on(t.messageId),
}));

// ---- 附件 (raft attachment:agent 产出物/上传文件,字节存对象/本地存储,此表存元数据) ----
export const attachment = pgTable("attachment", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  // 当前锚定到消息;后续可扩展其它 owner(留 nullable)
  messageId: uuid("message_id").references(() => message.id, { onDelete: "cascade" }),
  uploaderType: actorTypeEnum("uploader_type").notNull(),
  uploaderId: text("uploader_id").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(), // blob store 里的键 (<ws>/<id>)
  createdAt: createdAt(),
}, (t) => ({
  byMessage: index("idx_attachment_message").on(t.messageId),
}));

// ---- 集成登录 (raft integration:记录 agent 已登录的三方服务;凭证本身在 daemon 隔离的 XDG 目录) ----
export const agentLogin = pgTable("agent_login", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentHandle: text("agent_handle").notNull(),
  integration: text("integration").notNull(), // gh | gcloud | aws | ...(自由)
  createdAt: createdAt(),
}, (t) => ({
  uniq: unique("uq_agent_login").on(t.agentHandle, t.integration),
}));

// ---- 操作卡 (raft action prepare:agent 备好动作,人点击后以本人身份执行) ----
export const actionStatusEnum = pgEnum("action_status", ["pending", "executed", "dismissed"]);
export const actionCard = pgTable("action_card", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // channel:create | agent:create
  payload: jsonb("payload").notNull(), // 动作参数(按 kind 校验)
  status: actionStatusEnum("status").notNull().default("pending"),
  channelId: uuid("channel_id").references(() => channel.id, { onDelete: "set null" }), // 卡片出现的频道(可空)
  preparedByType: actorTypeEnum("prepared_by_type").notNull(),
  preparedById: text("prepared_by_id").notNull(),
  executedByType: actorTypeEnum("executed_by_type"),
  executedById: text("executed_by_id"),
  resultRef: text("result_ref"), // 执行后创建出的资源标识(如新频道 slug / 新 agent handle)
  createdAt: createdAt(),
  executedAt: timestamp("executed_at", { withTimezone: true }),
}, (t) => ({
  byStatus: index("idx_action_card_status").on(t.workspaceId, t.status),
}));

// ---- 线程退订 (raft thread unfollow:agent 对某线程停止普通推送) ----
export const threadUnfollow = pgTable("thread_unfollow", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentHandle: text("agent_handle").notNull(), // 唤醒按 handle 路由,故存 handle
  threadId: uuid("thread_id").notNull(), // 线程父消息 id
  createdAt: createdAt(),
}, (t) => ({
  uniq: unique("uq_thread_unfollow").on(t.agentHandle, t.threadId),
  byThread: index("idx_thread_unfollow_thread").on(t.threadId),
}));

// ---- 收藏消息 (raft Saved:每个成员书签自己的消息) ----
export const saved = pgTable("saved", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  actorType: actorTypeEnum("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  messageId: uuid("message_id")
    .notNull()
    .references(() => message.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => ({
  uniq: unique("uq_saved_actor_message").on(t.actorType, t.actorId, t.messageId),
  byActor: index("idx_saved_actor").on(t.actorType, t.actorId),
}));

// ---- 被 freshness hold 的草稿 ----
export const draft = pgTable("draft", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channel.id, { onDelete: "cascade" }),
  authorType: actorTypeEnum("author_type").notNull(),
  authorId: text("author_id").notNull(),
  content: text("content").notNull(),
  heldAtSeq: bigint("held_at_seq", { mode: "number" }).notNull(),
  createdAt: createdAt(),
});

// ---- 任务 (claim-before-work) ----
export const task = pgTable("task", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channel.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  // 子任务:指向父任务(任务拆分);顶层任务为 null。父删→子的 parent 置空
  parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => task.id, { onDelete: "set null" }),
  messageId: uuid("message_id")
    .notNull()
    .references(() => message.id, { onDelete: "cascade" }),
  assigneeType: actorTypeEnum("assignee_type"),
  assigneeId: text("assignee_id"),
  status: taskStatusEnum("status").notNull().default("todo"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  anchoredOnSystemMessage: boolean("anchored_on_system_message")
    .notNull()
    .default(false),
  createdByType: actorTypeEnum("created_by_type"),
  createdById: text("created_by_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  uniqNumber: unique("uq_task_number").on(t.workspaceId, t.number),
  byBoard: index("idx_task_board").on(t.workspaceId, t.channelId, t.status),
  byAssignee: index("idx_task_assignee").on(t.workspaceId, t.assigneeType, t.assigneeId),
}));

// ---- agent 活动历史 (Activity 时间线;daemon 经控制面上报后落库) ----
export const agentActivity = pgTable("agent_activity", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentHandle: text("agent_handle").notNull(),
  channelId: uuid("channel_id").references(() => channel.id, { onDelete: "set null" }),
  activity: text("activity").notNull(), // working|thinking|reading|sending|claiming|checking|done|error
  detail: text("detail").notNull().default(""),
  seq: integer("seq").notNull().default(0),
  createdAt: createdAt(),
}, (t) => ({
  byAgent: index("idx_activity_agent").on(t.workspaceId, t.agentHandle, t.createdAt),
}));

// ---- freshness 游标:某 agent 在某频道"模型已看过"的最大 seq ----
export const agentSeen = pgTable("agent_seen", {
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channel.id, { onDelete: "cascade" }),
  modelSeenSeq: bigint("model_seen_seq", { mode: "number" }).notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.agentId, t.channelId] }),
}));

// ---- 凭证 (鉴权引导表;故意不加 RLS:鉴权时尚不知 workspace,需按 token_hash 全局查) ----
export const credentialTierEnum = pgEnum("credential_tier", [
  "user",
  "machine",
  "agent",
]);

export const credential = pgTable("credential", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  tier: credentialTierEnum("tier").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  subjectType: actorTypeEnum("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  byHash: index("idx_credential_hash").on(t.tokenHash),
}));

// ---- 提醒 (巡检/定时:到点唤醒 owner) ----
export const reminderKindEnum = pgEnum("reminder_kind", ["once", "recurring"]);
export const reminderStatusEnum = pgEnum("reminder_status", [
  "scheduled",
  "snoozed",
  "cancelled",
  "done",
]);

export const reminder = pgTable("reminder", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  ownerType: actorTypeEnum("owner_type").notNull(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  anchorChannelId: uuid("anchor_channel_id").references(() => channel.id, {
    onDelete: "set null",
  }),
  anchorMessageId: uuid("anchor_message_id"),
  kind: reminderKindEnum("kind").notNull(),
  fireAt: timestamp("fire_at", { withTimezone: true }), // once
  cron: text("cron"), // recurring
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  nextFireAt: timestamp("next_fire_at", { withTimezone: true }), // 调度器轮询字段
  status: reminderStatusEnum("status").notNull().default("scheduled"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  byOwner: index("idx_reminder_owner").on(t.workspaceId, t.ownerType, t.ownerId),
  byDue: index("idx_reminder_due").on(t.nextFireAt),
}));

// ---- 提醒事件流 (reminder log) ----
export const reminderEventKindEnum = pgEnum("reminder_event_kind", [
  "scheduled",
  "fired",
  "snoozed",
  "updated",
  "cancelled",
  "dismissed",
]);

export const reminderEvent = pgTable("reminder_event", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  reminderId: uuid("reminder_id")
    .notNull()
    .references(() => reminder.id, { onDelete: "cascade" }),
  kind: reminderEventKindEnum("kind").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  detail: jsonb("detail"),
}, (t) => ({
  byReminder: index("idx_reminder_event_reminder").on(t.reminderId, t.at),
}));

// ---- 登录账号 (全局身份;故意不加 RLS:登录时尚不知 workspace,需按 email 全局查) ----
// 一个 account 可加入多个工作区(成员身份见 app_user.account_id + role)。
// workspaceId/handle 现为"最近活跃工作区"的便捷指针(可空),不再是唯一归属。
export const account = pgTable("account", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"), // 账号用户名(注册 Create Account 填写;可作各工作区默认 displayName)
  workspaceId: uuid("workspace_id").references((): AnyPgColumn => workspace.id, { onDelete: "set null" }), // 最近活跃工作区
  handle: text("handle"), // 最近活跃工作区里的 handle(便捷;权威值在 app_user)
  createdAt: createdAt(),
});

// ---- 成员身份 (account ↔ workspace ↔ role 的权威关系) ----
// 故意不加 RLS:登录/列出我的工作区/切换工作区 都需跨工作区按 account 全局查
// (与 account/credential 同属登录引导表)。工作区内的人物档案另见 app_user。
export const membership = pgTable("membership", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .references((): AnyPgColumn => account.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(), // 该账号在此工作区的 app_user.handle
  role: text("role").notNull().default("member"), // owner | admin | member
  createdAt: createdAt(),
}, (t) => ({
  uniqAccountWs: unique("uq_membership_account_ws").on(t.accountId, t.workspaceId),
  byAccount: index("idx_membership_account").on(t.accountId),
  byWsHandle: index("idx_membership_ws_handle").on(t.workspaceId, t.handle),
}));

// ---- 邀请链接 (raft invite:人点"+"生成可复用链接;未登录打开 → Join 页 → 登录/注册后自动入区) ----
// 与 account/credential 同属登录引导表:接受邀请发生在登录前,需按 token 全局查 → 不加 RLS。
export const invite = pgTable("invite", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(), // URL 里的随机串 (/join/<token>)
  role: text("role").notNull().default("member"), // 接受后赋予的工作区角色
  createdByHandle: text("created_by_handle").notNull(), // 生成邀请的人
  expiresAt: timestamp("expires_at", { withTimezone: true }), // 可空 = 永不过期
  revokedAt: timestamp("revoked_at", { withTimezone: true }), // 撤销后失效
  createdAt: createdAt(),
}, (t) => ({
  byToken: index("idx_invite_token").on(t.token),
}));

/** 所有带 workspace_id、需要 RLS 的租户表 (供迁移启用 RLS 遍历)。 */
export const TENANT_TABLES = [
  "app_user",
  "agent",
  "machine",
  "channel",
  "channel_member",
  "message",
  "mention",
  "reaction",
  "attachment",
  "saved",
  "thread_unfollow",
  "action_card",
  "agent_login",
  "draft",
  "task",
  "agent_seen",
  "agent_activity",
  "reminder",
  "reminder_event",
] as const;
