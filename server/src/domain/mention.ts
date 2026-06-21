/**
 * @mention 解析 (纯逻辑)。从消息正文提取被 @ 的 handle,用于决定唤醒哪些 agent。
 * 支持中英文 handle: @alice / @Cindy / @产品专家。
 */

const MENTION_RE = /@([A-Za-z0-9_一-龥-]+)/g;

/** 提取正文中所有 @handle (去重、去掉 @ 前缀、保序)。 */
export function parseMentions(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(MENTION_RE)) {
    const handle = m[1]!;
    if (!seen.has(handle)) {
      seen.add(handle);
      out.push(handle);
    }
  }
  return out;
}

/** 在候选 agent handle 集合中,筛出正文里被 @ 到的 agent (大小写敏感,与 handle 一致)。 */
export function mentionedAgents(
  content: string,
  agentHandles: readonly string[],
): string[] {
  const set = new Set(agentHandles);
  return parseMentions(content).filter((h) => set.has(h));
}
