/**
 * Daemon 控制面路由。要求 `sk_machine_*` 凭证。
 * daemon 用机器令牌为某个 agent (按 handle) 换取 per-launch 的 `sk_agent_*`。
 * agent 与 workspace 绑定在机器令牌上,daemon 无法跨租户。
 */

import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "../../db/client.js";
import * as s from "../../db/schema.js";
import { mintCredential } from "../../auth/service.js";
import { ok, toHttpError } from "../envelope.js";
import { principalOf, requireTier } from "../auth.js";

const TokenBody = z.object({
  handle: z.string().min(1).max(64),
  displayName: z.string().min(1).max(128).optional(),
});

export async function registerDaemonRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: [app.authenticate, requireTier("machine")] };

  // 为 agent 签发 per-launch sk_agent_*;agent 不存在则按 handle 创建。
  app.post("/daemon/agents/token", guard, async (req, reply) => {
    try {
      const p = principalOf(req);
      const b = TokenBody.parse(req.body);

      const row = await withTenant(p.workspaceId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(s.agent)
          .where(and(eq(s.agent.workspaceId, p.workspaceId), eq(s.agent.handle, b.handle)));
        if (existing) return existing;
        const [created] = await tx
          .insert(s.agent)
          .values({
            workspaceId: p.workspaceId,
            handle: b.handle,
            displayName: b.displayName ?? b.handle,
          })
          .returning();
        return created!;
      });

      // agent 的 actor.id 用 handle (与消息 sender_id / 任务 assignee_id 一致)
      const token = await mintCredential(p.workspaceId, "agent", {
        type: "agent",
        id: b.handle,
      });

      // 把 agent 运行时配置一并下发,daemon 据此设置启动参数/env
      return ok({
        workspaceId: p.workspaceId, agentId: row.id, handle: b.handle, token,
        config: {
          runtime: row.runtime, model: row.model,
          provider: row.provider, providerBaseUrl: row.providerBaseUrl, providerApiKey: row.providerApiKey,
          reasoning: row.reasoning, fastMode: row.fastMode,
        },
      });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });
}
