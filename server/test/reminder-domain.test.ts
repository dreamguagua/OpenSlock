import { describe, it, expect } from "vitest";
import { parseDuration, resolveSchedule, nextCronFire } from "../src/domain/reminder.js";

const NOW = new Date("2026-06-19T00:00:00.000Z");

describe("parseDuration", () => {
  it("解析 s/m/h/d", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("1d")).toBe(86_400_000);
  });
  it("非法时长抛错", () => {
    expect(() => parseDuration("soon")).toThrow();
    expect(() => parseDuration("5x")).toThrow();
  });
});

describe("resolveSchedule", () => {
  it("--in 相对时长 → once,fireAt = now + dur", () => {
    const r = resolveSchedule({ in: "5m" }, NOW);
    expect(r.kind).toBe("once");
    if (r.kind === "once") expect(r.fireAt.getTime()).toBe(NOW.getTime() + 300_000);
  });
  it("--at 绝对时间 → once", () => {
    const r = resolveSchedule({ at: "2026-06-20T09:00:00.000Z" }, NOW);
    expect(r.kind).toBe("once");
    expect(r.nextFireAt.toISOString()).toBe("2026-06-20T09:00:00.000Z");
  });
  it("--cron → recurring,nextFireAt 在 now 之后", () => {
    const r = resolveSchedule({ cron: "0 9 * * 1", timezone: "UTC" }, NOW); // 每周一 9:00
    expect(r.kind).toBe("recurring");
    expect(r.nextFireAt.getTime()).toBeGreaterThan(NOW.getTime());
  });
  it("必须且仅提供一种调度方式", () => {
    expect(() => resolveSchedule({}, NOW)).toThrow();
    expect(() => resolveSchedule({ in: "5m", cron: "* * * * *" }, NOW)).toThrow();
  });
  it("非法 cron / at 抛错", () => {
    expect(() => resolveSchedule({ cron: "not a cron" }, NOW)).toThrow();
    expect(() => resolveSchedule({ at: "nonsense" }, NOW)).toThrow();
  });
});

describe("nextCronFire", () => {
  it("每 5 分钟:下一次在 5 分钟内", () => {
    const next = nextCronFire("*/5 * * * *", "UTC", NOW);
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
    expect(next.getTime()).toBeLessThanOrEqual(NOW.getTime() + 300_000);
  });
});
