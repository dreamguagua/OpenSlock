/**
 * 操作卡服务 (raft action prepare)。
 *
 * agent 没有(也不该有)直接建频道/建 agent 的权限,但可以「备好」一个动作卡;
 * 人类在 UI 上点击执行 → 以**人类自己的身份**真正执行该动作。
 * 执行幂等:仓储 resolve 仅在 pending 时生效,杜绝重复执行。
 */

import { z } from "zod";
import { DomainError } from "../domain/errors.js";
import type { Actor } from "../domain/actor.js";
import type { ActionCardRepo, ActionCardRow } from "../repo/types.js";

export const ACTION_KINDS = ["channel:create", "agent:create"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

const ChannelCreatePayload = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  isPrivate: z.boolean().optional(),
});
const AgentCreatePayload = z.object({
  handle: z.string().trim().min(2).max(31),
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(3000).optional(),
});

/** 执行动作时回调到现有的「以人类身份建资源」服务。 */
export interface ActionExecutors {
  createChannel(ws: string, input: { name: string; description?: string; isPrivate?: boolean }, human: Actor): Promise<{ slug: string }>;
  createAgent(ws: string, input: { handle: string; displayName: string; description?: string }): Promise<{ handle: string }>;
}

export class ActionService {
  constructor(
    private readonly repo: ActionCardRepo,
    private readonly exec: ActionExecutors,
  ) {}

  /** agent 备好一个操作卡。校验 kind + payload 形状。 */
  async prepare(
    ws: string,
    preparedBy: Actor,
    kind: string,
    payload: unknown,
    channelId?: string | null,
  ): Promise<ActionCardRow> {
    if (!(ACTION_KINDS as readonly string[]).includes(kind)) {
      throw new DomainError("VALIDATION", `unknown action kind: ${kind}`, { kind });
    }
    const clean = this.validatePayload(kind as ActionKind, payload);
    return this.repo.create(ws, { kind, payload: clean, preparedBy, ...(channelId ? { channelId } : {}) });
  }

  list(ws: string): Promise<ActionCardRow[]> {
    return this.repo.listPending(ws);
  }

  /** 人类执行:跑实际动作(以人类身份)→ 标记 executed。重复/竞态 → CONFLICT。 */
  async execute(ws: string, human: Actor, id: string): Promise<ActionCardRow> {
    const card = await this.repo.get(ws, id);
    if (!card) throw new DomainError("NOT_FOUND", `action not found: ${id}`, { id });
    if (card.status !== "pending") throw new DomainError("CONFLICT", `action already ${card.status}`, { id });

    let resultRef: string;
    if (card.kind === "channel:create") {
      const p = this.validatePayload("channel:create", card.payload);
      const ch = await this.exec.createChannel(ws, p, human);
      resultRef = ch.slug;
    } else if (card.kind === "agent:create") {
      const p = this.validatePayload("agent:create", card.payload);
      const a = await this.exec.createAgent(ws, p);
      resultRef = a.handle;
    } else {
      throw new DomainError("VALIDATION", `unknown action kind: ${card.kind}`, { id });
    }

    const resolved = await this.repo.resolve(ws, id, "executed", human, resultRef);
    if (!resolved) throw new DomainError("CONFLICT", "action was already resolved", { id });
    return resolved;
  }

  /** 人类忽略/驳回一个待办动作卡。 */
  async dismiss(ws: string, human: Actor, id: string): Promise<ActionCardRow> {
    const resolved = await this.repo.resolve(ws, id, "dismissed", human);
    if (!resolved) throw new DomainError("CONFLICT", "action not pending (already resolved or missing)", { id });
    return resolved;
  }

  private validatePayload(kind: ActionKind, payload: unknown): any {
    try {
      return kind === "channel:create" ? ChannelCreatePayload.parse(payload) : AgentCreatePayload.parse(payload);
    } catch {
      throw new DomainError("VALIDATION", `invalid payload for ${kind}`, { kind });
    }
  }
}
