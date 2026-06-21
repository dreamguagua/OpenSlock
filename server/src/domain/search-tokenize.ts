/**
 * 中文全文检索分词 —— pg_jieba 扩展本机不可装,改用等效的「CJK 二元分词 + token 数组包含」:
 *   - CJK 连续段 → 重叠二元组(bigram):"产品专家" → 产品/品专/专家(单字段保留单字)
 *   - ascii 连续段 → 整词(小写)
 * 文档与查询用同一套分词;匹配 = 文档 token 集 ⊇ 查询 token 集(全部命中)。
 * 这样:连续短语可命中(且可走 GIN 索引),空格分隔的多关键词可**乱序命中**。
 */

// CJK 统一表意 (U+3400–U+9FFF) + 兼容表意 (U+F900–U+FAFF) + 假名 (U+3040–U+30FF)
const TOKEN_RE = /[㐀-鿿豈-﫿぀-ヿ]+|[a-z0-9]+/g;

export function cjkTokens(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(lower)) !== null) {
    const tok = m[0]!;
    if (/^[a-z0-9]/.test(tok)) {
      out.push(tok); // ascii 整词
    } else if (tok.length === 1) {
      out.push(tok); // 单个 CJK 字
    } else {
      for (let i = 0; i < tok.length - 1; i++) out.push(tok.slice(i, i + 2)); // 重叠 bigram
    }
  }
  return out;
}

/** 去重后的 token(存储用)。 */
export function uniqueTokens(text: string): string[] {
  return [...new Set(cjkTokens(text))];
}

/** 文档 token 集是否包含查询的全部 token。 */
export function tokensMatch(docTokens: ReadonlySet<string>, query: string): boolean {
  const q = cjkTokens(query);
  if (q.length === 0) return false;
  return q.every((t) => docTokens.has(t));
}
