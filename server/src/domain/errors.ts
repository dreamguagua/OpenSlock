/**
 * 领域错误。每个错误带稳定的 `code`,供 HTTP 层映射状态码、CLI 层映射退出码、
 * 测试层精确断言。绝不裸抛字符串或吞错。
 */

export type DomainErrorCode =
  | "VALIDATION" // 输入不合法 (boundary validation 失败)
  | "NOT_FOUND" // 目标资源不存在
  | "FORBIDDEN" // 越权 (跨 workspace / 非本 agent 资源)
  | "FRESHNESS_HOLD" // 目标有 model 未见过的新消息,操作被阻断
  | "CLAIM_CONFLICT" // 任务已被他人 claim
  | "NOT_CLAIMABLE" // 目标 (如 system 消息) 不可成任务
  | "CONFLICT"; // 其它并发冲突

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DomainErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export const isDomainError = (e: unknown): e is DomainError =>
  e instanceof DomainError;
