/** 登录路由(公开,无需鉴权):邮箱密码 → sk_user_* 令牌。 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  loginWithPassword,
  revokeToken,
  registerAccount,
  createAccountOnly,
  createWorkspaceForAccount,
  previewInvite,
  acceptInviteWithPassword,
} from "../../auth/service.js";
import type { OAuthService } from "../../auth/oauth.js";
import { ok, err, toHttpError } from "../envelope.js";

const LoginBody = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
});
const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
  workspaceName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(80).optional(),
});
// 第一步:仅建全局账号 (raft Create Account:Name/Email/Password)
const RegisterAccountBody = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});
// 第二步之一:为账号开新工作区 (需重新带上邮箱密码核验)
const CreateWorkspaceBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  workspaceName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(80).optional(),
});
// 第二步之二:邮箱密码接受邀请入区
const AcceptInviteBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  displayName: z.string().trim().min(1).max(80).optional(),
});

export async function registerAuthRoutes(app: FastifyInstance, oauth?: OAuthService): Promise<void> {
  app.post("/api/auth/login", async (req, reply) => {
    try {
      const b = LoginBody.parse(req.body);
      const r = await loginWithPassword(b.email, b.password);
      if (!r) return reply.code(401).send(err("UNAUTHENTICATED", "Incorrect email or password"));
      return ok(r);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 注册:开通新工作区 + owner 账号 → 直接返回登录令牌 (一步;兼容旧客户端/测试)
  app.post("/api/auth/register", async (req, reply) => {
    try {
      const b = RegisterBody.parse(req.body);
      const r = await registerAccount(b);
      return reply.code(201).send(ok(r));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 第一步:仅建全局账号 (Create Account)。不创建工作区、不返回令牌。
  app.post("/api/auth/register-account", async (req, reply) => {
    try {
      const b = RegisterAccountBody.parse(req.body);
      const r = await createAccountOnly(b);
      return reply.code(201).send(ok(r));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 第二步之一:为账号新建工作区 (核验邮箱密码) → 返回令牌
  app.post("/api/auth/create-workspace", async (req, reply) => {
    try {
      const b = CreateWorkspaceBody.parse(req.body);
      const r = await createWorkspaceForAccount(b.email, b.password, {
        workspaceName: b.workspaceName,
        displayName: b.displayName,
      });
      if (!r) return reply.code(401).send(err("UNAUTHENTICATED", "Incorrect email or password"));
      return reply.code(201).send(ok(r));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 邀请预览 (Join 页;公开):工作区名 + 人数/agent 数。无效 → 404。
  app.get("/api/invites/:token", async (req, reply) => {
    try {
      const { token } = req.params as { token: string };
      const preview = await previewInvite(token);
      if (!preview) return reply.code(404).send(err("NOT_FOUND", "invite link is invalid or expired"));
      return ok(preview);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 接受邀请入区 (公开;邮箱密码核验已有账号) → 返回该工作区令牌
  app.post("/api/invites/:token/accept", async (req, reply) => {
    try {
      const { token } = req.params as { token: string };
      const b = AcceptInviteBody.parse(req.body);
      const r = await acceptInviteWithPassword(token, b.email, b.password, b.displayName);
      if (!r) return reply.code(401).send(err("UNAUTHENTICATED", "Incorrect email or password"));
      return reply.code(201).send(ok(r));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // OAuth:列出可用 provider / 取授权 URL / 回调换 token(provider 无关,可注入)
  app.get("/api/auth/oauth/providers", async () => ok({ providers: oauth?.available() ?? [] }));

  app.get("/api/auth/oauth/:provider/start", async (req, reply) => {
    try {
      if (!oauth) return reply.code(404).send(err("NOT_FOUND", "oauth not configured"));
      const { provider } = req.params as { provider: string };
      const q = z.object({ redirectUri: z.string().url() }).parse(req.query);
      return ok(oauth.start(provider, q.redirectUri));
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  app.get("/api/auth/oauth/:provider/callback", async (req, reply) => {
    try {
      if (!oauth) return reply.code(404).send(err("NOT_FOUND", "oauth not configured"));
      const { provider } = req.params as { provider: string };
      const q = z.object({ code: z.string().min(1), state: z.string().min(1), redirectUri: z.string().url() }).parse(req.query);
      const result = await oauth.callback(provider, q.code, q.state, q.redirectUri);
      return ok(result);
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });

  // 登出 = 吊销当前 token(置 revoked_at,之后 resolveToken 拒绝)。幂等。
  app.post("/api/auth/logout", async (req, reply) => {
    try {
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const revoked = await revokeToken(token);
      return ok({ revoked });
    } catch (e) {
      const { status, body } = toHttpError(e);
      return reply.code(status).send(body);
    }
  });
}
