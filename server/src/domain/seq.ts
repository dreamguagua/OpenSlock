/**
 * 每-channel 单调消息序号 (seq) 的纯辅助逻辑。
 *
 * 生产环境的"分配"必须在 DB 层原子完成 (行锁 / advisory lock,见 repo/pg),
 * 绝不能在 Node 内存里自增 —— 否则多实例并发会产生重复或空洞。这里只放与序号
 * 相关的**纯计算**:下一个序号、连续性校验、空洞检测 (供重连补偿与测试使用)。
 */

/** 给定当前频道最大 seq,返回下一个 seq。约定 seq 从 1 开始,0 表示"空频道"。 */
export function nextSeq(maxSeq: number): number {
  if (!Number.isInteger(maxSeq) || maxSeq < 0) {
    throw new RangeError(`maxSeq must be a non-negative integer, got ${maxSeq}`);
  }
  return maxSeq + 1;
}

/** 一组已排序 seq 是否严格连续 (无重复、无空洞)。 */
export function isContiguous(seqs: readonly number[]): boolean {
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i]! !== seqs[i - 1]! + 1) return false;
  }
  return true;
}

/**
 * 找出 [fromSeq+1, toSeq] 区间内缺失的 seq —— 客户端基于 last-seen seq 做重连补偿时,
 * 用来请求增量。返回升序的缺失列表。
 */
export function findGaps(
  present: readonly number[],
  fromSeq: number,
  toSeq: number,
): number[] {
  const have = new Set(present);
  const gaps: number[] = [];
  for (let s = fromSeq + 1; s <= toSeq; s++) {
    if (!have.has(s)) gaps.push(s);
  }
  return gaps;
}
