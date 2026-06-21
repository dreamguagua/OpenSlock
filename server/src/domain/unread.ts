/**
 * 未读计算与 read-state 游标 (纯逻辑)。
 *
 * 每个成员对每个频道维护 `last_read_seq`。未读数 = 频道最新 seq 与已读游标之差。
 * 游标只增不减 (单调)。这些都是不可变计算。
 */

export interface ChannelReadState {
  readonly lastReadSeq: number;
  readonly latestSeq: number;
}

/** 某频道的未读条数。 */
export function unreadCount(state: ChannelReadState): number {
  return Math.max(0, state.latestSeq - state.lastReadSeq);
}

/** 推进已读游标 (单调),返回新游标值。 */
export function advanceReadCursor(lastReadSeq: number, readUpToSeq: number): number {
  return Math.max(lastReadSeq, readUpToSeq);
}

/** 离线积压汇总:每个频道的未读 (>0 才纳入),供 unreadSummary 注入。 */
export interface ChannelUnread {
  readonly target: string;
  readonly unread: number;
}

export function summarizeUnread(
  channels: readonly { readonly target: string; readonly state: ChannelReadState }[],
): ChannelUnread[] {
  return channels
    .map((c) => ({ target: c.target, unread: unreadCount(c.state) }))
    .filter((c) => c.unread > 0);
}
