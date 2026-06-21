/**
 * Agent 数据面路由 (映射 `crew` CLI 命令)。要求 `sk_agent_*` 凭证。
 * workspace 与身份均来自 token (principal),agent 无法跨租户或冒充他人。
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppServices } from "../services-context.js";
import { ok, toHttpError } from "../envelope.js";
import { principalOf, requireTier } from "../auth.js";
import { DomainError } from "../../domain/errors.js";
import { toDTO as attachmentDto } from "../../services/attachment.service.js";

const SendBody = z.object({
  content: z.string().min(1),
  // 线程父消息:接受完整 uuid 或 ≥8 位短码 (msg=);路由内 resolve 成真实 id。
  // 限制 ≥8 防止把 seq 这种短串误当前缀匹配到无关消息。
  thread: z.string().min(8).optional(),
  force: z.boolean().optional(),
});
const ReadBody = z.object({ upToSeq: z.number().int().nonnegative() });
const ListQuery = z.object({
  afterSeq: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export async function registerAgentRoutes(
  app: FastifyInstance,
  svc: AppServices,
): Promise<void> {
  const guard = { preHandler: [app.authenticate, requireTier("agent")] };

  // crew whoami
  app.get("/agent/whoami", guard, async (req) => {
    const p = principalOf(req);
    return ok({ workspaceId: p.workspaceId, actor: p.actor, tier: p.tier });
  });

  // crew message read
  app.get("/agent/channels/:channelId/messages", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const q = ListQuery.parse(req.query);
      const rows = await svc.messages.listForActor(p.workspaceId, channelId, q);
      const ids = rows.map((m) => m.id);
      const [reactions, attachments] = await Promise.all([
        svc.reactions.summaryFor(p.workspaceId, ids, p.actor),
        svc.attachments.forMessages(p.workspaceId, ids),
      ]);
      return ok(rows.map((m) => ({ ...m, reactions: reactions.get(m.id) ?? [], attachments: attachments.get(m.id) ?? [] })));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew message read 之后推进 freshness/read 游标
  app.post("/agent/channels/:channelId/read", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const { upToSeq } = ReadBody.parse(req.body);
      const cursor = await svc.reads.markRead(p.workspaceId, p.actor, channelId, upToSeq);
      return ok({ lastReadSeq: cursor });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew message send (含 freshness hold → draft)
  app.post("/agent/channels/:channelId/messages", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const b = SendBody.parse(req.body);
      // 把线程短码 resolve 成真实消息 id (不存在 → NOT_FOUND)
      const threadParentId = b.thread
        ? (await svc.messages.resolve(p.workspaceId, b.thread)).id
        : null;
      const result = await svc.messages.sendAsAgent(p.workspaceId, p.actor, {
        channelId,
        content: b.content,
        threadParentId,
        force: b.force ?? false,
      });
      if (result.kind === "sent") {
        svc.emit(p.workspaceId, { type: "message.created", message: result.message });
        await svc.wake.onMessage(p.workspaceId, {
          channelId,
          content: result.message.content,
          senderType: result.message.sender.type,
          senderId: result.message.sender.id,
          seq: result.message.seq,
          messageId: result.message.id,
          threadParentId: result.message.threadParentId, // 在线程里 @ → 沿用该线程
        });
        return reply.code(201).send(ok(result));
      }
      // held:不是错误,而是协议状态,用 202 表达"已受理但未发出"
      return reply.code(202).send(ok(result));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew attachment upload / download —— agent 上传产出物 / 取附件
  app.post("/agent/channels/:channelId/messages/:messageId/attachments", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { messageId } = req.params as { channelId: string; messageId: string };
      const file = await req.file();
      if (!file) return reply.code(400).send(toHttpError(new DomainError("VALIDATION", "no file in request", {})).body);
      const data = await file.toBuffer();
      const row = await svc.attachments.upload(p.workspaceId, p.actor, {
        messageId, filename: file.filename, mime: file.mimetype, data,
      });
      return reply.code(201).send(ok(attachmentDto(row)));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/agent/attachments/:id/download", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { id } = req.params as { id: string };
      const { row, data } = await svc.attachments.download(p.workspaceId, id);
      reply.header("content-type", row.mime);
      reply.header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
      return reply.send(data);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew integration list / login / logout —— 记录 agent 已登录的三方集成
  app.get("/agent/integrations", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      return ok(await svc.integrations.list(p.workspaceId, p.actor.id));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });
  app.post("/agent/integrations/:name/login", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { name } = req.params as { name: string };
      await svc.integrations.login(p.workspaceId, p.actor.id, name);
      return reply.code(201).send(ok({ integration: name, loggedIn: true }));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });
  app.post("/agent/integrations/:name/logout", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { name } = req.params as { name: string };
      await svc.integrations.logout(p.workspaceId, p.actor.id, name);
      return ok({ integration: name, loggedIn: false });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew action prepare —— agent 备好一个待人类执行的操作卡(channel:create / agent:create)
  app.post("/agent/actions", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const b = z.object({
        kind: z.string().min(1),
        payload: z.record(z.unknown()),
        channelId: z.string().uuid().nullable().optional(),
      }).parse(req.body);
      const card = await svc.actions.prepare(p.workspaceId, p.actor, b.kind, b.payload, b.channelId ?? null);
      svc.emit(p.workspaceId, { type: "action.prepared", actionId: card.id });
      return reply.code(201).send(ok(card));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew channel members / join / leave —— agent 列成员 / 加入退出公开频道
  app.get("/agent/channels/:channelId/members", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      return ok(await svc.channels.listMembers(p.workspaceId, channelId));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });
  for (const action of ["join", "leave"] as const) {
    app.post(`/agent/channels/:channelId/${action}`, guard, async (req, reply) => {
      try {
        const p = principalOf(req);
        const { channelId } = req.params as { channelId: string };
        const r = await svc.channels[action](p.workspaceId, p.actor, channelId);
        if (r.kind === "not_found") throw new DomainError("NOT_FOUND", `channel not found: ${channelId}`, {});
        if (r.kind === "forbidden") throw new DomainError("FORBIDDEN", "private channel cannot be joined directly", {});
        return ok(r.channel);
      } catch (e) {
        const { status, body } = toHttpError(e);
        return reply.code(status).send(body);
      }
    });
  }

  // crew thread unfollow / follow —— agent 停止/恢复接收某线程的普通推送
  app.post("/agent/threads/:thread/unfollow", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { thread } = req.params as { thread: string };
      const parent = await svc.messages.resolve(p.workspaceId, thread); // 短码/全 id → 父消息
      await svc.threads.unfollow(p.workspaceId, p.actor.id, parent.id);
      return ok({ unfollowed: true, threadId: parent.id });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });
  app.post("/agent/threads/:thread/follow", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { thread } = req.params as { thread: string };
      const parent = await svc.messages.resolve(p.workspaceId, thread);
      await svc.threads.follow(p.workspaceId, p.actor.id, parent.id);
      return ok({ unfollowed: false, threadId: parent.id });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew profile show —— agent 查看自己的资料卡
  app.get("/agent/profile", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const me = await svc.agents.get(p.workspaceId, p.actor.id);
      if (!me) return reply.code(404).send(toHttpError(new DomainError("NOT_FOUND", "agent profile not found", {})).body);
      return ok(me);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew profile update —— agent 仅能改自己的 displayName/description/avatar(不可改 runtime/机器等)
  app.patch("/agent/profile", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const b = z.object({
        displayName: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().max(3000).optional(),
        avatarUrl: z.string().trim().url().max(500).nullable().optional(),
      }).parse(req.body);
      const updated = await svc.agents.update(p.workspaceId, p.actor.id, b);
      return ok(updated);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew message react / unreact —— agent 也能给消息加表情
  app.post("/agent/channels/:channelId/messages/:messageId/reactions", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId, messageId } = req.params as { channelId: string; messageId: string };
      const b = z.object({ emoji: z.string().trim().min(1).max(32) }).parse(req.body);
      await svc.reactions.add(p.workspaceId, p.actor, messageId, b.emoji);
      svc.emit(p.workspaceId, { type: "reaction.updated", channelId, messageId });
      return reply.code(201).send(ok({ ok: true }));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.delete("/agent/channels/:channelId/messages/:messageId/reactions/:emoji", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId, messageId, emoji } = req.params as { channelId: string; messageId: string; emoji: string };
      await svc.reactions.remove(p.workspaceId, p.actor, messageId, decodeURIComponent(emoji));
      svc.emit(p.workspaceId, { type: "reaction.updated", channelId, messageId });
      return ok({ ok: true });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew task claim
  app.post("/agent/tasks/:taskId/claim", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { taskId } = req.params as { taskId: string };
      const result = await svc.tasks.claim(p.workspaceId, p.actor, taskId);
      svc.emit(p.workspaceId, { type: "task.updated", taskId: result.taskId });
      return ok(result);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew task assign —— 指派 / 交接给另一个 agent(如 dev 干完交给 qa)
  app.post("/agent/tasks/:taskId/assign", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { taskId } = req.params as { taskId: string };
      const b = z.object({ to: z.string().min(1) }).parse(req.body);
      const task = await svc.tasks.assign(p.workspaceId, p.actor, taskId, b.to);
      svc.emit(p.workspaceId, { type: "task.updated", taskId: task.id });
      // 唤醒接手的 agent,让它立刻接活(不唤醒自己)
      await svc.wake.wakeAgent(p.workspaceId, b.to, task.channelId, `你被指派了任务 #${task.number}: ${task.title}`, p.actor.id, null);
      return ok(task);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew task list
  app.get("/agent/channels/:channelId/tasks", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const q = req.query as { status?: string; mine?: string };
      const rows = await svc.tasks.list(p.workspaceId, {
        channelId,
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.mine === "1" ? { assignee: p.actor } : {}),
      });
      return ok(rows);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew task create
  app.post("/agent/channels/:channelId/tasks", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const b = z.object({ title: z.string().min(1) }).parse(req.body);
      const result = await svc.tasks.create(p.workspaceId, p.actor, {
        channelId,
        title: b.title,
      });
      svc.emit(p.workspaceId, { type: "message.created", message: result.message });
      svc.emit(p.workspaceId, { type: "task.updated", taskId: result.task.id });
      return reply.code(201).send(ok(result));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew task create 批量(任务拆分):titles[] + 可选 parentTaskId
  app.post("/agent/channels/:channelId/tasks/batch", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const b = z.object({
        titles: z.array(z.string().min(1).max(500)).min(1).max(50),
        parentTaskId: z.string().min(1).optional(),
      }).parse(req.body);
      const results = await svc.tasks.createBatch(p.workspaceId, p.actor, {
        channelId, titles: b.titles, ...(b.parentTaskId ? { parentTaskId: b.parentTaskId } : {}),
      });
      for (const r of results) {
        svc.emit(p.workspaceId, { type: "message.created", message: r.message });
        svc.emit(p.workspaceId, { type: "task.updated", taskId: r.task.id });
      }
      return reply.code(201).send(ok(results.map((r) => r.task)));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew task unclaim
  app.post("/agent/tasks/:taskId/unclaim", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { taskId } = req.params as { taskId: string };
      const task = await svc.tasks.unclaim(p.workspaceId, p.actor, taskId);
      svc.emit(p.workspaceId, { type: "task.updated", taskId });
      return ok(task);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew task update --status
  app.post("/agent/tasks/:taskId/status", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { taskId } = req.params as { taskId: string };
      const b = z.object({ status: z.string().min(1) }).parse(req.body);
      const task = await svc.tasks.updateStatus(p.workspaceId, p.actor, taskId, b.status);
      svc.emit(p.workspaceId, { type: "task.updated", taskId });
      return ok(task);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew server info
  app.get("/agent/server-info", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      return ok(await svc.directory.serverInfo(p.workspaceId, p.actor));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew message search
  app.get("/agent/messages/search", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const q = z
        .object({
          q: z.string().min(1),
          channel: z.string().optional(),
          limit: z.coerce.number().int().positive().max(200).optional(),
        })
        .parse(req.query);
      const rows = await svc.messages.search(p.workspaceId, {
        query: q.q,
        ...(q.channel ? { channelId: q.channel } : {}),
        ...(q.limit ? { limit: q.limit } : {}),
      });
      return ok(rows);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew message resolve
  app.get("/agent/messages/:idOrPrefix/resolve", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { idOrPrefix } = req.params as { idOrPrefix: string };
      return ok(await svc.messages.resolve(p.workspaceId, idOrPrefix));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // crew message check (未读数)
  app.get("/agent/channels/:channelId/unread", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const unread = await svc.reads.unread(p.workspaceId, p.actor, channelId);
      return ok({ unread });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // ---- reminders ----
  app.post("/agent/reminders", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const b = z.object({
        title: z.string().min(1),
        at: z.string().optional(),
        in: z.string().optional(),
        cron: z.string().optional(),
        channel: z.string().optional(),
        timezone: z.string().optional(),
      }).parse(req.body);
      const r = await svc.reminders.schedule(p.workspaceId, p.actor, {
        title: b.title,
        ...(b.at ? { at: b.at } : {}),
        ...(b.in ? { in: b.in } : {}),
        ...(b.cron ? { cron: b.cron } : {}),
        ...(b.channel ? { channelId: b.channel } : {}),
        ...(b.timezone ? { timezone: b.timezone } : {}),
      });
      return reply.code(201).send(ok(r));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/agent/reminders", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      return ok(await svc.reminders.list(p.workspaceId, p.actor));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/agent/reminders/:id/snooze", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { id } = req.params as { id: string };
      const b = z.object({ in: z.string().min(2) }).parse(req.body);
      return ok(await svc.reminders.snooze(p.workspaceId, p.actor, id, b.in));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/agent/reminders/:id/update", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { id } = req.params as { id: string };
      const b = z.object({
        title: z.string().optional(),
        at: z.string().optional(),
        in: z.string().optional(),
        cron: z.string().optional(),
      }).parse(req.body);
      return ok(await svc.reminders.update(p.workspaceId, p.actor, id, b));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/agent/reminders/:id/cancel", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { id } = req.params as { id: string };
      return ok(await svc.reminders.cancel(p.workspaceId, p.actor, id));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/agent/reminders/:id/log", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { id } = req.params as { id: string };
      return ok(await svc.reminders.log(p.workspaceId, p.actor, id));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  void DomainError;
}
