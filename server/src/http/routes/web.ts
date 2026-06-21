/**
 * Web 数据面路由 (人类成员的协作窗口)。要求 `sk_user_*` 凭证。
 * 人类发送无 freshness 约束 (UI 始终看到最新)。
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppServices } from "../services-context.js";
import { err, ok, toHttpError } from "../envelope.js";
import { principalOf, requireTier } from "../auth.js";
import { mentionedAgents } from "../../domain/mention.js";
import { toDTO as attachmentDto } from "../../services/attachment.service.js";

const SendBody = z.object({
  content: z.string().min(1),
  threadParentId: z.string().uuid().nullable().optional(),
  asTask: z.boolean().optional(), // 把这条消息提升为任务
});
const ReadBody = z.object({ upToSeq: z.number().int().nonnegative() });
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;
const RuntimeConfigFields = {
  provider: z.enum(["default", "custom"]).optional(),
  providerBaseUrl: z.string().trim().max(300).nullable().optional(),
  providerApiKey: z.string().trim().max(300).nullable().optional(),
  reasoning: z.enum(["default", "low", "medium", "high"]).optional(),
  fastMode: z.boolean().optional(),
};
const AVATAR_URL = z.string().trim().url().max(500).nullable();
const NewAgentBody = z.object({
  handle: z.string().trim().toLowerCase().regex(HANDLE_RE, "handle must be lowercase letters/digits/-/_, 2-31 chars"),
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(3000).optional(),
  avatarUrl: AVATAR_URL.optional(),
  runtime: z.string().trim().min(1).max(40).optional(),
  model: z.string().trim().min(1).max(80).optional(),
  machineId: z.string().uuid().optional(),
  ...RuntimeConfigFields,
});
const AgentPatchBody = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(3000).optional(),
  avatarUrl: AVATAR_URL.optional(),
  runtime: z.string().trim().min(1).max(40).optional(),
  model: z.string().trim().min(1).max(80).nullable().optional(),
  machineId: z.string().uuid().nullable().optional(),
  ...RuntimeConfigFields,
});
const ImportRaftBody = z.object({
  machineId: z.string().uuid(),
  raftPath: z.string().trim().min(1).max(500),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(3000).optional(),
  runtime: z.string().trim().min(1).max(40).optional(),
});
const NewMachineBody = z.object({ name: z.string().trim().min(1).max(80).optional() });
const RenameMachineBody = z.object({ name: z.string().trim().min(1).max(80) });
const ListQuery = z.object({
  afterSeq: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export async function registerWebRoutes(
  app: FastifyInstance,
  svc: AppServices,
): Promise<void> {
  const guard = { preHandler: [app.authenticate, requireTier("user")] };

  app.get("/api/channels/:channelId/messages", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const q = ListQuery.parse(req.query);
      const msgs = await svc.messages.listForActor(p.workspaceId, channelId, q);
      const ids = msgs.map((m) => m.id);
      // 合并每条消息的表情反应聚合 + 附件 + 本人是否收藏
      const [reactions, attachments, savedSet] = await Promise.all([
        svc.reactions.summaryFor(p.workspaceId, ids, p.actor),
        svc.attachments.forMessages(p.workspaceId, ids),
        svc.saved.savedSet(p.workspaceId, p.actor, ids),
      ]);
      return ok(msgs.map((m) => ({
        ...m,
        reactions: reactions.get(m.id) ?? [],
        attachments: attachments.get(m.id) ?? [],
        saved: savedSet.has(m.id),
      })));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/api/channels/:channelId/messages", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const b = SendBody.parse(req.body);
      const message = await svc.messages.sendAsHuman(p.workspaceId, p.actor, {
        channelId,
        content: b.content,
        threadParentId: b.threadParentId ?? null,
      });
      svc.emit(p.workspaceId, { type: "message.created", message });
      // asTask:把这条消息提升为任务,不另发消息
      if (b.asTask) {
        const task = await svc.tasks.createFromMessage(p.workspaceId, p.actor, {
          channelId, title: message.content, messageId: message.id,
        });
        // message-end hook —— 自动指派/分诊,杜绝「任务无人认领」:
        //   DM      → 指派给对端 agent
        //   channel + @了某 agent → 指派给被 @ 的第一个
        //   channel 没指明对象 → 交给总管 Cindy 分诊(按职责决定派给谁)
        try {
          const peer = await svc.channels.dmPeerHandle(p.workspaceId, channelId);
          if (peer) {
            await svc.tasks.assign(p.workspaceId, p.actor, task.id, peer);
          } else {
            const info = await svc.directory.serverInfo(p.workspaceId, p.actor);
            const mentioned = mentionedAgents(message.content, info.agents.map((a) => a.handle))[0];
            if (mentioned) {
              await svc.tasks.assign(p.workspaceId, p.actor, task.id, mentioned);
            } else {
              await svc.wake.triage(p.workspaceId, info.agents, {
                id: task.id, number: task.number, title: task.title, channelId, by: p.actor.id,
              });
            }
          }
        } catch { /* 指派/分诊失败 → 留无主,巡检层兜底(Phase 3) */ }
        svc.emit(p.workspaceId, { type: "task.updated", taskId: task.id });
      }
      await svc.wake.onMessage(p.workspaceId, {
        channelId,
        content: message.content,
        senderType: message.sender.type,
        senderId: message.sender.id,
        seq: message.seq,
        messageId: message.id, // 顶层消息→以它为线程根,agent 回复都落该线程
        threadParentId: message.threadParentId, // 线程回复 → agent 在该线程内回
      });
      // DM:与某 agent 的 1:1 频道里,人类的每条消息都直接唤醒对端(无需 @)
      if (message.sender.type === "human") {
        const peer = await svc.channels.dmPeerHandle(p.workspaceId, channelId);
        if (peer) await svc.wake.wakeAgent(p.workspaceId, peer, channelId, message.content, message.sender.id, message.threadParentId);
      }
      return reply.code(201).send(ok(message));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 操作卡 (action prepare):人类查看待办 / 执行(以本人身份)/ 驳回
  app.get("/api/actions", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      return ok(await svc.actions.list(p.workspaceId));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });
  app.post("/api/actions/:id/execute", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { id } = req.params as { id: string };
      const card = await svc.actions.execute(p.workspaceId, p.actor, id);
      svc.emit(p.workspaceId, { type: "action.updated", actionId: id });
      return ok(card);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });
  app.post("/api/actions/:id/dismiss", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { id } = req.params as { id: string };
      const card = await svc.actions.dismiss(p.workspaceId, p.actor, id);
      svc.emit(p.workspaceId, { type: "action.updated", actionId: id });
      return ok(card);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 频道归档 / 取消归档(归档后拒写,见 MessageService.assertWritable)
  app.post("/api/channels/:channelId/archive", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      await svc.channels.setArchived(p.workspaceId, channelId, true);
      return ok({ archived: true });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });
  app.post("/api/channels/:channelId/unarchive", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      await svc.channels.setArchived(p.workspaceId, channelId, false);
      return ok({ archived: false });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 频道附件汇总 (Files tab)
  app.get("/api/channels/:channelId/files", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      return ok(await svc.attachments.forChannel(p.workspaceId, channelId));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 收藏消息 (Saved):本人书签。save / unsave / 列出
  app.get("/api/saved", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      return ok(await svc.saved.list(p.workspaceId, p.actor));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/api/messages/:messageId/save", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { messageId } = req.params as { messageId: string };
      await svc.saved.save(p.workspaceId, p.actor, messageId);
      return reply.code(201).send(ok({ ok: true }));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.delete("/api/messages/:messageId/save", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { messageId } = req.params as { messageId: string };
      await svc.saved.unsave(p.workspaceId, p.actor, messageId);
      return ok({ ok: true });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 附件上传 (multipart, 字段名 file);可选 messageId 把附件锚定到某消息
  app.post("/api/channels/:channelId/messages/:messageId/attachments", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { messageId } = req.params as { channelId: string; messageId: string };
      const file = await req.file();
      if (!file) return reply.code(400).send(err("VALIDATION", "no file in request"));
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

  // 附件下载 (鉴权后流式返回字节;前端经 fetch 带 token → blob 渲染/下载)
  app.get("/api/attachments/:id/download", guard, async (req, reply) => {
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

  // 表情反应:加 (POST {emoji}) / 去 (DELETE /:emoji)。toggle 由前端控制。
  app.post("/api/channels/:channelId/messages/:messageId/reactions", guard, async (req, reply) => {
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

  app.delete("/api/channels/:channelId/messages/:messageId/reactions/:emoji", guard, async (req, reply) => {
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

  app.post("/api/channels", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const b = z.object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(2000).nullable().optional(),
        isPrivate: z.boolean().optional(),
        members: z.array(z.object({ type: z.enum(["agent", "human"]), id: z.string().min(1) })).max(100).optional(),
      }).parse(req.body);
      const channel = await svc.channels.create(p.workspaceId, {
        name: b.name,
        ...(b.description !== undefined ? { description: b.description } : {}),
        ...(b.isPrivate !== undefined ? { isPrivate: b.isPrivate } : {}),
        ...(b.members ? { members: b.members } : {}),
      }, p.actor);
      return reply.code(201).send(ok(channel));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/channels/:channelId/members", guard, async (req, reply) => {
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
    app.post(`/api/channels/:channelId/${action}`, guard, async (req, reply) => {
      try {
        const p = principalOf(req);
        const { channelId } = req.params as { channelId: string };
        const r = await svc.channels[action](p.workspaceId, p.actor, channelId);
        if (r.kind === "not_found") return reply.code(404).send(err("NOT_FOUND", `channel not found: ${channelId}`));
        if (r.kind === "forbidden") return reply.code(403).send(err("FORBIDDEN", "private channel cannot be joined directly"));
        return ok(r.channel);
      } catch (e) {
        const { status, body } = toHttpError(e);
        return reply.code(status).send(body);
      }
    });
  }

  // 添加任意 agent/human 进频道(需调用方本身已是该频道成员)
  app.post("/api/channels/:channelId/members", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const b = z.object({ type: z.enum(["agent", "human"]), id: z.string().trim().min(1) }).parse(req.body);
      const isMember = (await svc.channels.listMembers(p.workspaceId, channelId))
        .some((m) => m.memberType === p.actor.type && m.memberId === p.actor.id);
      if (!isMember) return reply.code(403).send(err("FORBIDDEN", "only channel members can edit membership"));
      const r = await svc.channels.addMember(p.workspaceId, channelId, { type: b.type, id: b.id });
      if (r.kind === "not_found") return reply.code(404).send(err("NOT_FOUND", `channel not found: ${channelId}`));
      if (r.kind === "invalid") return reply.code(400).send(err("INVALID", `no such ${b.type}: ${b.id}`));
      return ok(await svc.channels.listMembers(p.workspaceId, channelId));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 从频道移除任意成员(需调用方本身已是该频道成员)
  app.delete("/api/channels/:channelId/members/:memberType/:memberId", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const params = z.object({
        channelId: z.string().min(1),
        memberType: z.enum(["agent", "human"]),
        memberId: z.string().min(1),
      }).parse(req.params);
      const isMember = (await svc.channels.listMembers(p.workspaceId, params.channelId))
        .some((m) => m.memberType === p.actor.type && m.memberId === p.actor.id);
      if (!isMember) return reply.code(403).send(err("FORBIDDEN", "only channel members can edit membership"));
      const r = await svc.channels.removeMember(p.workspaceId, params.channelId, { type: params.memberType, id: params.memberId });
      if (r.kind === "not_found") return reply.code(404).send(err("NOT_FOUND", `channel not found: ${params.channelId}`));
      return ok(await svc.channels.listMembers(p.workspaceId, params.channelId));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/activity", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const q = z.object({ limit: z.coerce.number().int().positive().max(200).optional() }).parse(req.query);
      return ok(await svc.feed.activity(p.workspaceId, p.actor, q.limit));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/server-info", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      return ok(await svc.directory.serverInfo(p.workspaceId, p.actor));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 当前登录者 + 工作区信息(Settings 面板用)
  app.get("/api/me", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const [workspace, info] = await Promise.all([
        svc.directory.workspace(p.workspaceId),
        svc.directory.serverInfo(p.workspaceId, p.actor),
      ]);
      const me = [...info.humans, ...info.agents].find((m) => m.handle === p.actor.id);
      return ok({
        tier: p.tier,
        actor: p.actor,
        displayName: me?.displayName ?? p.actor.id,
        workspace: workspace ?? { id: p.workspaceId, name: p.workspaceId, slug: p.workspaceId },
      });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/agents", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      return ok(await svc.agents.list(p.workspaceId));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/api/agents", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const b = NewAgentBody.parse(req.body);
      const agent = await svc.agents.create(p.workspaceId, {
        handle: b.handle,
        displayName: b.displayName,
        ...(b.description ? { description: b.description } : {}),
        ...(b.avatarUrl !== undefined ? { avatarUrl: b.avatarUrl } : {}),
        ...(b.runtime ? { runtime: b.runtime } : {}),
        ...(b.model ? { model: b.model } : {}),
        ...(b.machineId ? { machineId: b.machineId } : {}),
        ...(b.provider ? { provider: b.provider } : {}),
        ...(b.providerBaseUrl !== undefined ? { providerBaseUrl: b.providerBaseUrl } : {}),
        ...(b.providerApiKey !== undefined ? { providerApiKey: b.providerApiKey } : {}),
        ...(b.reasoning ? { reasoning: b.reasoning } : {}),
        ...(b.fastMode !== undefined ? { fastMode: b.fastMode } : {}),
      });
      return reply.code(201).send(ok(agent));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 预览:读 raft 工作区的 MEMORY.md 反填 name/description(不建 agent、不复制)
  app.post("/api/agents/import/inspect", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const b = z.object({ machineId: z.string().uuid(), raftPath: z.string().trim().min(1).max(500) }).parse(req.body);
      return ok(await svc.agents.inspectRaft(p.workspaceId, b.machineId, b.raftPath));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 导入已有 raft agent:复制其工作区 + 按 MEMORY.md 反填(name/description 可留空)
  app.post("/api/agents/import", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const b = ImportRaftBody.parse(req.body);
      const agent = await svc.agents.importRaft(p.workspaceId, {
        machineId: b.machineId,
        raftPath: b.raftPath,
        name: b.name,
        description: b.description,
        runtime: b.runtime,
      });
      return reply.code(201).send(ok(agent));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/agents/:handle", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { handle } = req.params as { handle: string };
      const agent = await svc.agents.get(p.workspaceId, handle);
      if (!agent) return reply.code(404).send(err("NOT_FOUND", `agent not found: ${handle}`));
      return ok(agent);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/agents/:handle/files", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { handle } = req.params as { handle: string };
      const path = typeof (req.query as { path?: string }).path === "string" ? (req.query as { path: string }).path : "";
      return ok(await svc.workspace.list(p.workspaceId, handle, path));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/agents/:handle/activity", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { handle } = req.params as { handle: string };
      const q = z.object({ limit: z.coerce.number().int().positive().max(500).optional() }).parse(req.query);
      return ok(await svc.activities.list(p.workspaceId, handle, q.limit));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/api/agents/:handle/dm", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { handle } = req.params as { handle: string };
      const channel = await svc.channels.openDm(p.workspaceId, p.actor, handle);
      return reply.code(201).send(ok(channel));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/agents/:handle/skills", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { handle } = req.params as { handle: string };
      return ok(await svc.workspace.skills(p.workspaceId, handle));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/agents/:handle/file", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { handle } = req.params as { handle: string };
      const q = z.object({ path: z.string().min(1) }).parse(req.query);
      return ok(await svc.workspace.read(p.workspaceId, handle, q.path));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.patch("/api/agents/:handle", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { handle } = req.params as { handle: string };
      const b = AgentPatchBody.parse(req.body);
      const agent = await svc.agents.update(p.workspaceId, handle, b);
      return ok(agent);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.delete("/api/agents/:handle", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { handle } = req.params as { handle: string };
      await svc.agents.remove(p.workspaceId, handle);
      return ok({ deleted: true });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // ---- 机器(电脑)管理 ----
  app.get("/api/machines", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      return ok(await svc.machines.list(p.workspaceId));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/api/machines", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const b = NewMachineBody.parse(req.body ?? {});
      const result = await svc.machines.create(p.workspaceId, b.name);
      return reply.code(201).send(ok(result));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/machines/:id", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { id } = req.params as { id: string };
      const machine = await svc.machines.get(p.workspaceId, id);
      if (!machine) return reply.code(404).send(err("NOT_FOUND", `machine not found: ${id}`));
      return ok(machine);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.patch("/api/machines/:id", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { id } = req.params as { id: string };
      const b = RenameMachineBody.parse(req.body);
      const machine = await svc.machines.rename(p.workspaceId, id, b.name);
      if (!machine) return reply.code(404).send(err("NOT_FOUND", `machine not found: ${id}`));
      return ok(machine);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 重新生成连接命令 (Generate Connect Command):为已有机器重发 token
  app.post("/api/machines/:id/connect-command", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { id } = req.params as { id: string };
      const result = await svc.machines.regenerateCommand(p.workspaceId, id);
      if (!result) return reply.code(404).send(err("NOT_FOUND", `machine not found: ${id}`));
      return ok(result);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/messages/search", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const q = z.object({
        q: z.string().min(1),
        channel: z.string().optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
      }).parse(req.query);
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

  app.get("/api/channels/:channelId/tasks", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const q = req.query as { status?: string };
      return ok(
        await svc.tasks.list(p.workspaceId, {
          channelId,
          ...(q.status ? { status: q.status as never } : {}),
        }),
      );
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/api/channels/:channelId/tasks", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { channelId } = req.params as { channelId: string };
      const b = z.object({ title: z.string().min(1) }).parse(req.body);
      const result = await svc.tasks.create(p.workspaceId, p.actor, { channelId, title: b.title });
      svc.emit(p.workspaceId, { type: "message.created", message: result.message });
      svc.emit(p.workspaceId, { type: "task.updated", taskId: result.task.id });
      return reply.code(201).send(ok(result));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 批量建任务 / 任务拆分(parentTaskId 把多个子任务挂到父任务下)
  app.post("/api/channels/:channelId/tasks/batch", guard, async (req, reply) => {
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

  // ---- 任务卡操作 (web 人类成员) ----
  app.post("/api/tasks/:taskId/claim", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { taskId } = req.params as { taskId: string };
      const result = await svc.tasks.claim(p.workspaceId, p.actor, taskId);
      svc.emit(p.workspaceId, { type: "task.updated", taskId });
      return ok(result);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/api/tasks/:taskId/status", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const { taskId } = req.params as { taskId: string };
      const b = z.object({ status: z.enum(["todo", "in_progress", "in_review", "done"]) }).parse(req.body);
      const task = await svc.tasks.updateStatus(p.workspaceId, p.actor, taskId, b.status);
      svc.emit(p.workspaceId, { type: "task.updated", taskId });
      return ok(task);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/api/tasks/:taskId/unclaim", guard, async (req, reply) => {
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

  app.post("/api/channels/:channelId/read", guard, async (req, reply) => {
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
}
