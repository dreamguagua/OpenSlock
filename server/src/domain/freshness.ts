/**
 * Freshness hold —— OpenSlock 区别于普通聊天的关键机制。
 *
 * 任何会产生 side effect 的操作 (message send / task claim),若操作目标在 agent
 * 的模型"上次看过之后"出现了它没见过的新消息,server 必须先**阻断**该操作并回灌
 * 最新上下文,逼 agent 重新对齐后再行动;被阻断的 send 落为 **draft**。
 *
 * 这里是**纯判定逻辑**:给定模型已见游标与频道当前最新序号,决定 pass / hold。
 * 游标的推进 (read/check/wake 时前移) 与 draft 的持久化由 service + repo 负责。
 *
 * 设计:用 `modelSeenSeq` 双游标实现 freshness hold —— agent 发言前必须追平未读。
 */

export interface FreshnessInput {
  /** 该 agent 的模型在目标频道里"已经看过"的最大消息 seq。 */
  readonly modelSeenSeq: number;
  /** 目标频道当前的最大消息 seq。 */
  readonly latestSeq: number;
  /** agent 显式确认要无视 hold (对应 CLI `--send-draft` / 复核后重试)。 */
  readonly force?: boolean;
}

export type FreshnessDecision =
  | { readonly kind: "pass" }
  | {
      readonly kind: "hold";
      /** 模型未见过的新消息条数。 */
      readonly unseenCount: number;
      /** 未见区间 (开区间起点, 即 modelSeenSeq) 之后的第一条。 */
      readonly fromSeq: number;
      readonly toSeq: number;
    };

export function decideFreshness(input: FreshnessInput): FreshnessDecision {
  const { modelSeenSeq, latestSeq, force = false } = input;

  if (modelSeenSeq < 0 || latestSeq < 0) {
    throw new RangeError("seq cursors must be non-negative");
  }

  const unseenCount = Math.max(0, latestSeq - modelSeenSeq);

  if (force || unseenCount === 0) {
    return { kind: "pass" };
  }

  return {
    kind: "hold",
    unseenCount,
    fromSeq: modelSeenSeq + 1,
    toSeq: latestSeq,
  };
}

/** 游标单调前移:看过更新的消息只会推进、不会回退。返回新值 (不可变)。 */
export function advanceSeenCursor(current: number, seenSeq: number): number {
  return Math.max(current, seenSeq);
}
