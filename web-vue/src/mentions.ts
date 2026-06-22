/** @mention 自动补全的纯逻辑(无 React/DOM 依赖,便于复用与单测)。
 *  职责:在光标处识别正在输入的 @token、按 query 过滤成员、把选中成员插回文本。 */

import type { Member } from "./types.js";

/** 允许出现在 handle 里的字符(与 MessageText 的 mention 正则保持一致)。 */
const HANDLE_CHAR = /[A-Za-z0-9_一-龥-]/;

export interface MentionQuery {
  /** @ 符号在文本中的下标 */
  start: number;
  /** @ 之后、光标之前的查询串(可能为空) */
  query: string;
}

/**
 * 从光标位置向前查找一个「正在输入中的 @token」。
 * 规则:@ 必须位于文本开头或紧跟空白;@ 与光标之间不得含空白或非法 handle 字符。
 * 命中返回 {start, query},否则返回 null(不弹菜单)。
 */
export function findMentionQuery(text: string, cursor: number): MentionQuery | null {
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text.charAt(i);
    if (ch === "@") {
      const prev = text.charAt(i - 1); // i===0 时为 ""
      // 仅当 @ 处于词首(开头或前面是空白)才视为 mention 触发
      if (i === 0 || /\s/.test(prev)) {
        return { start: i, query: text.slice(i + 1, cursor) };
      }
      return null;
    }
    // 遇到空白或非法字符,说明光标不在某个 @token 内
    if (/\s/.test(ch) || !HANDLE_CHAR.test(ch)) return null;
  }
  return null;
}

/** 按 query 过滤成员:handle 或 displayName 包含 query(忽略大小写);query 为空则全列。 */
export function filterMembers(members: Member[], query: string): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return members;
  return members.filter(
    (m) => m.handle.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q),
  );
}

/** 把选中的 handle 插回文本:用 `@handle ` 替换 [start, cursor) 区间,返回新文本与新光标位置。 */
export function applyMention(
  text: string,
  start: number,
  cursor: number,
  handle: string,
): { text: string; cursor: number } {
  const before = text.slice(0, start);
  const after = text.slice(cursor);
  const insert = `@${handle} `;
  return { text: before + insert + after, cursor: before.length + insert.length };
}
