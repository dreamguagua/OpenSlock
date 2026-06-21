/**
 * 提醒的纯调度逻辑:相对时长解析 + 下次触发时间计算。
 * 时间一律以显式 `now` 传入 (可测、不在此处读系统时钟)。
 */

import cronParser from "cron-parser";
import { DomainError } from "./errors.js";

/** 解析相对时长,如 "5m" / "2h" / "1d" / "30s" → 毫秒。 */
export function parseDuration(input: string): number {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(input.trim());
  if (!m) {
    throw new DomainError("VALIDATION", `invalid duration: ${input} (use 30s/5m/2h/1d)`);
  }
  const n = Number(m[1]);
  const unit = m[2] as "s" | "m" | "h" | "d";
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * ms;
}

export interface ScheduleInput {
  readonly at?: string | undefined; // 绝对 ISO 时间 (once)
  readonly in?: string | undefined; // 相对时长 (once)
  readonly cron?: string | undefined; // 周期 (recurring)
  readonly timezone?: string | undefined;
}

export type ResolvedSchedule =
  | { readonly kind: "once"; readonly fireAt: Date; readonly nextFireAt: Date }
  | {
      readonly kind: "recurring";
      readonly cron: string;
      readonly timezone: string;
      readonly nextFireAt: Date;
    };

const DEFAULT_TZ = "Asia/Shanghai";

/** 计算 cron 在 after 之后的下一次触发时间。 */
export function nextCronFire(cron: string, timezone: string, after: Date): Date {
  try {
    const it = cronParser.parseExpression(cron, { currentDate: after, tz: timezone });
    return it.next().toDate();
  } catch {
    throw new DomainError("VALIDATION", `invalid cron: ${cron}`);
  }
}

/** 把用户输入的调度方式解析成落库所需的 kind + nextFireAt。 */
export function resolveSchedule(input: ScheduleInput, now: Date): ResolvedSchedule {
  const tz = input.timezone ?? DEFAULT_TZ;
  const provided = [input.at, input.in, input.cron].filter(Boolean).length;
  if (provided !== 1) {
    throw new DomainError("VALIDATION", "must provide exactly one of --at / --in / --cron");
  }

  if (input.cron) {
    const nextFireAt = nextCronFire(input.cron, tz, now);
    return { kind: "recurring", cron: input.cron, timezone: tz, nextFireAt };
  }

  let fireAt: Date;
  if (input.in) {
    fireAt = new Date(now.getTime() + parseDuration(input.in));
  } else {
    fireAt = new Date(input.at!);
    if (Number.isNaN(fireAt.getTime())) {
      throw new DomainError("VALIDATION", `invalid --at time: ${input.at}`);
    }
  }
  return { kind: "once", fireAt, nextFireAt: fireAt };
}
