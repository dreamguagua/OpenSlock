/**
 * 开发用最小可视化仪表盘 (M4 预览版,非正式前端)。
 * - GET /            → 单页 HTML (无需鉴权,页面内自行填 token)
 * - GET /api/snapshot → 需 user 凭证,返回当前 workspace 的频道/消息/任务快照
 *
 * 快照直接读 DB (生产 server 才注册此路由,故可用 getDb/withTenant)。
 */

import type { FastifyInstance } from "fastify";
import { asc } from "drizzle-orm";
import { withTenant } from "../../db/client.js";
import * as s from "../../db/schema.js";
import { ok, toHttpError } from "../envelope.js";
import { principalOf, requireTier } from "../auth.js";
import { DASHBOARD_HTML } from "./dashboard-html.js";

export async function registerDashboard(app: FastifyInstance): Promise<void> {
  app.get("/", async (_req, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return DASHBOARD_HTML;
  });

  app.get(
    "/api/snapshot",
    { preHandler: [app.authenticate, requireTier("user")] },
    async (req, reply) => {
      try {
        const p = principalOf(req);
        const snap = await withTenant(p.workspaceId, async (tx) => {
          const [channels, messages, tasks] = await Promise.all([
            tx.select().from(s.channel).orderBy(asc(s.channel.slug)),
            tx.select().from(s.message).orderBy(asc(s.message.channelId), asc(s.message.seq)),
            tx.select().from(s.task).orderBy(asc(s.task.number)),
          ]);
          return { channels, messages, tasks };
        });
        return ok({ workspaceId: p.workspaceId, ...snap });
      } catch (e) {
        const { status, body } = toHttpError(e);
        return reply.code(status).send(body);
      }
    },
  );
}
