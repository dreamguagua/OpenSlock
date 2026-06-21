/**
 * 收藏消息服务 (raft Saved) —— 每个成员书签自己的消息。
 *
 * 收藏是私有的(只对本人可见),仓储层用唯一约束保证幂等;此处校验消息存在。
 */

import { DomainError } from "../domain/errors.js";
import type { Actor } from "../domain/actor.js";
import type { MessageRepo, MessageRow, SavedRepo } from "../repo/types.js";

export class SavedService {
  constructor(
    private readonly repo: SavedRepo,
    private readonly messages: MessageRepo,
  ) {}

  async save(ws: string, actor: Actor, messageId: string): Promise<void> {
    const msg = await this.messages.get(ws, messageId);
    if (!msg) throw new DomainError("NOT_FOUND", `message not found: ${messageId}`, { messageId });
    await this.repo.add(ws, actor, messageId);
  }

  async unsave(ws: string, actor: Actor, messageId: string): Promise<void> {
    await this.repo.remove(ws, actor, messageId);
  }

  list(ws: string, actor: Actor): Promise<MessageRow[]> {
    return this.repo.listForActor(ws, actor);
  }

  savedSet(ws: string, actor: Actor, messageIds: readonly string[]): Promise<Set<string>> {
    return this.repo.savedSet(ws, actor, messageIds);
  }
}
