/**
 * 租户上下文传播 —— Node 多租户的核心机制。
 *
 * 在请求入口 (HTTP / WS / CLI 鉴权后) 解析出 `workspaceId` 与 `actor`,存入
 * AsyncLocalStorage;下游任意代码无需层层透传即可拿到当前租户与调用者,从根上杜绝
 * "忘记按 workspace 过滤"。生产中 PG RLS 再做一层 DB 级兜底 (SET LOCAL app.current_workspace)。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "../domain/actor.js";
import { DomainError } from "../domain/errors.js";

export interface RequestContext {
  readonly workspaceId: string;
  readonly actor: Actor;
}

const als = new AsyncLocalStorage<RequestContext>();

/** 在给定租户上下文内运行 fn。 */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  if (!ctx.workspaceId) {
    throw new DomainError("VALIDATION", "request context requires workspaceId");
  }
  return als.run(ctx, fn);
}

/** 取当前上下文;不在上下文内调用是编程错误 (而非用户错误)。 */
export function currentContext(): RequestContext {
  const ctx = als.getStore();
  if (!ctx) {
    throw new DomainError("FORBIDDEN", "no tenant context bound to this call");
  }
  return ctx;
}

/** 便捷取当前 workspaceId。 */
export function currentWorkspaceId(): string {
  return currentContext().workspaceId;
}

/** 便捷取当前 actor。 */
export function currentActor(): Actor {
  return currentContext().actor;
}
