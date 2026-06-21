/**
 * 消息表情反应服务 (raft message react)。
 *
 * toggle 语义在仓储层用唯一约束保证幂等;此处只做输入校验 + 聚合。
 * 聚合输出按 emoji 首次出现顺序稳定排序,并标出 viewer 自己是否反应过 (mine)。
 */

import { DomainError } from "../domain/errors.js";
import type { Actor } from "../domain/actor.js";
import type { ReactionRepo } from "../repo/types.js";

export interface ReactionSummary {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean; // 调用方自己是否反应过
}

const EMOJI_MAX = 32;

export class ReactionService {
  constructor(private readonly repo: ReactionRepo) {}

  async add(ws: string, actor: Actor, messageId: string, emoji: string): Promise<void> {
    const e = emoji.trim();
    if (!e || e.length > EMOJI_MAX) throw new DomainError("VALIDATION", "invalid emoji", { emoji });
    await this.repo.add(ws, messageId, actor, e);
  }

  async remove(ws: string, actor: Actor, messageId: string, emoji: string): Promise<void> {
    const e = emoji.trim();
    if (!e) throw new DomainError("VALIDATION", "invalid emoji", { emoji });
    await this.repo.remove(ws, messageId, actor, e);
  }

  /** 聚合这批消息的反应:messageId → [{emoji,count,mine}](emoji 按首次出现顺序)。 */
  async summaryFor(
    ws: string,
    messageIds: readonly string[],
    viewer: Actor,
  ): Promise<Map<string, ReactionSummary[]>> {
    const out = new Map<string, ReactionSummary[]>();
    if (messageIds.length === 0) return out;
    const rows = await this.repo.listForMessages(ws, messageIds);

    const byMsg = new Map<string, Map<string, { count: number; mine: boolean }>>();
    for (const r of rows) {
      let emap = byMsg.get(r.messageId);
      if (!emap) { emap = new Map(); byMsg.set(r.messageId, emap); }
      const cur = emap.get(r.emoji) ?? { count: 0, mine: false };
      cur.count += 1;
      if (r.actorType === viewer.type && r.actorId === viewer.id) cur.mine = true;
      emap.set(r.emoji, cur);
    }
    for (const [mid, emap] of byMsg) {
      out.set(mid, [...emap.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })));
    }
    return out;
  }
}
