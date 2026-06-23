/**
 * 内存仓储 —— 仅供离线单测 service 逻辑使用 (非生产)。
 *
 * `MemoryStore` 持有所有状态并提供唯一命名的方法;`createMemoryRepos` 把它适配成
 * 各 repo 接口 (它们的 `get`/`advance` 同名但签名不同,故需适配而非直接 implements)。
 * 按 workspaceId 严格隔离 (越权返回 null/空,模拟 PG RLS)。
 *
 * seq 分配与 claim 在单线程 JS 下天然串行,据 domain 纯逻辑给出正确决策;真实并发
 * 原子性由 repo/pg + PostgreSQL 保证 (见集成测试)。
 */

import type { Actor } from "../../domain/actor.js";
import { actorEquals, actorEqualsNullable, formatActor } from "../../domain/actor.js";
import { decideClaim, type ClaimResult, type TaskStatus } from "../../domain/claim.js";
import { nextSeq } from "../../domain/seq.js";
import { advanceSeenCursor } from "../../domain/freshness.js";
import { advanceReadCursor } from "../../domain/unread.js";
import { cjkTokens, tokensMatch } from "../../domain/search-tokenize.js";
import { parseMentions } from "../../domain/mention.js";
import type {
  AgentActivityRepo,
  AgentActivityRow,
  AgentCreateOutcome,
  AgentPatch,
  AgentRepo,
  AgentRow,
  ChannelInfo,
  ChannelRepo,
  ChannelMemberInfo,
  ChannelMemberMutation,
  ChannelMutation,
  ActivityFeedItem,
  FeedRepo,
  NewAgentActivity,
  DirectoryRepo,
  DraftRepo,
  DraftRow,
  MachineInfoPatch,
  MachineRepo,
  MachineRow,
  MessageRepo,
  NewAgent,
  NewMachine,
  MessageRow,
  NewMessage,
  NewTask,
  NewAttachment,
  AttachmentRepo,
  AttachmentRow,
  SavedRepo,
  ThreadAttentionRepo,
  ActionCardRepo,
  ActionCardRow,
  ActionStatus,
  NewActionCard,
  IntegrationRepo,
  AgentLoginRow,
  NewChannel,
  WorkspaceInfo,
  ReactionRepo,
  ReactionRow,
  ReadStateRepo,
  ReminderRepo,
  SeenCursorRepo,
  TaskListFilter,
  TaskMutationOutcome,
  TaskRepo,
  TaskRow,
} from "../types.js";
import { createMemoryReminderRepo } from "./reminder.repo.js";

const FIXED_TS = new Date(0).toISOString(); // 固定时间戳,保证测试可重现

interface MemChannel {
  id: string; workspaceId: string; slug: string; name: string | null;
  description: string | null; kind: "channel" | "dm"; isPrivate: boolean; archived: boolean;
}
interface MemMember { workspaceId: string; handle: string; displayName: string; description?: string; status?: string; }
interface MemAgent extends MemMember {
  id: string; runtime: string; model: string | null; machineId: string | null; createdAt: string;
  avatarUrl?: string | null;
  provider?: string; providerBaseUrl?: string | null; providerApiKey?: string | null;
  reasoning?: string; fastMode?: boolean;
}
interface MemMachine {
  workspaceId: string; id: string; name: string;
  hostname: string | null; os: string | null; daemonVersion: string | null;
  runtimes: string[]; status: string; tokenPrefix: string | null;
  lastSeenAt: string | null; createdAt: string;
}
const toAgentRow = (a: MemAgent): AgentRow => ({
  id: a.id,
  handle: a.handle,
  displayName: a.displayName,
  description: a.description ?? "",
  avatarUrl: a.avatarUrl ?? null,
  runtime: a.runtime,
  model: a.model,
  status: a.status ?? "idle",
  machineId: a.machineId,
  provider: (a.provider ?? "default") as AgentRow["provider"],
  providerBaseUrl: a.providerBaseUrl ?? null,
  providerApiKey: a.providerApiKey ?? null,
  reasoning: (a.reasoning ?? "default") as AgentRow["reasoning"],
  fastMode: a.fastMode ?? false,
  createdAt: a.createdAt,
});

const toAttachmentRowMem = (a: AttachmentRow & { workspaceId: string }): AttachmentRow => ({
  id: a.id, messageId: a.messageId, uploader: a.uploader, filename: a.filename,
  mime: a.mime, sizeBytes: a.sizeBytes, storageKey: a.storageKey, createdAt: a.createdAt,
});

export class MemoryStore {
  private messages: MessageRow[] = [];
  private mentions: Array<{ workspaceId: string; messageId: string; channelId: string; handle: string }> = [];
  private reactions: Array<ReactionRow & { workspaceId: string }> = [];
  private attachments: Array<AttachmentRow & { workspaceId: string }> = [];
  private saved: Array<{ workspaceId: string; actorType: string; actorId: string; messageId: string; order: number }> = [];
  private threadUnfollows: Array<{ workspaceId: string; agentHandle: string; threadId: string }> = [];
  private actionCards: Array<ActionCardRow & { workspaceId: string }> = [];
  private logins: Array<{ workspaceId: string; agentHandle: string; integration: string }> = [];
  private drafts: DraftRow[] = [];
  private tasks = new Map<string, TaskRow>();
  private seen = new Map<string, number>();
  private read = new Map<string, number>();
  private channels: MemChannel[] = [];
  private agents: MemAgent[] = [];
  private machines: MemMachine[] = [];
  private activities: Array<AgentActivityRow & { workspaceId: string }> = [];
  private users: MemMember[] = [];
  private memberships = new Set<string>(); // `${ws}:${channelId}:${type}:${id}`
  private memberRoles = new Map<string, string>(); // 同 key → role (默认 member)
  private workspaces = new Map<string, { name: string; slug: string }>();
  private counter = 0;

  seedWorkspace(id: string, name: string, slug: string): void {
    this.workspaces.set(id, { name, slug });
  }
  workspaceInfo(ws: string): WorkspaceInfo {
    const w = this.workspaces.get(ws);
    return { id: ws, name: w?.name ?? ws, slug: w?.slug ?? ws };
  }

  private id(prefix: string): string {
    this.counter += 1;
    // 补零到 ≥8 位,贴近真实 uuid 长度 (线程短码 min(8) 等规则在内存测试下也成立)
    return `${prefix}_${String(this.counter).padStart(8, "0")}`;
  }

  // ---- messages ----
  appendMessage(workspaceId: string, msg: NewMessage): MessageRow {
    const seq = nextSeq(this.latestSeq(workspaceId, msg.channelId));
    const row: MessageRow = {
      id: this.id("msg"),
      workspaceId,
      channelId: msg.channelId,
      seq,
      type: msg.type,
      sender: msg.sender,
      content: msg.content,
      threadParentId: msg.threadParentId ?? null,
      createdAt: FIXED_TS,
    };
    this.messages = [...this.messages, row];
    // 记录 @提及(精确,供 activity)
    for (const handle of parseMentions(msg.content)) {
      this.mentions.push({ workspaceId, messageId: row.id, channelId: msg.channelId, handle });
    }
    return row;
  }

  latestSeq(workspaceId: string, channelId: string): number {
    return this.messages
      .filter((m) => m.workspaceId === workspaceId && m.channelId === channelId)
      .reduce((max, m) => Math.max(max, m.seq), 0);
  }

  addReaction(workspaceId: string, messageId: string, actor: Actor, emoji: string): void {
    const dup = this.reactions.some(
      (r) => r.workspaceId === workspaceId && r.messageId === messageId &&
        r.actorType === actor.type && r.actorId === actor.id && r.emoji === emoji,
    );
    if (dup) return; // 幂等
    this.reactions.push({ workspaceId, messageId, emoji, actorType: actor.type, actorId: actor.id });
  }

  removeReaction(workspaceId: string, messageId: string, actor: Actor, emoji: string): void {
    this.reactions = this.reactions.filter(
      (r) => !(r.workspaceId === workspaceId && r.messageId === messageId &&
        r.actorType === actor.type && r.actorId === actor.id && r.emoji === emoji),
    );
  }

  listReactionsFor(workspaceId: string, messageIds: readonly string[]): ReactionRow[] {
    const set = new Set(messageIds);
    return this.reactions
      .filter((r) => r.workspaceId === workspaceId && set.has(r.messageId))
      .map((r) => ({ messageId: r.messageId, emoji: r.emoji, actorType: r.actorType, actorId: r.actorId }));
  }

  createAttachment(workspaceId: string, a: NewAttachment): AttachmentRow {
    const row: AttachmentRow = {
      id: a.id,
      messageId: a.messageId,
      uploader: a.uploader,
      filename: a.filename,
      mime: a.mime,
      sizeBytes: a.sizeBytes,
      storageKey: a.storageKey,
      createdAt: FIXED_TS,
    };
    this.attachments.push({ ...row, workspaceId });
    return row;
  }
  getAttachment(workspaceId: string, id: string): AttachmentRow | null {
    const a = this.attachments.find((x) => x.workspaceId === workspaceId && x.id === id);
    return a ? toAttachmentRowMem(a) : null;
  }
  listAttachmentsFor(workspaceId: string, messageIds: readonly string[]): AttachmentRow[] {
    const set = new Set(messageIds);
    return this.attachments
      .filter((a) => a.workspaceId === workspaceId && a.messageId != null && set.has(a.messageId))
      .map(toAttachmentRowMem);
  }
  listAttachmentsForChannel(workspaceId: string, channelId: string): AttachmentRow[] {
    // 找出该频道的消息 id 集,再过滤附件 (内存里没有 join,手动关联)
    const msgIds = new Set(
      this.messages.filter((m) => m.workspaceId === workspaceId && m.channelId === channelId).map((m) => m.id),
    );
    return this.attachments
      .filter((a) => a.workspaceId === workspaceId && a.messageId != null && msgIds.has(a.messageId))
      .slice()
      .reverse() // 近似倒序 (插入序的逆)
      .map(toAttachmentRowMem);
  }

  addSaved(workspaceId: string, actor: Actor, messageId: string): void {
    const dup = this.saved.some(
      (x) => x.workspaceId === workspaceId && x.actorType === actor.type && x.actorId === actor.id && x.messageId === messageId,
    );
    if (dup) return;
    this.saved.push({ workspaceId, actorType: actor.type, actorId: actor.id, messageId, order: ++this.counter });
  }
  removeSaved(workspaceId: string, actor: Actor, messageId: string): void {
    this.saved = this.saved.filter(
      (x) => !(x.workspaceId === workspaceId && x.actorType === actor.type && x.actorId === actor.id && x.messageId === messageId),
    );
  }
  listSaved(workspaceId: string, actor: Actor): MessageRow[] {
    return this.saved
      .filter((x) => x.workspaceId === workspaceId && x.actorType === actor.type && x.actorId === actor.id)
      .sort((a, b) => b.order - a.order) // 收藏时间倒序
      .map((x) => this.getMessage(workspaceId, x.messageId))
      .filter((m): m is MessageRow => m != null);
  }
  savedSet(workspaceId: string, actor: Actor, messageIds: readonly string[]): Set<string> {
    const ids = new Set(messageIds);
    return new Set(
      this.saved
        .filter((x) => x.workspaceId === workspaceId && x.actorType === actor.type && x.actorId === actor.id && ids.has(x.messageId))
        .map((x) => x.messageId),
    );
  }

  unfollowThread(workspaceId: string, agentHandle: string, threadId: string): void {
    const dup = this.threadUnfollows.some(
      (x) => x.workspaceId === workspaceId && x.agentHandle === agentHandle && x.threadId === threadId,
    );
    if (!dup) this.threadUnfollows.push({ workspaceId, agentHandle, threadId });
  }
  followThread(workspaceId: string, agentHandle: string, threadId: string): void {
    this.threadUnfollows = this.threadUnfollows.filter(
      (x) => !(x.workspaceId === workspaceId && x.agentHandle === agentHandle && x.threadId === threadId),
    );
  }
  unfollowedThreadHandles(workspaceId: string, threadId: string): Set<string> {
    return new Set(
      this.threadUnfollows
        .filter((x) => x.workspaceId === workspaceId && x.threadId === threadId)
        .map((x) => x.agentHandle),
    );
  }

  createActionCard(workspaceId: string, a: NewActionCard): ActionCardRow {
    const row: ActionCardRow = {
      id: this.id("action"),
      kind: a.kind,
      payload: a.payload,
      status: "pending",
      channelId: a.channelId ?? null,
      preparedBy: a.preparedBy,
      executedBy: null,
      resultRef: null,
      createdAt: FIXED_TS,
    };
    this.actionCards.unshift({ ...row, workspaceId }); // 新卡在前
    return row;
  }
  getActionCard(workspaceId: string, id: string): ActionCardRow | null {
    const a = this.actionCards.find((x) => x.workspaceId === workspaceId && x.id === id);
    return a ? { ...a } : null;
  }
  listPendingActions(workspaceId: string): ActionCardRow[] {
    return this.actionCards.filter((x) => x.workspaceId === workspaceId && x.status === "pending").map((x) => ({ ...x }));
  }
  resolveActionCard(workspaceId: string, id: string, status: "executed" | "dismissed", executedBy: Actor, resultRef?: string | null): ActionCardRow | null {
    const a = this.actionCards.find((x) => x.workspaceId === workspaceId && x.id === id);
    if (!a || a.status !== "pending") return null; // 仅 pending 可结束(幂等防重复)
    const m = a as { status: ActionStatus; executedBy: Actor | null; resultRef: string | null };
    m.status = status;
    m.executedBy = executedBy;
    if (resultRef !== undefined) m.resultRef = resultRef;
    return { ...a };
  }

  recordLogin(workspaceId: string, agentHandle: string, integration: string): void {
    if (!this.logins.some((x) => x.workspaceId === workspaceId && x.agentHandle === agentHandle && x.integration === integration)) {
      this.logins.push({ workspaceId, agentHandle, integration });
    }
  }
  removeLogin(workspaceId: string, agentHandle: string, integration: string): void {
    this.logins = this.logins.filter((x) => !(x.workspaceId === workspaceId && x.agentHandle === agentHandle && x.integration === integration));
  }
  listLogins(workspaceId: string, agentHandle: string): AgentLoginRow[] {
    return this.logins
      .filter((x) => x.workspaceId === workspaceId && x.agentHandle === agentHandle)
      .sort((a, b) => a.integration.localeCompare(b.integration))
      .map((x) => ({ integration: x.integration, createdAt: FIXED_TS }));
  }

  getMessage(workspaceId: string, messageId: string): MessageRow | null {
    return (
      this.messages.find(
        (m) => m.workspaceId === workspaceId && m.id === messageId,
      ) ?? null
    );
  }

  listMessages(
    workspaceId: string,
    channelId: string,
    opts: { afterSeq?: number | undefined; limit?: number | undefined } = {},
  ): MessageRow[] {
    const after = opts.afterSeq ?? 0;
    const rows = this.messages
      .filter(
        (m) =>
          m.workspaceId === workspaceId &&
          m.channelId === channelId &&
          m.seq > after,
      )
      .sort((a, b) => a.seq - b.seq);
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  // ---- drafts ----
  createDraft(
    workspaceId: string,
    draft: Omit<DraftRow, "id" | "workspaceId" | "createdAt">,
  ): DraftRow {
    const row: DraftRow = {
      id: this.id("draft"),
      workspaceId,
      createdAt: FIXED_TS,
      ...draft,
    };
    this.drafts = [...this.drafts, row];
    return row;
  }

  listDrafts(workspaceId: string): readonly DraftRow[] {
    return this.drafts.filter((d) => d.workspaceId === workspaceId);
  }

  // ---- tasks ----
  seedTask(task: TaskRow): void {
    this.tasks.set(`${task.workspaceId}:${task.id}`, task);
  }

  getTask(workspaceId: string, taskId: string): TaskRow | null {
    return this.tasks.get(`${workspaceId}:${taskId}`) ?? null;
  }

  claimTask(workspaceId: string, taskId: string, claimant: Actor): ClaimResult {
    const key = `${workspaceId}:${taskId}`;
    const task = this.tasks.get(key);
    if (!task) return { kind: "not_claimable" };
    const result = decideClaim(task, claimant);
    if (result.kind === "claimed") {
      this.tasks.set(key, {
        ...task,
        assignee: result.assignee,
        status: result.status,
      });
    }
    return result;
  }

  listTasks(workspaceId: string, filter: TaskListFilter = {}): TaskRow[] {
    return [...this.tasks.values()]
      .filter((t) => t.workspaceId === workspaceId)
      .filter((t) => !filter.channelId || t.channelId === filter.channelId)
      .filter((t) => !filter.status || t.status === filter.status)
      .filter(
        (t) =>
          !filter.assignee ||
          (t.assignee !== null &&
            t.assignee.type === filter.assignee.type &&
            t.assignee.id === filter.assignee.id),
      )
      .sort((a, b) => a.number - b.number);
  }

  createTask(workspaceId: string, t: NewTask): TaskRow {
    const maxNumber = [...this.tasks.values()]
      .filter((x) => x.workspaceId === workspaceId)
      .reduce((mx, x) => Math.max(mx, x.number), 0);
    const row: TaskRow = {
      id: this.id("task"),
      workspaceId,
      channelId: t.channelId,
      number: maxNumber + 1,
      title: t.title,
      messageId: t.messageId,
      parentTaskId: t.parentTaskId ?? null,
      assignee: null,
      createdBy: t.createdBy,
      status: "todo",
      anchoredOnSystemMessage: t.anchoredOnSystemMessage ?? false,
    };
    this.tasks.set(`${workspaceId}:${row.id}`, row);
    return row;
  }

  unclaimTask(
    workspaceId: string,
    taskId: string,
    actor: Actor,
    nextStatus: TaskStatus,
  ): TaskMutationOutcome {
    const key = `${workspaceId}:${taskId}`;
    const task = this.tasks.get(key);
    if (!task) return { kind: "not_found" };
    if (!task.assignee || !actorEquals(task.assignee, actor)) {
      return { kind: "conflict" };
    }
    const updated: TaskRow = { ...task, assignee: null, status: nextStatus };
    this.tasks.set(key, updated);
    return { kind: "ok", task: updated };
  }

  updateTaskStatus(
    workspaceId: string,
    taskId: string,
    expectedAssignee: Actor | null,
    nextStatus: TaskStatus,
  ): TaskMutationOutcome {
    const key = `${workspaceId}:${taskId}`;
    const task = this.tasks.get(key);
    if (!task) return { kind: "not_found" };
    // 乐观并发:assignee 必须仍等于 service 读到的期望值(未被并发改派)。
    // 无终态限制——done/closed 可被重新打开。权限由 service 层判定,这里不再校验发起人。
    if (!actorEqualsNullable(task.assignee, expectedAssignee)) {
      return { kind: "conflict" };
    }
    const updated: TaskRow = { ...task, status: nextStatus };
    this.tasks.set(key, updated);
    return { kind: "ok", task: updated };
  }

  assignTask(workspaceId: string, taskId: string, assignee: Actor): TaskMutationOutcome {
    const key = `${workspaceId}:${taskId}`;
    const task = this.tasks.get(key);
    if (!task) return { kind: "not_found" };
    if (task.anchoredOnSystemMessage || task.status === "done") return { kind: "conflict" };
    const nextStatus: TaskStatus = task.status === "todo" ? "in_progress" : task.status;
    const updated: TaskRow = { ...task, assignee, status: nextStatus };
    this.tasks.set(key, updated);
    return { kind: "ok", task: updated };
  }

  /** 内存实现无 createdAt 时间戳,故不做时间过滤;返回当前全部无主 todo 任务。 */
  staleOrphans(): Array<{ workspaceId: string; task: TaskRow }> {
    return [...this.tasks.values()]
      .filter((t) => !t.assignee && t.status === "todo")
      .map((t) => ({ workspaceId: t.workspaceId, task: t }));
  }

  // ---- seen cursor ----
  getSeen(workspaceId: string, agentId: string, channelId: string): number {
    return this.seen.get(`${workspaceId}:${agentId}:${channelId}`) ?? 0;
  }
  advanceSeen(
    workspaceId: string,
    agentId: string,
    channelId: string,
    seq: number,
  ): number {
    const key = `${workspaceId}:${agentId}:${channelId}`;
    const next = advanceSeenCursor(this.seen.get(key) ?? 0, seq);
    this.seen.set(key, next);
    return next;
  }

  // ---- read state ----
  getRead(workspaceId: string, member: Actor, channelId: string): number {
    return (
      this.read.get(`${workspaceId}:${formatActor(member)}:${channelId}`) ?? 0
    );
  }
  advanceRead(
    workspaceId: string,
    member: Actor,
    channelId: string,
    seq: number,
  ): number {
    const key = `${workspaceId}:${formatActor(member)}:${channelId}`;
    const next = advanceReadCursor(this.read.get(key) ?? 0, seq);
    this.read.set(key, next);
    return next;
  }

  // ---- search / resolve ----
  searchMessages(
    workspaceId: string,
    opts: { query: string; channelId?: string | undefined; limit?: number | undefined },
  ): MessageRow[] {
    // 中文全文检索:CJK 二元分词 token 包含(乱序多关键词);无 token 时回退子串
    const qTokens = cjkTokens(opts.query);
    const q = opts.query.toLowerCase();
    const rows = this.messages
      .filter((m) => m.workspaceId === workspaceId)
      .filter((m) => !opts.channelId || m.channelId === opts.channelId)
      .filter((m) =>
        qTokens.length > 0
          ? tokensMatch(new Set(cjkTokens(m.content)), opts.query)
          : m.content.toLowerCase().includes(q),
      )
      .sort((a, b) => b.seq - a.seq);
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  resolveMessage(workspaceId: string, idOrPrefix: string): MessageRow | null {
    const inWs = this.messages.filter((m) => m.workspaceId === workspaceId);
    return (
      inWs.find((m) => m.id === idOrPrefix) ??
      inWs.find((m) => m.id.startsWith(idOrPrefix)) ??
      null
    );
  }

  // ---- directory (server info) ----
  seedChannel(c: MemChannel): void {
    this.channels.push(c);
  }
  seedAgent(a: MemMember): void {
    this.agents.push({
      id: `agent-${++this.counter}`,
      runtime: "claude",
      model: null,
      machineId: null,
      createdAt: FIXED_TS,
      ...a,
    });
  }

  // ---- agent 管理 ----
  listAgents(workspaceId: string): AgentRow[] {
    return this.agents
      .filter((a) => a.workspaceId === workspaceId)
      .sort((x, y) => x.handle.localeCompare(y.handle))
      .map(toAgentRow);
  }
  getAgent(workspaceId: string, handle: string): AgentRow | null {
    const a = this.agents.find((x) => x.workspaceId === workspaceId && x.handle === handle);
    return a ? toAgentRow(a) : null;
  }
  createAgent(workspaceId: string, a: NewAgent): AgentCreateOutcome {
    if (this.agents.some((x) => x.workspaceId === workspaceId && x.handle === a.handle)) {
      return { kind: "duplicate" };
    }
    const row: MemAgent = {
      id: `agent-${++this.counter}`,
      workspaceId,
      handle: a.handle,
      displayName: a.displayName,
      description: a.description ?? "",
      avatarUrl: a.avatarUrl ?? null,
      status: "idle",
      runtime: a.runtime ?? "claude",
      model: a.model ?? null,
      machineId: a.machineId ?? null,
      provider: a.provider ?? "default",
      providerBaseUrl: a.providerBaseUrl ?? null,
      providerApiKey: a.providerApiKey ?? null,
      reasoning: a.reasoning ?? "default",
      fastMode: a.fastMode ?? false,
      createdAt: FIXED_TS,
    };
    this.agents.push(row);
    return { kind: "ok", agent: toAgentRow(row) };
  }
  updateAgent(workspaceId: string, handle: string, patch: AgentPatch): AgentRow | null {
    const a = this.agents.find((x) => x.workspaceId === workspaceId && x.handle === handle);
    if (!a) return null;
    if (patch.displayName !== undefined) a.displayName = patch.displayName;
    if (patch.description !== undefined) a.description = patch.description;
    if (patch.avatarUrl !== undefined) a.avatarUrl = patch.avatarUrl;
    if (patch.runtime !== undefined) a.runtime = patch.runtime;
    if (patch.model !== undefined) a.model = patch.model;
    if (patch.machineId !== undefined) a.machineId = patch.machineId;
    if (patch.provider !== undefined) a.provider = patch.provider;
    if (patch.providerBaseUrl !== undefined) a.providerBaseUrl = patch.providerBaseUrl;
    if (patch.providerApiKey !== undefined) a.providerApiKey = patch.providerApiKey;
    if (patch.reasoning !== undefined) a.reasoning = patch.reasoning;
    if (patch.fastMode !== undefined) a.fastMode = patch.fastMode;
    return toAgentRow(a);
  }
  removeAgent(workspaceId: string, handle: string): boolean {
    const i = this.agents.findIndex((x) => x.workspaceId === workspaceId && x.handle === handle);
    if (i < 0) return false;
    this.agents.splice(i, 1);
    return true;
  }

  // ---- 机器 ----
  private machineRow(m: MemMachine): MachineRow {
    const { workspaceId: _ws, ...rest } = m;
    return { ...rest, runtimes: [...m.runtimes] };
  }
  listMachines(workspaceId: string): MachineRow[] {
    return this.machines.filter((m) => m.workspaceId === workspaceId).map((m) => this.machineRow(m));
  }
  getMachine(workspaceId: string, id: string): MachineRow | null {
    const m = this.machines.find((x) => x.workspaceId === workspaceId && x.id === id);
    return m ? this.machineRow(m) : null;
  }
  createMachine(workspaceId: string, m: NewMachine): MachineRow {
    // uuid 形状的 id (路由按 uuid 校验 machineId,内存实现也需合法)
    const n = (++this.counter).toString().padStart(12, "0");
    const row = {
      workspaceId, id: `00000000-0000-4000-8000-${n}`, name: m.name,
      hostname: null, os: null, daemonVersion: null, runtimes: [] as string[],
      status: "offline", tokenPrefix: m.tokenPrefix ?? null, lastSeenAt: null, createdAt: FIXED_TS,
    };
    this.machines.push(row);
    return this.machineRow(row);
  }
  renameMachine(workspaceId: string, id: string, name: string): MachineRow | null {
    const m = this.machines.find((x) => x.workspaceId === workspaceId && x.id === id);
    if (!m) return null;
    m.name = name;
    return this.machineRow(m);
  }
  deleteMachine(workspaceId: string, id: string): boolean {
    const i = this.machines.findIndex((x) => x.workspaceId === workspaceId && x.id === id);
    if (i < 0) return false;
    // 解绑该机器上的所有 agent(对齐 PG 的 FK onDelete:set null:删机器只解绑、不删 agent)
    for (const a of this.agents) {
      if (a.workspaceId === workspaceId && a.machineId === id) a.machineId = null;
    }
    this.machines.splice(i, 1);
    return true;
  }
  setMachineTokenPrefix(workspaceId: string, id: string, prefix: string): void {
    const m = this.machines.find((x) => x.workspaceId === workspaceId && x.id === id);
    if (m) m.tokenPrefix = prefix;
  }

  // ---- agent 活动历史 ----
  appendActivity(workspaceId: string, a: NewAgentActivity): void {
    this.activities.push({
      workspaceId, id: `act-${++this.counter}`,
      agentHandle: a.agentHandle, channelId: a.channelId,
      activity: a.activity, detail: a.detail, seq: a.seq, createdAt: FIXED_TS,
    });
  }
  listActivities(workspaceId: string, handle: string, limit = 100): AgentActivityRow[] {
    return this.activities
      .filter((x) => x.workspaceId === workspaceId && x.agentHandle === handle)
      .slice(-limit)
      .reverse()
      .map(({ workspaceId: _ws, ...rest }) => rest);
  }
  setMachineStatus(workspaceId: string, id: string, status: "online" | "offline"): void {
    const m = this.machines.find((x) => x.workspaceId === workspaceId && x.id === id);
    if (!m) return;
    m.status = status;
    if (status === "online") m.lastSeenAt = FIXED_TS;
  }
  resetAllMachinesOffline(): void {
    for (const m of this.machines) m.status = "offline";
  }
  updateMachineInfo(workspaceId: string, id: string, patch: MachineInfoPatch): void {
    const m = this.machines.find((x) => x.workspaceId === workspaceId && x.id === id);
    if (!m) return;
    if (patch.hostname !== undefined) m.hostname = patch.hostname;
    if (patch.os !== undefined) m.os = patch.os;
    if (patch.daemonVersion !== undefined) m.daemonVersion = patch.daemonVersion;
    if (patch.runtimes !== undefined) m.runtimes = [...patch.runtimes];
    m.lastSeenAt = FIXED_TS;
  }

  seedUser(u: MemMember): void {
    this.users.push(u);
  }
  seedMember(workspaceId: string, channelId: string, member: Actor): void {
    this.memberships.add(`${workspaceId}:${channelId}:${member.type}:${member.id}`);
  }

  // ---- DM 频道 ----
  getOrCreateDm(workspaceId: string, human: Actor, agentHandle: string, agentDisplayName: string): ChannelInfo {
    const slug = `dm:${human.id}:${agentHandle}`;
    let ch = this.channels.find((c) => c.workspaceId === workspaceId && c.slug === slug);
    if (!ch) {
      ch = {
        id: this.id("dm"), workspaceId, slug, name: agentDisplayName, description: null,
        kind: "dm", isPrivate: true, archived: false,
      };
      this.channels.push(ch);
      this.memberships.add(`${workspaceId}:${ch.id}:${human.type}:${human.id}`);
      this.memberships.add(`${workspaceId}:${ch.id}:agent:${agentHandle}`);
    }
    return {
      id: ch.id, slug: ch.slug, name: ch.name, description: ch.description,
      kind: ch.kind, isPrivate: ch.isPrivate, archived: ch.archived, joined: true, unread: 0,
    };
  }
  dmPeerHandle(workspaceId: string, channelId: string): string | null {
    const ch = this.channels.find((c) => c.workspaceId === workspaceId && c.id === channelId);
    if (!ch || ch.kind !== "dm") return null;
    const prefix = `${workspaceId}:${channelId}:agent:`;
    for (const key of this.memberships) {
      if (key.startsWith(prefix)) return key.slice(prefix.length);
    }
    return null;
  }
  createChannel(workspaceId: string, input: NewChannel, creator: Actor): ChannelInfo {
    const base = input.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    let slug = base || `ch-${++this.counter}`;
    while (this.channels.some((c) => c.workspaceId === workspaceId && c.slug === slug)) slug = `${base}-${++this.counter}`;
    const ch: MemChannel = {
      id: this.id("ch"), workspaceId, slug, name: input.name.trim(),
      description: input.description ?? null, kind: "channel", isPrivate: input.isPrivate ?? false, archived: false,
    };
    this.channels.push(ch);
    const key = `${workspaceId}:${ch.id}:${creator.type}:${creator.id}`;
    this.memberships.add(key); this.memberRoles.set(key, "owner");
    // 初始成员(去掉与 creator 重复的)
    for (const m of input.members ?? []) {
      if (m.type === creator.type && m.id === creator.id) continue;
      const mk = `${workspaceId}:${ch.id}:${m.type}:${m.id}`;
      if (!this.memberships.has(mk)) { this.memberships.add(mk); this.memberRoles.set(mk, "member"); }
    }
    return { id: ch.id, slug: ch.slug, name: ch.name, description: ch.description, kind: ch.kind, isPrivate: ch.isPrivate, archived: false, joined: true, unread: 0 };
  }
  listChannelMembers(workspaceId: string, channelId: string): ChannelMemberInfo[] {
    const prefix = `${workspaceId}:${channelId}:`;
    const out: ChannelMemberInfo[] = [];
    for (const key of this.memberships) {
      if (!key.startsWith(prefix)) continue;
      const [type, id] = key.slice(prefix.length).split(":");
      out.push({ memberType: type as ChannelMemberInfo["memberType"], memberId: id!, role: this.memberRoles.get(key) ?? "member" });
    }
    return out;
  }
  joinChannel(workspaceId: string, actor: Actor, channelId: string): ChannelMutation {
    const ch = this.channels.find((c) => c.workspaceId === workspaceId && c.id === channelId);
    if (!ch) return { kind: "not_found" };
    if (ch.isPrivate) return { kind: "forbidden" };
    const key = `${workspaceId}:${channelId}:${actor.type}:${actor.id}`;
    if (!this.memberships.has(key)) { this.memberships.add(key); this.memberRoles.set(key, "member"); }
    return { kind: "ok", channel: { id: ch.id, slug: ch.slug, name: ch.name, description: ch.description, kind: ch.kind, isPrivate: ch.isPrivate, archived: ch.archived, joined: true, unread: 0 } };
  }
  /** 把任意 agent/human 加入频道(幂等)。频道不存在→not_found;成员不存在→invalid。 */
  addChannelMember(
    workspaceId: string,
    channelId: string,
    member: { type: "agent" | "human"; id: string },
    role = "member",
  ): ChannelMemberMutation {
    const ch = this.channels.find((c) => c.workspaceId === workspaceId && c.id === channelId);
    if (!ch) return { kind: "not_found" };
    const exists = member.type === "agent"
      ? this.agents.some((a) => a.workspaceId === workspaceId && a.handle === member.id)
      : this.users.some((u) => u.workspaceId === workspaceId && u.handle === member.id);
    if (!exists) return { kind: "invalid" };
    const key = `${workspaceId}:${channelId}:${member.type}:${member.id}`;
    if (!this.memberships.has(key)) { this.memberships.add(key); this.memberRoles.set(key, role); }
    return { kind: "ok" };
  }
  /** 从频道移除任意成员(幂等)。频道不存在→not_found。 */
  removeChannelMember(
    workspaceId: string,
    channelId: string,
    member: { type: "agent" | "human"; id: string },
  ): ChannelMemberMutation {
    const ch = this.channels.find((c) => c.workspaceId === workspaceId && c.id === channelId);
    if (!ch) return { kind: "not_found" };
    const key = `${workspaceId}:${channelId}:${member.type}:${member.id}`;
    this.memberships.delete(key); this.memberRoles.delete(key);
    return { kind: "ok" };
  }
  activityFeed(workspaceId: string, viewer: Actor, limit = 50): ActivityFeedItem[] {
    const isMe = (t: string, i: string) => t === viewer.type && i === viewer.id;
    const msgs = this.messages.filter((m) => m.workspaceId === workspaceId);
    const myIds = new Set(msgs.filter((m) => isMe(m.sender.type, m.sender.id)).map((m) => m.id));
    // 精确 @我:经 mention 表(而非 content 子串)
    const mentionedIds = new Set(
      this.mentions.filter((x) => x.workspaceId === workspaceId && x.handle === viewer.id).map((x) => x.messageId),
    );
    const items: ActivityFeedItem[] = [];
    for (const m of msgs) {
      if (isMe(m.sender.type, m.sender.id)) continue;
      if (mentionedIds.has(m.id)) items.push({ id: m.id, kind: "mention", at: m.createdAt, channelId: m.channelId, actorType: m.sender.type, actorId: m.sender.id, text: m.content });
      else if (m.threadParentId && myIds.has(m.threadParentId)) items.push({ id: m.id, kind: "reply", at: m.createdAt, channelId: m.channelId, actorType: m.sender.type, actorId: m.sender.id, text: m.content });
    }
    for (const t of this.tasks.values()) {
      if (t.workspaceId === workspaceId && t.assignee && isMe(t.assignee.type, t.assignee.id)) {
        items.push({ id: t.id, kind: "task", at: FIXED_TS, channelId: t.channelId, actorType: t.assignee.type, actorId: t.assignee.id, text: t.title, meta: t.status });
      }
    }
    const seen = new Set<string>();
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).filter((x) => { const k = `${x.kind}:${x.id}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
  }
  leaveChannel(workspaceId: string, actor: Actor, channelId: string): ChannelMutation {
    const ch = this.channels.find((c) => c.workspaceId === workspaceId && c.id === channelId);
    if (!ch) return { kind: "not_found" };
    const key = `${workspaceId}:${channelId}:${actor.type}:${actor.id}`;
    this.memberships.delete(key); this.memberRoles.delete(key);
    return { kind: "ok", channel: { id: ch.id, slug: ch.slug, name: ch.name, description: ch.description, kind: ch.kind, isPrivate: ch.isPrivate, archived: ch.archived, joined: false, unread: 0 } };
  }

  setChannelArchived(workspaceId: string, channelId: string, archived: boolean): boolean {
    const ch = this.channels.find((c) => c.workspaceId === workspaceId && c.id === channelId);
    if (!ch) return false;
    ch.archived = archived;
    return true;
  }
  channelArchived(workspaceId: string, channelId: string): boolean {
    return this.channels.find((c) => c.workspaceId === workspaceId && c.id === channelId)?.archived ?? false;
  }

  serverInfo(workspaceId: string, viewer?: Actor) {
    // 按频道统计真实成员数 (memberships key: `${ws}:${channelId}:${type}:${id}`)
    const memberCounts = new Map<string, number>();
    for (const key of this.memberships) {
      const rest = key.startsWith(`${workspaceId}:`) ? key.slice(workspaceId.length + 1) : null;
      if (rest === null) continue;
      const channelId = rest.slice(0, rest.indexOf(":"));
      memberCounts.set(channelId, (memberCounts.get(channelId) ?? 0) + 1);
    }
    const channels = this.channels
      .filter((c) => c.workspaceId === workspaceId)
      .map((c) => ({
        id: c.id, slug: c.slug, name: c.name, description: c.description,
        kind: c.kind, isPrivate: c.isPrivate, archived: c.archived,
        joined: viewer
          ? this.memberships.has(`${workspaceId}:${c.id}:${viewer.type}:${viewer.id}`)
          : false,
        unread: viewer
          ? Math.max(0, this.latestSeq(workspaceId, c.id) - this.getRead(workspaceId, viewer, c.id))
          : 0,
        memberCount: memberCounts.get(c.id) ?? 0,
      }));
    const machineOnline = new Map(
      this.machines.filter((m) => m.workspaceId === workspaceId).map((m) => [m.id, m.status === "online"] as const),
    );
    const agents = this.agents
      .filter((a) => a.workspaceId === workspaceId)
      .map((a) => ({
        handle: a.handle, displayName: a.displayName, kind: "agent" as const,
        description: a.description, status: a.status, avatarUrl: a.avatarUrl ?? null,
        online: a.machineId !== null && (machineOnline.get(a.machineId) ?? false),
      }));
    const humans = this.users
      .filter((u) => u.workspaceId === workspaceId)
      .map((u) => ({ handle: u.handle, displayName: u.displayName, kind: "human" as const }));
    return { channels, agents, humans };
  }
}

export interface MemoryRepos {
  readonly store: MemoryStore;
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

/** 把一个 MemoryStore 适配成全套 repo 接口 (共享同一份状态)。 */
export function createMemoryRepos(store: MemoryStore = new MemoryStore()): MemoryRepos {
  return {
    store,
    messages: {
      append: async (ws, msg) => store.appendMessage(ws, msg),
      latestSeq: async (ws, ch) => store.latestSeq(ws, ch),
      get: async (ws, id) => store.getMessage(ws, id),
      list: async (ws, ch, opts) => store.listMessages(ws, ch, opts),
      search: async (ws, opts) => store.searchMessages(ws, opts),
      resolve: async (ws, idOrPrefix) => store.resolveMessage(ws, idOrPrefix),
    },
    reactions: {
      add: async (ws, mid, actor, emoji) => store.addReaction(ws, mid, actor, emoji),
      remove: async (ws, mid, actor, emoji) => store.removeReaction(ws, mid, actor, emoji),
      listForMessages: async (ws, ids) => store.listReactionsFor(ws, ids),
    },
    attachments: {
      create: async (ws, a) => store.createAttachment(ws, a),
      get: async (ws, id) => store.getAttachment(ws, id),
      listForMessages: async (ws, ids) => store.listAttachmentsFor(ws, ids),
      listForChannel: async (ws, channelId) => store.listAttachmentsForChannel(ws, channelId),
    },
    saved: {
      add: async (ws, actor, mid) => store.addSaved(ws, actor, mid),
      remove: async (ws, actor, mid) => store.removeSaved(ws, actor, mid),
      listForActor: async (ws, actor) => store.listSaved(ws, actor),
      savedSet: async (ws, actor, ids) => store.savedSet(ws, actor, ids),
    },
    threadAttention: {
      unfollow: async (ws, h, tid) => store.unfollowThread(ws, h, tid),
      follow: async (ws, h, tid) => store.followThread(ws, h, tid),
      unfollowedHandles: async (ws, tid) => store.unfollowedThreadHandles(ws, tid),
    },
    actionCards: {
      create: async (ws, a) => store.createActionCard(ws, a),
      get: async (ws, id) => store.getActionCard(ws, id),
      listPending: async (ws) => store.listPendingActions(ws),
      resolve: async (ws, id, status, by, ref) => store.resolveActionCard(ws, id, status, by, ref),
    },
    integrations: {
      recordLogin: async (ws, h, name) => store.recordLogin(ws, h, name),
      removeLogin: async (ws, h, name) => store.removeLogin(ws, h, name),
      list: async (ws, h) => store.listLogins(ws, h),
    },
    drafts: {
      create: async (ws, d) => store.createDraft(ws, d),
    },
    tasks: {
      get: async (ws, id) => store.getTask(ws, id),
      claim: async (ws, id, who) => store.claimTask(ws, id, who),
      list: async (ws, filter) => store.listTasks(ws, filter),
      create: async (ws, t) => store.createTask(ws, t),
      unclaim: async (ws, id, actor, next) => store.unclaimTask(ws, id, actor, next),
      updateStatus: async (ws, id, expectedAssignee, next) =>
        store.updateTaskStatus(ws, id, expectedAssignee, next),
      assign: async (ws, id, assignee) => store.assignTask(ws, id, assignee),
      staleOrphansAcrossWorkspaces: async (_olderThan, limit) =>
        store.staleOrphans().slice(0, limit),
    },
    seen: {
      get: async (ws, agentId, ch) => store.getSeen(ws, agentId, ch),
      advance: async (ws, agentId, ch, seq) =>
        store.advanceSeen(ws, agentId, ch, seq),
    },
    readState: {
      get: async (ws, member, ch) => store.getRead(ws, member, ch),
      advance: async (ws, member, ch, seq) =>
        store.advanceRead(ws, member, ch, seq),
    },
    directory: {
      serverInfo: async (ws, viewer) => store.serverInfo(ws, viewer),
      workspace: async (ws) => store.workspaceInfo(ws),
    },
    channels: {
      getOrCreateDm: async (ws, human, handle, name) => store.getOrCreateDm(ws, human, handle, name),
      dmPeerHandle: async (ws, channelId) => store.dmPeerHandle(ws, channelId),
      create: async (ws, input, creator) => store.createChannel(ws, input, creator),
      listMembers: async (ws, channelId) => store.listChannelMembers(ws, channelId),
      join: async (ws, actor, channelId) => store.joinChannel(ws, actor, channelId),
      leave: async (ws, actor, channelId) => store.leaveChannel(ws, actor, channelId),
      addMember: async (ws, channelId, member, role) => store.addChannelMember(ws, channelId, member, role),
      removeMember: async (ws, channelId, member) => store.removeChannelMember(ws, channelId, member),
      setArchived: async (ws, channelId, archived) => store.setChannelArchived(ws, channelId, archived),
      isArchived: async (ws, channelId) => store.channelArchived(ws, channelId),
    },
    feed: {
      activity: async (ws, viewer, limit) => store.activityFeed(ws, viewer, limit),
    },
    reminders: createMemoryReminderRepo(),
    agents: {
      list: async (ws) => store.listAgents(ws),
      get: async (ws, handle) => store.getAgent(ws, handle),
      create: async (ws, a) => store.createAgent(ws, a),
      update: async (ws, handle, patch) => store.updateAgent(ws, handle, patch),
      remove: async (ws, handle) => store.removeAgent(ws, handle),
    },
    activities: {
      append: async (ws, a) => store.appendActivity(ws, a),
      list: async (ws, handle, limit) => store.listActivities(ws, handle, limit),
    },
    machines: {
      list: async (ws) => store.listMachines(ws),
      get: async (ws, id) => store.getMachine(ws, id),
      create: async (ws, m) => store.createMachine(ws, m),
      rename: async (ws, id, name) => store.renameMachine(ws, id, name),
      delete: async (ws, id) => store.deleteMachine(ws, id),
      setTokenPrefix: async (ws, id, prefix) => store.setMachineTokenPrefix(ws, id, prefix),
      setStatus: async (ws, id, status) => store.setMachineStatus(ws, id, status),
      resetAllOffline: async () => store.resetAllMachinesOffline(),
      updateInfo: async (ws, id, patch) => store.updateMachineInfo(ws, id, patch),
    },
  };
}
