/**
 * 统一 API 响应信封 + DomainError → HTTP 状态码映射。
 */

import { ZodError } from "zod";
import { isDomainError, type DomainErrorCode } from "../domain/errors.js";

export interface ApiOk<T> {
  readonly success: true;
  readonly data: T;
}
export interface ApiErr {
  readonly success: false;
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
}
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export const ok = <T>(data: T): ApiOk<T> => ({ success: true, data });
export const err = (code: string, message: string, details?: unknown): ApiErr => ({
  success: false,
  error: details === undefined ? { code, message } : { code, message, details },
});

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  FRESHNESS_HOLD: 409,
  CLAIM_CONFLICT: 409,
  NOT_CLAIMABLE: 422,
  CONFLICT: 409,
};

/** 把任意错误转成 (httpStatus, ApiErr)。 */
export function toHttpError(e: unknown): { status: number; body: ApiErr } {
  if (e instanceof ZodError) {
    return { status: 400, body: err("VALIDATION", "invalid request", e.issues) };
  }
  if (isDomainError(e)) {
    return {
      status: STATUS_BY_CODE[e.code] ?? 400,
      body: err(e.code, e.message, Object.keys(e.details).length ? e.details : undefined),
    };
  }
  // 未预期错误:不泄露内部细节
  return { status: 500, body: err("INTERNAL", "internal server error") };
}
