/**
 * 鉴权:从 Authorization: Bearer <token> 解析出 Principal,挂到 request.principal。
 * 以及按层级授权的 preHandler 工厂 requireTier(...)。
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Principal } from "../auth/service.js";
import type { CredentialTier } from "../auth/credentials.js";
import { err } from "./envelope.js";

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
  }
}

export type TokenResolver = (token: string) => Promise<Principal | null>;

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim() || null;
}

/** 生成 authenticate preHandler;解析失败 401。 */
export function makeAuthenticate(resolve: TokenResolver): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = bearer(req);
    if (!token) {
      return reply.code(401).send(err("UNAUTHENTICATED", "missing bearer token"));
    }
    const principal = await resolve(token);
    if (!principal) {
      return reply.code(401).send(err("UNAUTHENTICATED", "invalid or revoked token"));
    }
    req.principal = principal;
  };
}

/** 要求调用者属于指定层级之一,否则 403。需在 authenticate 之后运行。 */
export function requireTier(...tiers: CredentialTier[]): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const p = req.principal;
    if (!p || !tiers.includes(p.tier)) {
      return reply
        .code(403)
        .send(err("FORBIDDEN", `requires credential tier: ${tiers.join("|")}`));
    }
  };
}

/** 取已鉴权的 principal (路由内确信已通过 authenticate)。 */
export function principalOf(req: FastifyRequest): Principal {
  if (!req.principal) throw new Error("principalOf called before authenticate");
  return req.principal;
}
