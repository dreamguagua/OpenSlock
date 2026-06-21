/**
 * 退出码约定 —— agent 在 Bash 里据此决定下一步 (尤其 claim 失败要停手)。
 */

export const EXIT = {
  OK: 0,
  GENERIC: 1, // 传输/未知错误
  USAGE: 2, // 参数错误
  AUTH: 3, // 401/403
  CONFLICT: 4, // claim 被占 / 不可领 —— agent 应停手,不要重试
  NOT_FOUND: 5, // 目标不存在
  FRESHNESS: 6, // freshness hold —— agent 应先重读再重试
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** 把服务端错误码/HTTP 状态映射为退出码。 */
export function exitForError(httpStatus: number, code?: string): ExitCode {
  if (code === "FRESHNESS_HOLD") return EXIT.FRESHNESS;
  if (code === "CLAIM_CONFLICT" || code === "NOT_CLAIMABLE") return EXIT.CONFLICT;
  if (httpStatus === 401 || httpStatus === 403) return EXIT.AUTH;
  if (httpStatus === 404) return EXIT.NOT_FOUND;
  if (httpStatus === 400 || httpStatus === 422) return EXIT.USAGE;
  return EXIT.GENERIC;
}
