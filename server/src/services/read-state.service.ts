/**
 * ReadStateService —— 已读游标与未读计算。
 *
 * 成员读到某 seq 时,推进其 last_read_seq;若成员是 agent,同时推进其 freshness
 * seen 游标 (因为"读过"即意味着模型已见到这些消息,后续 send/claim 不应再被 hold)。
 */

import type { Actor } from "../domain/actor.js";
import { unreadCount } from "../domain/unread.js";
import { DomainError } from "../domain/errors.js";
import type {
  MessageRepo,
  ReadStateRepo,
  SeenCursorRepo,
} from "../repo/types.js";

export class ReadStateService {
  constructor(
    private readonly readState: ReadStateRepo,
    private readonly seen: SeenCursorRepo,
    private readonly messages: MessageRepo,
  ) {}

  /** 标记某成员在某频道已读到 upToSeq;agent 同步推进 seen 游标。返回新已读游标。 */
  async markRead(
    workspaceId: string,
    member: Actor,
    channelId: string,
    upToSeq: number,
  ): Promise<number> {
    if (!Number.isInteger(upToSeq) || upToSeq < 0) {
      throw new DomainError("VALIDATION", "upToSeq must be a non-negative integer", {
        upToSeq,
      });
    }
    const newRead = await this.readState.advance(
      workspaceId,
      member,
      channelId,
      upToSeq,
    );
    if (member.type === "agent") {
      await this.seen.advance(workspaceId, member.id, channelId, upToSeq);
    }
    return newRead;
  }

  /** 某成员在某频道的未读条数。 */
  async unread(
    workspaceId: string,
    member: Actor,
    channelId: string,
  ): Promise<number> {
    const [lastReadSeq, latestSeq] = await Promise.all([
      this.readState.get(workspaceId, member, channelId),
      this.messages.latestSeq(workspaceId, channelId),
    ]);
    return unreadCount({ lastReadSeq, latestSeq });
  }
}
