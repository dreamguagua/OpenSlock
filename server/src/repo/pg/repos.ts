/**
 * PostgreSQL 仓储实现 (生产)。
 *
 * 与内存版的本质区别:把"seq 单调分配""claim 原子抢占"交给数据库:
 *  - seq:每频道用 `pg_advisory_xact_lock` 串行化分配,叠加 `(channel_id, seq)` 唯一约束兜底。
 *  - claim:条件 `UPDATE ... WHERE assignee_id IS NULL`,并发下只有一方成功。
 * 每个方法在 `withTenant` 事务内执行,RLS 强制按 workspace 隔离 (DB 级兜底)。
 */

import { and, eq, gt, lt, isNull, ne, sql, asc, desc, ilike, inArray, arrayContains } from "drizzle-orm";
import { withTenant, getDb } from "../../db/client.js";
import * as s from "../../db/schema.js";
import type { Actor } from "../../domain/actor.js";
import { actorEquals } from "../../domain/actor.js";
import { uniqueTokens } from "../../domain/search-tokenize.js";
import { parseMentions } from "../../domain/mention.js";
import type { ClaimResult, TaskStatus } from "../../domain/claim.js";
import type {
  AgentActivityRow,
  AgentActivityRepo,
  AgentCreateOutcome,
  AttachmentRepo,
  AttachmentRow,
  NewAttachment,
  SavedRepo,
  ThreadAttentionRepo,
  ActionCardRepo,
  ActionCardRow,
  NewActionCard,
  IntegrationRepo,
  AgentLoginRow,
  AgentRepo,
  AgentRow,
  ChannelRepo,
  ChannelMutation,
  ChannelMemberMutation,
  ActivityFeedItem,
  FeedRepo,
  DirectoryRepo,
  DraftRepo,
  MachineRepo,
  MachineRow,
  MessageRepo,
  MessageRow,
  NewMessage,
  NewTask,
  ReactionRepo,
  ReactionRow,
  ReadStateRepo,
  SeenCursorRepo,
  TaskListFilter,
  TaskMutationOutcome,
  TaskRepo,
  TaskRow,
} from "../types.js";

type MsgInsert = typeof s.message.$inferSelect;
type TaskInsert = typeof s.task.$inferSelect;

const toMessageRow = (m: MsgInsert): MessageRow => ({
  id: m.id,
  workspaceId: m.workspaceId,
  channelId: m.channelId,
  seq: m.seq,
  type: m.type,
  sender: { type: m.senderType, id: m.senderId },
  content: m.content,
  threadParentId: m.threadParentId,
  createdAt: m.createdAt.toISOString(),
});

const toTaskRow = (t: TaskInsert): TaskRow => ({
  id: t.id,
  workspaceId: t.workspaceId,
  channelId: t.channelId,
  number: t.number,
  title: t.title,
  messageId: t.messageId,
  parentTaskId: t.parentTaskId,
  assignee:
    t.assigneeType && t.assigneeId
      ? { type: t.assigneeType, id: t.assigneeId }
      : null,
  createdBy:
    t.createdByType && t.createdById
      ? { type: t.createdByType, id: t.createdById }
      : null,
  status: t.status,
  anchoredOnSystemMessage: t.anchoredOnSystemMessage,
});

export const messages: MessageRepo = {
  async append(ws, msg: NewMessage) {
    return withTenant(ws, async (tx) => {
      // 串行化本频道的 seq 分配 (事务级 advisory lock)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${msg.channelId}))`);
      const [agg] = await tx
        .select({ max: sql<string>`coalesce(max(${s.message.seq}), 0)` })
        .from(s.message)
        .where(eq(s.message.channelId, msg.channelId));
      // PG 的 bigint 聚合以字符串返回,必须 Number() 转换,否则 "1"+1="11"
      const seq = Number(agg?.max ?? 0) + 1;
      const [row] = await tx
        .insert(s.message)
        .values({
          workspaceId: ws,
          channelId: msg.channelId,
          seq,
          type: msg.type,
          senderType: msg.sender.type,
          senderId: msg.sender.id,
          content: msg.content,
          searchTokens: uniqueTokens(msg.content),
          threadParentId: msg.threadParentId ?? null,
        })
        .returning();
      // 记录 @提及(精确,供 activity / 未来唤醒);与消息同事务原子写入
      const handles = parseMentions(msg.content);
      if (handles.length > 0) {
        await tx.insert(s.mention).values(handles.map((handle) => ({
          workspaceId: ws, messageId: row!.id, channelId: msg.channelId, handle,
        })));
      }
      return toMessageRow(row!);
    });
  },

  async latestSeq(ws, channelId) {
    return withTenant(ws, async (tx) => {
      const [agg] = await tx
        .select({ max: sql<string>`coalesce(max(${s.message.seq}), 0)` })
        .from(s.message)
        .where(eq(s.message.channelId, channelId));
      return Number(agg?.max ?? 0);
    });
  },

  async get(ws, messageId) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx
        .select()
        .from(s.message)
        .where(eq(s.message.id, messageId));
      return row ? toMessageRow(row) : null;
    });
  },

  async list(ws, channelId, opts = {}) {
    return withTenant(ws, async (tx) => {
      const where =
        opts.afterSeq != null
          ? and(
              eq(s.message.channelId, channelId),
              gt(s.message.seq, opts.afterSeq),
            )
          : eq(s.message.channelId, channelId);
      const base = tx
        .select()
        .from(s.message)
        .where(where)
        .orderBy(asc(s.message.seq));
      const rows = opts.limit != null ? await base.limit(opts.limit) : await base;
      return rows.map(toMessageRow);
    });
  },

  async search(ws, opts) {
    return withTenant(ws, async (tx) => {
      // 中文全文检索:CJK 二元分词 token 数组包含(@>),空格关键词可乱序命中。
      // 查询分不出 token(纯标点/emoji 等)时回退 pg_trgm 子串。
      const tokens = uniqueTokens(opts.query);
      const cond = tokens.length > 0
        ? arrayContains(s.message.searchTokens, tokens)
        : ilike(s.message.content, `%${opts.query}%`);
      const conds = [cond];
      if (opts.channelId) conds.push(eq(s.message.channelId, opts.channelId));
      const rows = await tx
        .select()
        .from(s.message)
        .where(and(...conds))
        .orderBy(desc(s.message.seq))
        .limit(opts.limit ?? 50);
      return rows.map(toMessageRow);
    });
  },

  async resolve(ws, idOrPrefix) {
    return withTenant(ws, async (tx) => {
      // 8 位短码按前缀匹配;完整 uuid 精确匹配
      const rows = await tx
        .select()
        .from(s.message)
        .where(sql`${s.message.id}::text like ${idOrPrefix + "%"}`)
        .limit(1);
      return rows[0] ? toMessageRow(rows[0]) : null;
    });
  },
};

export const directory: DirectoryRepo = {
  async workspace(ws) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx.select().from(s.workspace).where(eq(s.workspace.id, ws));
      return row ? { id: row.id, name: row.name, slug: row.slug } : null;
    });
  },
  async serverInfo(ws, viewer) {
    return withTenant(ws, async (tx) => {
      const [channels, members, agents, users, maxSeqs, machineRows] = await Promise.all([
        tx.select().from(s.channel).orderBy(asc(s.channel.slug)),
        tx.select().from(s.channelMember),
        tx.select().from(s.agent).orderBy(asc(s.agent.handle)),
        tx.select().from(s.appUser).orderBy(asc(s.appUser.handle)),
        tx
          .select({ channelId: s.message.channelId, max: sql<string>`max(${s.message.seq})` })
          .from(s.message)
          .groupBy(s.message.channelId),
        tx.select({ id: s.machine.id, status: s.machine.status }).from(s.machine),
      ]);
      const machineOnline = new Map(machineRows.map((m) => [m.id, m.status === "online"] as const));
      // 调用方 (viewer) 的 joined 与 last_read 映射
      const joined = new Set(
        viewer
          ? members
              .filter((m) => m.memberType === viewer.type && m.memberId === viewer.id)
              .map((m) => m.channelId)
          : [],
      );
      const lastRead = new Map(
        viewer
          ? members
              .filter((m) => m.memberType === viewer.type && m.memberId === viewer.id)
              .map((m) => [m.channelId, m.lastReadSeq] as const)
          : [],
      );
      const maxByChannel = new Map(maxSeqs.map((r) => [r.channelId, Number(r.max ?? 0)] as const));
      // 按频道统计真实成员数
      const memberCounts = new Map<string, number>();
      for (const m of members) memberCounts.set(m.channelId, (memberCounts.get(m.channelId) ?? 0) + 1);
      return {
        channels: channels.map((c) => ({
          id: c.id, slug: c.slug, name: c.name, description: c.description,
          kind: c.kind, isPrivate: c.isPrivate, archived: c.archivedAt !== null,
          joined: joined.has(c.id),
          unread: viewer ? Math.max(0, (maxByChannel.get(c.id) ?? 0) - (lastRead.get(c.id) ?? 0)) : 0,
          memberCount: memberCounts.get(c.id) ?? 0,
        })),
        agents: agents.map((a) => ({
          handle: a.handle, displayName: a.displayName, kind: "agent" as const,
          description: a.description, status: a.status, avatarUrl: a.avatarUrl,
          online: a.machineId !== null && (machineOnline.get(a.machineId) ?? false),
        })),
        humans: users.map((u) => ({
          handle: u.handle, displayName: u.displayName, kind: "human" as const,
        })),
      };
    });
  },
};

export const channels: ChannelRepo = {
  async getOrCreateDm(ws, human, agentHandle, agentDisplayName) {
    return withTenant(ws, async (tx) => {
      const slug = `dm:${human.id}:${agentHandle}`;
      let [ch] = await tx.select().from(s.channel).where(eq(s.channel.slug, slug));
      if (!ch) {
        [ch] = await tx.insert(s.channel).values({
          workspaceId: ws, slug, name: agentDisplayName, kind: "dm", isPrivate: true,
        }).returning();
        // 双方入成员
        await tx.insert(s.channelMember).values([
          { workspaceId: ws, channelId: ch!.id, memberType: human.type, memberId: human.id },
          { workspaceId: ws, channelId: ch!.id, memberType: "agent", memberId: agentHandle },
        ]).onConflictDoNothing();
      }
      const c = ch!;
      return {
        id: c.id, slug: c.slug, name: c.name, description: c.description,
        kind: c.kind, isPrivate: c.isPrivate, archived: c.archivedAt !== null,
        joined: true, unread: 0,
      };
    });
  },
  async dmPeerHandle(ws, channelId) {
    return withTenant(ws, async (tx) => {
      const [ch] = await tx.select().from(s.channel).where(eq(s.channel.id, channelId));
      if (!ch || ch.kind !== "dm") return null;
      const [agentMember] = await tx.select().from(s.channelMember).where(
        and(eq(s.channelMember.channelId, channelId), eq(s.channelMember.memberType, "agent")),
      );
      return agentMember?.memberId ?? null;
    });
  },
  async create(ws, input, creator) {
    return withTenant(ws, async (tx) => {
      // slug 由 name 派生,唯一(冲突追加 -2/-3…)
      const baseRaw = input.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
      const baseslug = baseRaw || `ch-${Date.now().toString(36)}`;
      let slug = baseslug;
      for (let n = 2; ; n++) {
        const [hit] = await tx.select({ id: s.channel.id }).from(s.channel).where(eq(s.channel.slug, slug));
        if (!hit) break;
        slug = `${baseslug}-${n}`;
      }
      const [c] = await tx.insert(s.channel).values({
        workspaceId: ws, slug, name: input.name.trim(),
        description: input.description ?? null, kind: "channel",
        isPrivate: input.isPrivate ?? false,
      }).returning();
      await tx.insert(s.channelMember).values({
        workspaceId: ws, channelId: c!.id, memberType: creator.type, memberId: creator.id, role: "owner",
      }).onConflictDoNothing();
      // 初始成员(去掉与 creator 重复的)
      const initial = (input.members ?? []).filter((m) => !(m.type === creator.type && m.id === creator.id));
      if (initial.length > 0) {
        await tx.insert(s.channelMember).values(initial.map((m) => ({
          workspaceId: ws, channelId: c!.id, memberType: m.type, memberId: m.id, role: "member",
        }))).onConflictDoNothing();
      }
      return {
        id: c!.id, slug: c!.slug, name: c!.name, description: c!.description,
        kind: c!.kind, isPrivate: c!.isPrivate, archived: c!.archivedAt !== null, joined: true, unread: 0,
      };
    });
  },
  async listMembers(ws, channelId) {
    return withTenant(ws, async (tx) => {
      const rows = await tx.select().from(s.channelMember).where(eq(s.channelMember.channelId, channelId));
      return rows.map((r) => ({ memberType: r.memberType, memberId: r.memberId, role: r.role }));
    });
  },
  async join(ws, actor, channelId): Promise<ChannelMutation> {
    return withTenant(ws, async (tx) => {
      const [ch] = await tx.select().from(s.channel).where(eq(s.channel.id, channelId));
      if (!ch) return { kind: "not_found" };
      if (ch.isPrivate) return { kind: "forbidden" };
      await tx.insert(s.channelMember).values({
        workspaceId: ws, channelId, memberType: actor.type, memberId: actor.id, role: "member",
      }).onConflictDoNothing();
      return {
        kind: "ok",
        channel: {
          id: ch.id, slug: ch.slug, name: ch.name, description: ch.description,
          kind: ch.kind, isPrivate: ch.isPrivate, archived: ch.archivedAt !== null, joined: true, unread: 0,
        },
      };
    });
  },
  async leave(ws, actor, channelId): Promise<ChannelMutation> {
    return withTenant(ws, async (tx) => {
      const [ch] = await tx.select().from(s.channel).where(eq(s.channel.id, channelId));
      if (!ch) return { kind: "not_found" };
      await tx.delete(s.channelMember).where(and(
        eq(s.channelMember.channelId, channelId),
        eq(s.channelMember.memberType, actor.type),
        eq(s.channelMember.memberId, actor.id),
      ));
      return {
        kind: "ok",
        channel: {
          id: ch.id, slug: ch.slug, name: ch.name, description: ch.description,
          kind: ch.kind, isPrivate: ch.isPrivate, archived: ch.archivedAt !== null, joined: false, unread: 0,
        },
      };
    });
  },
  async addMember(ws, channelId, member, role = "member"): Promise<ChannelMemberMutation> {
    return withTenant(ws, async (tx) => {
      const [ch] = await tx.select({ id: s.channel.id }).from(s.channel).where(eq(s.channel.id, channelId));
      if (!ch) return { kind: "not_found" };
      const exists = member.type === "agent"
        ? (await tx.select({ h: s.agent.handle }).from(s.agent).where(eq(s.agent.handle, member.id))).length > 0
        : (await tx.select({ h: s.appUser.handle }).from(s.appUser).where(eq(s.appUser.handle, member.id))).length > 0;
      if (!exists) return { kind: "invalid" };
      await tx.insert(s.channelMember).values({
        workspaceId: ws, channelId, memberType: member.type, memberId: member.id, role,
      }).onConflictDoNothing();
      return { kind: "ok" };
    });
  },
  async removeMember(ws, channelId, member): Promise<ChannelMemberMutation> {
    return withTenant(ws, async (tx) => {
      const [ch] = await tx.select({ id: s.channel.id }).from(s.channel).where(eq(s.channel.id, channelId));
      if (!ch) return { kind: "not_found" };
      await tx.delete(s.channelMember).where(and(
        eq(s.channelMember.channelId, channelId),
        eq(s.channelMember.memberType, member.type),
        eq(s.channelMember.memberId, member.id),
      ));
      return { kind: "ok" };
    });
  },
  async setArchived(ws, channelId, archived): Promise<boolean> {
    return withTenant(ws, async (tx) => {
      const rows = await tx
        .update(s.channel)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(s.channel.id, channelId))
        .returning({ id: s.channel.id });
      return rows.length > 0;
    });
  },
  async isArchived(ws, channelId): Promise<boolean> {
    return withTenant(ws, async (tx) => {
      const [ch] = await tx.select({ a: s.channel.archivedAt }).from(s.channel).where(eq(s.channel.id, channelId));
      return ch?.a != null;
    });
  },
};

export const feed: FeedRepo = {
  async activity(ws, viewer, limit = 50) {
    return withTenant(ws, async (tx) => {
      const isMe = (t: string, i: string) => t === viewer.type && i === viewer.id;
      // 1) @我 的消息(精确:经 mention 表关联,而非 ilike 子串)
      const mentions = await tx.select({ m: s.message }).from(s.mention)
        .innerJoin(s.message, eq(s.mention.messageId, s.message.id))
        .where(eq(s.mention.handle, viewer.id))
        .orderBy(desc(s.message.seq)).limit(limit)
        .then((rows) => rows.map((r) => r.m));
      // 2) 回复我的(我发过的消息被人在线程里回复)
      const mine = await tx.select({ id: s.message.id }).from(s.message)
        .where(and(eq(s.message.senderType, viewer.type), eq(s.message.senderId, viewer.id)))
        .orderBy(desc(s.message.seq)).limit(300);
      const myIds = mine.map((r) => r.id);
      const replies = myIds.length
        ? await tx.select().from(s.message)
            .where(inArray(s.message.threadParentId, myIds))
            .orderBy(desc(s.message.seq)).limit(limit)
        : [];
      // 3) 指派给我的任务(按更新时间)
      const tasks = await tx.select().from(s.task)
        .where(and(eq(s.task.assigneeType, viewer.type), eq(s.task.assigneeId, viewer.id)))
        .orderBy(desc(s.task.updatedAt)).limit(limit);

      const items: ActivityFeedItem[] = [];
      for (const m of mentions) if (!isMe(m.senderType, m.senderId)) items.push({ id: m.id, kind: "mention", at: m.createdAt.toISOString(), channelId: m.channelId, actorType: m.senderType, actorId: m.senderId, text: m.content });
      for (const m of replies) if (!isMe(m.senderType, m.senderId)) items.push({ id: m.id, kind: "reply", at: m.createdAt.toISOString(), channelId: m.channelId, actorType: m.senderType, actorId: m.senderId, text: m.content });
      for (const t of tasks) items.push({ id: t.id, kind: "task", at: t.updatedAt.toISOString(), channelId: t.channelId, actorType: t.assigneeType ?? "system", actorId: t.assigneeId ?? "", text: t.title, meta: t.status });

      const seen = new Set<string>();
      return items
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .filter((x) => { const k = `${x.kind}:${x.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, limit);
    });
  },
};

export const drafts: DraftRepo = {
  async create(ws, d) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx
        .insert(s.draft)
        .values({
          workspaceId: ws,
          channelId: d.channelId,
          authorType: d.author.type,
          authorId: d.author.id,
          content: d.content,
          heldAtSeq: d.heldAtSeq,
        })
        .returning();
      return {
        id: row!.id,
        workspaceId: row!.workspaceId,
        channelId: row!.channelId,
        author: { type: row!.authorType, id: row!.authorId },
        content: row!.content,
        heldAtSeq: row!.heldAtSeq,
        createdAt: row!.createdAt.toISOString(),
      };
    });
  },
};

export const tasks: TaskRepo = {
  async get(ws, taskId) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx.select().from(s.task).where(eq(s.task.id, taskId));
      return row ? toTaskRow(row) : null;
    });
  },

  async claim(ws, taskId, claimant: Actor): Promise<ClaimResult> {
    return withTenant(ws, async (tx) => {
      const [cur] = await tx.select().from(s.task).where(eq(s.task.id, taskId));
      if (!cur) return { kind: "not_claimable" };
      if (cur.anchoredOnSystemMessage) return { kind: "not_claimable" };
      const currentAssignee =
        cur.assigneeType && cur.assigneeId
          ? { type: cur.assigneeType, id: cur.assigneeId }
          : null;
      if (currentAssignee && actorEquals(currentAssignee, claimant)) {
        return { kind: "already_mine" };
      }
      const newStatus: TaskStatus =
        cur.status === "todo" ? "in_progress" : cur.status;
      // 原子抢占:仅当仍未分配时才更新
      const updated = await tx
        .update(s.task)
        .set({
          assigneeType: claimant.type,
          assigneeId: claimant.id,
          status: newStatus,
          claimedAt: sql`now()`,
        })
        .where(and(eq(s.task.id, taskId), isNull(s.task.assigneeId)))
        .returning();
      if (updated.length === 0) {
        const [after] = await tx
          .select()
          .from(s.task)
          .where(eq(s.task.id, taskId));
        const held =
          after?.assigneeType && after?.assigneeId
            ? { type: after.assigneeType, id: after.assigneeId }
            : { type: "system" as const, id: "unknown" };
        return actorEquals(held, claimant)
          ? { kind: "already_mine" }
          : { kind: "conflict", heldBy: held };
      }
      return { kind: "claimed", assignee: claimant, status: newStatus };
    });
  },

  async list(ws, filter = {}) {
    return withTenant(ws, async (tx) => {
      const conds = [];
      if (filter.channelId) conds.push(eq(s.task.channelId, filter.channelId));
      if (filter.status) conds.push(eq(s.task.status, filter.status));
      if (filter.assignee) {
        conds.push(eq(s.task.assigneeType, filter.assignee.type));
        conds.push(eq(s.task.assigneeId, filter.assignee.id));
      }
      const rows = await tx
        .select()
        .from(s.task)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(asc(s.task.number));
      return rows.map(toTaskRow);
    });
  },

  async create(ws, t: NewTask) {
    return withTenant(ws, async (tx) => {
      // 串行化本 workspace 的 task number 分配 (事务级 advisory lock)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"task:" + ws}))`);
      const [agg] = await tx
        .select({ max: sql<string>`coalesce(max(${s.task.number}), 0)` })
        .from(s.task);
      const number = Number(agg?.max ?? 0) + 1;
      const [row] = await tx
        .insert(s.task)
        .values({
          workspaceId: ws,
          channelId: t.channelId,
          number,
          title: t.title,
          messageId: t.messageId,
          ...(t.parentTaskId ? { parentTaskId: t.parentTaskId } : {}),
          status: "todo",
          anchoredOnSystemMessage: t.anchoredOnSystemMessage ?? false,
          createdByType: t.createdBy.type,
          createdById: t.createdBy.id,
        })
        .returning();
      return toTaskRow(row!);
    });
  },

  async unclaim(ws, taskId, actor: Actor, nextStatus: TaskStatus): Promise<TaskMutationOutcome> {
    return withTenant(ws, async (tx) => {
      const [cur] = await tx.select().from(s.task).where(eq(s.task.id, taskId));
      if (!cur) return { kind: "not_found" };
      // 原子:仅当 assignee 仍是 actor 时释放
      const updated = await tx
        .update(s.task)
        .set({ assigneeType: null, assigneeId: null, status: nextStatus, claimedAt: null, updatedAt: sql`now()` })
        .where(and(eq(s.task.id, taskId), eq(s.task.assigneeType, actor.type), eq(s.task.assigneeId, actor.id)))
        .returning();
      return updated.length ? { kind: "ok", task: toTaskRow(updated[0]!) } : { kind: "conflict" };
    });
  },

  async updateStatus(ws, taskId, expectedAssignee: Actor | null, nextStatus: TaskStatus): Promise<TaskMutationOutcome> {
    return withTenant(ws, async (tx) => {
      const [cur] = await tx.select().from(s.task).where(eq(s.task.id, taskId));
      if (!cur) return { kind: "not_found" };
      // 乐观并发:仅当 assignee 仍等于 service 读到的期望值(未被并发改派)时改状态。
      // 无终态限制——done/closed 可被重新打开。权限由 service 层 decideStatusUpdate 判定。
      const assigneeCond = expectedAssignee
        ? and(eq(s.task.assigneeType, expectedAssignee.type), eq(s.task.assigneeId, expectedAssignee.id))
        : and(isNull(s.task.assigneeType), isNull(s.task.assigneeId));
      const updated = await tx
        .update(s.task)
        .set({ status: nextStatus, updatedAt: sql`now()` })
        .where(
          and(
            eq(s.task.id, taskId),
            assigneeCond,
          ),
        )
        .returning();
      return updated.length ? { kind: "ok", task: toTaskRow(updated[0]!) } : { kind: "conflict" };
    });
  },

  async assign(ws, taskId, assignee: Actor): Promise<TaskMutationOutcome> {
    return withTenant(ws, async (tx) => {
      const [cur] = await tx.select().from(s.task).where(eq(s.task.id, taskId));
      if (!cur) return { kind: "not_found" };
      // 系统消息锚定的 task / done 终态:不可指派
      if (cur.anchoredOnSystemMessage || cur.status === "done") return { kind: "conflict" };
      const newStatus: TaskStatus = cur.status === "todo" ? "in_progress" : (cur.status as TaskStatus);
      const [row] = await tx
        .update(s.task)
        .set({ assigneeType: assignee.type, assigneeId: assignee.id, status: newStatus, claimedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(s.task.id, taskId))
        .returning();
      return { kind: "ok", task: toTaskRow(row!) };
    });
  },

  async staleOrphansAcrossWorkspaces(olderThan: Date, limit: number) {
    // workspace 表无 RLS,可直接列;再逐租户查无主超时的 todo 任务(避免 worker 需要 BYPASSRLS)
    const wss = await getDb().select({ id: s.workspace.id }).from(s.workspace);
    const out: Array<{ workspaceId: string; task: TaskRow }> = [];
    for (const w of wss) {
      if (out.length >= limit) break;
      const rows = await withTenant(w.id, async (tx) =>
        tx
          .select()
          .from(s.task)
          .where(and(isNull(s.task.assigneeId), eq(s.task.status, "todo"), lt(s.task.createdAt, olderThan)))
          .limit(limit),
      );
      for (const r of rows) out.push({ workspaceId: w.id, task: toTaskRow(r) });
    }
    return out.slice(0, limit);
  },
};

export const seen: SeenCursorRepo = {
  async get(ws, agentId, channelId) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx
        .select()
        .from(s.agentSeen)
        .where(
          and(
            eq(s.agentSeen.agentId, agentId),
            eq(s.agentSeen.channelId, channelId),
          ),
        );
      return row?.modelSeenSeq ?? 0;
    });
  },

  async advance(ws, agentId, channelId, seq) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx
        .insert(s.agentSeen)
        .values({ workspaceId: ws, agentId, channelId, modelSeenSeq: seq })
        .onConflictDoUpdate({
          target: [s.agentSeen.workspaceId, s.agentSeen.agentId, s.agentSeen.channelId],
          set: { modelSeenSeq: sql`greatest(${s.agentSeen.modelSeenSeq}, ${seq})` },
        })
        .returning();
      return row!.modelSeenSeq;
    });
  },
};

export const readState: ReadStateRepo = {
  async get(ws, member, channelId) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx
        .select()
        .from(s.channelMember)
        .where(
          and(
            eq(s.channelMember.channelId, channelId),
            eq(s.channelMember.memberType, member.type),
            eq(s.channelMember.memberId, member.id),
          ),
        );
      return row?.lastReadSeq ?? 0;
    });
  },

  async advance(ws, member, channelId, seq) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx
        .insert(s.channelMember)
        .values({
          workspaceId: ws,
          channelId,
          memberType: member.type,
          memberId: member.id,
          lastReadSeq: seq,
        })
        .onConflictDoUpdate({
          target: [
            s.channelMember.channelId,
            s.channelMember.memberType,
            s.channelMember.memberId,
          ],
          set: { lastReadSeq: sql`greatest(${s.channelMember.lastReadSeq}, ${seq})` },
        })
        .returning();
      return row!.lastReadSeq;
    });
  },
};

import { reminders } from "./reminder.repo.js";
import type { ReminderRepo } from "../types.js";

type AgentSel = typeof s.agent.$inferSelect;
const toAgentRow = (a: AgentSel): AgentRow => ({
  id: a.id, handle: a.handle, displayName: a.displayName, description: a.description,
  avatarUrl: a.avatarUrl,
  runtime: a.runtime, model: a.model, status: a.status, machineId: a.machineId,
  provider: a.provider as AgentRow["provider"], providerBaseUrl: a.providerBaseUrl,
  providerApiKey: a.providerApiKey, reasoning: a.reasoning as AgentRow["reasoning"],
  fastMode: a.fastMode,
  createdAt: a.createdAt.toISOString(),
});

export const agents: AgentRepo = {
  async list(ws) {
    return withTenant(ws, async (tx) => {
      const rows = await tx.select().from(s.agent).orderBy(asc(s.agent.handle));
      return rows.map(toAgentRow);
    });
  },
  async get(ws, handle) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx.select().from(s.agent).where(eq(s.agent.handle, handle));
      return row ? toAgentRow(row) : null;
    });
  },
  async create(ws, a): Promise<AgentCreateOutcome> {
    return withTenant(ws, async (tx) => {
      const [existing] = await tx.select().from(s.agent).where(eq(s.agent.handle, a.handle));
      if (existing) return { kind: "duplicate" };
      const [row] = await tx.insert(s.agent).values({
        workspaceId: ws, handle: a.handle, displayName: a.displayName,
        description: a.description ?? "", runtime: a.runtime ?? "claude",
        ...(a.avatarUrl !== undefined ? { avatarUrl: a.avatarUrl } : {}),
        ...(a.model ? { model: a.model } : {}),
        ...(a.machineId ? { machineId: a.machineId } : {}),
        ...(a.provider ? { provider: a.provider } : {}),
        ...(a.providerBaseUrl ? { providerBaseUrl: a.providerBaseUrl } : {}),
        ...(a.providerApiKey ? { providerApiKey: a.providerApiKey } : {}),
        ...(a.reasoning ? { reasoning: a.reasoning } : {}),
        ...(a.fastMode !== undefined ? { fastMode: a.fastMode } : {}),
      }).returning();
      return { kind: "ok", agent: toAgentRow(row!) };
    });
  },
  async update(ws, handle, patch) {
    return withTenant(ws, async (tx) => {
      const set: Partial<typeof s.agent.$inferInsert> = {};
      if (patch.displayName !== undefined) set.displayName = patch.displayName;
      if (patch.description !== undefined) set.description = patch.description;
      if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;
      if (patch.runtime !== undefined) set.runtime = patch.runtime;
      if (patch.model !== undefined) set.model = patch.model;
      if (patch.machineId !== undefined) set.machineId = patch.machineId;
      if (patch.provider !== undefined) set.provider = patch.provider;
      if (patch.providerBaseUrl !== undefined) set.providerBaseUrl = patch.providerBaseUrl;
      if (patch.providerApiKey !== undefined) set.providerApiKey = patch.providerApiKey;
      if (patch.reasoning !== undefined) set.reasoning = patch.reasoning;
      if (patch.fastMode !== undefined) set.fastMode = patch.fastMode;
      if (Object.keys(set).length === 0) {
        const [row] = await tx.select().from(s.agent).where(eq(s.agent.handle, handle));
        return row ? toAgentRow(row) : null;
      }
      const [row] = await tx.update(s.agent).set(set).where(eq(s.agent.handle, handle)).returning();
      return row ? toAgentRow(row) : null;
    });
  },
  async remove(ws, handle) {
    return withTenant(ws, async (tx) => {
      const rows = await tx.delete(s.agent).where(eq(s.agent.handle, handle)).returning();
      return rows.length > 0;
    });
  },
};

type ActivitySel = typeof s.agentActivity.$inferSelect;
const toActivityRow = (a: ActivitySel): AgentActivityRow => ({
  id: a.id, agentHandle: a.agentHandle, channelId: a.channelId,
  activity: a.activity, detail: a.detail, seq: Number(a.seq),
  createdAt: a.createdAt.toISOString(),
});

export const activities: AgentActivityRepo = {
  async append(ws, a) {
    await withTenant(ws, async (tx) => {
      await tx.insert(s.agentActivity).values({
        workspaceId: ws, agentHandle: a.agentHandle, channelId: a.channelId,
        activity: a.activity, detail: a.detail, seq: a.seq,
      });
    });
  },
  async list(ws, handle, limit = 100) {
    return withTenant(ws, async (tx) => {
      const rows = await tx.select().from(s.agentActivity)
        .where(eq(s.agentActivity.agentHandle, handle))
        .orderBy(desc(s.agentActivity.createdAt))
        .limit(limit);
      return rows.map(toActivityRow);
    });
  },
};

type MachineSel = typeof s.machine.$inferSelect;
const toMachineRow = (m: MachineSel): MachineRow => ({
  id: m.id, name: m.name, hostname: m.hostname, os: m.os,
  daemonVersion: m.daemonVersion, runtimes: (m.runtimes as string[]) ?? [],
  status: m.status, tokenPrefix: m.tokenPrefix,
  lastSeenAt: m.lastSeenAt ? m.lastSeenAt.toISOString() : null,
  createdAt: m.createdAt.toISOString(),
});

export const machines: MachineRepo = {
  async list(ws) {
    return withTenant(ws, async (tx) => {
      const rows = await tx.select().from(s.machine).orderBy(asc(s.machine.createdAt));
      return rows.map(toMachineRow);
    });
  },
  async get(ws, id) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx.select().from(s.machine).where(eq(s.machine.id, id));
      return row ? toMachineRow(row) : null;
    });
  },
  async create(ws, m) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx.insert(s.machine).values({
        workspaceId: ws, name: m.name,
        ...(m.tokenPrefix ? { tokenPrefix: m.tokenPrefix } : {}),
      }).returning();
      return toMachineRow(row!);
    });
  },
  async rename(ws, id, name) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx.update(s.machine).set({ name })
        .where(eq(s.machine.id, id)).returning();
      return row ? toMachineRow(row) : null;
    });
  },
  async delete(ws, id) {
    // agent.machineId 外键为 onDelete:set null,删机器自动解绑 agent(不删 agent)。
    return withTenant(ws, async (tx) => {
      const rows = await tx.delete(s.machine).where(eq(s.machine.id, id)).returning({ id: s.machine.id });
      return rows.length > 0;
    });
  },
  async setTokenPrefix(ws, id, prefix) {
    await withTenant(ws, async (tx) => {
      await tx.update(s.machine).set({ tokenPrefix: prefix }).where(eq(s.machine.id, id));
    });
  },
  async setStatus(ws, id, status) {
    await withTenant(ws, async (tx) => {
      await tx.update(s.machine)
        .set(status === "online" ? { status, lastSeenAt: new Date() } : { status })
        .where(eq(s.machine.id, id));
    });
  },
  async resetAllOffline() {
    // 跨租户:遍历 workspace,逐租户把机器置 offline (RLS 要求设 current_workspace)
    const db = getDb();
    const wss = await db.select({ id: s.workspace.id }).from(s.workspace);
    for (const w of wss) {
      await withTenant(w.id, async (tx) => {
        await tx.update(s.machine).set({ status: "offline" }).where(ne(s.machine.status, "offline"));
      });
    }
  },
  async updateInfo(ws, id, patch) {
    await withTenant(ws, async (tx) => {
      await tx.update(s.machine).set({
        ...(patch.hostname !== undefined ? { hostname: patch.hostname } : {}),
        ...(patch.os !== undefined ? { os: patch.os } : {}),
        ...(patch.daemonVersion !== undefined ? { daemonVersion: patch.daemonVersion } : {}),
        ...(patch.runtimes !== undefined ? { runtimes: patch.runtimes as string[] } : {}),
        lastSeenAt: new Date(),
      }).where(eq(s.machine.id, id));
    });
  },
};

export const reactions: ReactionRepo = {
  async add(ws, messageId, actor, emoji) {
    await withTenant(ws, async (tx) => {
      await tx
        .insert(s.reaction)
        .values({ workspaceId: ws, messageId, actorType: actor.type, actorId: actor.id, emoji })
        .onConflictDoNothing(); // 唯一约束 → 幂等
    });
  },
  async remove(ws, messageId, actor, emoji) {
    await withTenant(ws, async (tx) => {
      await tx
        .delete(s.reaction)
        .where(
          and(
            eq(s.reaction.messageId, messageId),
            eq(s.reaction.actorType, actor.type),
            eq(s.reaction.actorId, actor.id),
            eq(s.reaction.emoji, emoji),
          ),
        );
    });
  },
  async listForMessages(ws, messageIds): Promise<ReactionRow[]> {
    if (messageIds.length === 0) return [];
    return withTenant(ws, async (tx) => {
      const rows = await tx
        .select({
          messageId: s.reaction.messageId,
          emoji: s.reaction.emoji,
          actorType: s.reaction.actorType,
          actorId: s.reaction.actorId,
        })
        .from(s.reaction)
        .where(inArray(s.reaction.messageId, messageIds as string[]))
        .orderBy(asc(s.reaction.createdAt));
      return rows.map((r) => ({ messageId: r.messageId, emoji: r.emoji, actorType: r.actorType, actorId: r.actorId }));
    });
  },
};

const toAttachmentRow = (a: typeof s.attachment.$inferSelect): AttachmentRow => ({
  id: a.id,
  messageId: a.messageId,
  uploader: { type: a.uploaderType, id: a.uploaderId },
  filename: a.filename,
  mime: a.mime,
  sizeBytes: a.sizeBytes,
  storageKey: a.storageKey,
  createdAt: a.createdAt.toISOString(),
});

export const attachments: AttachmentRepo = {
  async create(ws, a: NewAttachment) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx
        .insert(s.attachment)
        .values({
          id: a.id,
          workspaceId: ws,
          messageId: a.messageId,
          uploaderType: a.uploader.type,
          uploaderId: a.uploader.id,
          filename: a.filename,
          mime: a.mime,
          sizeBytes: a.sizeBytes,
          storageKey: a.storageKey,
        })
        .returning();
      return toAttachmentRow(row!);
    });
  },
  async get(ws, id) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx.select().from(s.attachment).where(eq(s.attachment.id, id));
      return row ? toAttachmentRow(row) : null;
    });
  },
  async listForMessages(ws, messageIds): Promise<AttachmentRow[]> {
    if (messageIds.length === 0) return [];
    return withTenant(ws, async (tx) => {
      const rows = await tx
        .select()
        .from(s.attachment)
        .where(inArray(s.attachment.messageId, messageIds as string[]))
        .orderBy(asc(s.attachment.createdAt));
      return rows.map(toAttachmentRow);
    });
  },
  async listForChannel(ws, channelId): Promise<AttachmentRow[]> {
    return withTenant(ws, async (tx) => {
      const rows = await tx
        .select({ a: s.attachment })
        .from(s.attachment)
        .innerJoin(s.message, eq(s.attachment.messageId, s.message.id))
        .where(eq(s.message.channelId, channelId))
        .orderBy(desc(s.attachment.createdAt));
      return rows.map((r) => toAttachmentRow(r.a));
    });
  },
};

export const savedRepo: SavedRepo = {
  async add(ws, actor, messageId) {
    await withTenant(ws, async (tx) => {
      await tx
        .insert(s.saved)
        .values({ workspaceId: ws, actorType: actor.type, actorId: actor.id, messageId })
        .onConflictDoNothing();
    });
  },
  async remove(ws, actor, messageId) {
    await withTenant(ws, async (tx) => {
      await tx
        .delete(s.saved)
        .where(and(eq(s.saved.actorType, actor.type), eq(s.saved.actorId, actor.id), eq(s.saved.messageId, messageId)));
    });
  },
  async listForActor(ws, actor): Promise<MessageRow[]> {
    return withTenant(ws, async (tx) => {
      const rows = await tx
        .select({ m: s.message })
        .from(s.saved)
        .innerJoin(s.message, eq(s.saved.messageId, s.message.id))
        .where(and(eq(s.saved.actorType, actor.type), eq(s.saved.actorId, actor.id)))
        .orderBy(desc(s.saved.createdAt));
      return rows.map((r) => toMessageRow(r.m));
    });
  },
  async savedSet(ws, actor, messageIds): Promise<Set<string>> {
    if (messageIds.length === 0) return new Set();
    return withTenant(ws, async (tx) => {
      const rows = await tx
        .select({ messageId: s.saved.messageId })
        .from(s.saved)
        .where(and(
          eq(s.saved.actorType, actor.type),
          eq(s.saved.actorId, actor.id),
          inArray(s.saved.messageId, messageIds as string[]),
        ));
      return new Set(rows.map((r) => r.messageId));
    });
  },
};

export const threadAttention: ThreadAttentionRepo = {
  async unfollow(ws, agentHandle, threadId) {
    await withTenant(ws, async (tx) => {
      await tx.insert(s.threadUnfollow)
        .values({ workspaceId: ws, agentHandle, threadId })
        .onConflictDoNothing();
    });
  },
  async follow(ws, agentHandle, threadId) {
    await withTenant(ws, async (tx) => {
      await tx.delete(s.threadUnfollow).where(and(
        eq(s.threadUnfollow.agentHandle, agentHandle),
        eq(s.threadUnfollow.threadId, threadId),
      ));
    });
  },
  async unfollowedHandles(ws, threadId): Promise<Set<string>> {
    return withTenant(ws, async (tx) => {
      const rows = await tx
        .select({ h: s.threadUnfollow.agentHandle })
        .from(s.threadUnfollow)
        .where(eq(s.threadUnfollow.threadId, threadId));
      return new Set(rows.map((r) => r.h));
    });
  },
};

const toActionCardRow = (a: typeof s.actionCard.$inferSelect): ActionCardRow => ({
  id: a.id,
  kind: a.kind,
  payload: a.payload as Record<string, unknown>,
  status: a.status,
  channelId: a.channelId,
  preparedBy: { type: a.preparedByType, id: a.preparedById },
  executedBy: a.executedByType && a.executedById ? { type: a.executedByType, id: a.executedById } : null,
  resultRef: a.resultRef,
  createdAt: a.createdAt.toISOString(),
});

export const actionCards: ActionCardRepo = {
  async create(ws, a: NewActionCard) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx.insert(s.actionCard).values({
        workspaceId: ws, kind: a.kind, payload: a.payload,
        ...(a.channelId ? { channelId: a.channelId } : {}),
        preparedByType: a.preparedBy.type, preparedById: a.preparedBy.id,
      }).returning();
      return toActionCardRow(row!);
    });
  },
  async get(ws, id) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx.select().from(s.actionCard).where(eq(s.actionCard.id, id));
      return row ? toActionCardRow(row) : null;
    });
  },
  async listPending(ws): Promise<ActionCardRow[]> {
    return withTenant(ws, async (tx) => {
      const rows = await tx.select().from(s.actionCard)
        .where(eq(s.actionCard.status, "pending"))
        .orderBy(desc(s.actionCard.createdAt));
      return rows.map(toActionCardRow);
    });
  },
  async resolve(ws, id, status, executedBy, resultRef): Promise<ActionCardRow | null> {
    return withTenant(ws, async (tx) => {
      const rows = await tx.update(s.actionCard)
        .set({
          status,
          executedByType: executedBy.type, executedById: executedBy.id,
          ...(resultRef !== undefined ? { resultRef } : {}),
          executedAt: sql`now()`,
        })
        .where(and(eq(s.actionCard.id, id), eq(s.actionCard.status, "pending"))) // 仅 pending → 幂等防重复执行
        .returning();
      return rows[0] ? toActionCardRow(rows[0]) : null;
    });
  },
};

export const integrations: IntegrationRepo = {
  async recordLogin(ws, agentHandle, integration) {
    await withTenant(ws, async (tx) => {
      await tx.insert(s.agentLogin)
        .values({ workspaceId: ws, agentHandle, integration })
        .onConflictDoNothing();
    });
  },
  async removeLogin(ws, agentHandle, integration) {
    await withTenant(ws, async (tx) => {
      await tx.delete(s.agentLogin).where(and(
        eq(s.agentLogin.agentHandle, agentHandle), eq(s.agentLogin.integration, integration),
      ));
    });
  },
  async list(ws, agentHandle): Promise<AgentLoginRow[]> {
    return withTenant(ws, async (tx) => {
      const rows = await tx.select().from(s.agentLogin)
        .where(eq(s.agentLogin.agentHandle, agentHandle))
        .orderBy(asc(s.agentLogin.integration));
      return rows.map((r) => ({ integration: r.integration, createdAt: r.createdAt.toISOString() }));
    });
  },
};

export interface PgRepos {
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

export function createPgRepos(): PgRepos {
  return { messages, reactions, attachments, saved: savedRepo, threadAttention, actionCards, integrations, drafts, tasks, seen, readState, directory, channels, feed, reminders, agents, machines, activities };
}
