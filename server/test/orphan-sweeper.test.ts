import { describe, it, expect, vi } from "vitest";
import { OrphanSweeper, type OrphanSweeperDeps } from "../src/services/orphan-sweeper.js";
import type { TaskRow } from "../src/repo/types.js";

const WS = "ws1";

function orphan(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "t1", workspaceId: WS, channelId: "c1", number: 7, title: "修登录",
    messageId: "m1", parentTaskId: null, assignee: null, createdBy: { type: "human", id: "alice" },
    status: "todo", anchoredOnSystemMessage: false, ...over,
  };
}

function makeDeps(triageReturns: boolean) {
  const orphans = [{ workspaceId: WS, task: orphan() }];
  const triage = vi.fn(async () => triageReturns);
  const appended: Array<{ content: string }> = [];
  const emitted: unknown[] = [];
  const deps = {
    tasks: { staleOrphansAcrossWorkspaces: async () => orphans },
    agents: {
      list: async () => [
        { handle: "cindy", displayName: "Cindy", description: "总管" },
        { handle: "dave", displayName: "Dave", description: "开发" },
      ],
    },
    messages: {
      append: async (_ws: string, m: { content: string }) => {
        const row = { id: "sys1", seq: 1, ...m };
        appended.push(row);
        return row;
      },
    },
    triage,
    emit: (_ws: string, e: unknown) => { emitted.push(e); },
    triageThresholdMs: 1000,
    humanThresholdMs: 5000,
  } as unknown as OrphanSweeperDeps;
  return { deps, triage, appended, emitted };
}

describe("OrphanSweeper (防漏兜底巡检)", () => {
  it("超时无主任务 → 触发 Cindy 分诊;成功则不打扰人类,且不重复分诊", async () => {
    const { deps, triage, appended } = makeDeps(true);
    const sw = new OrphanSweeper({ ...deps, now: () => new Date(10_000) });
    expect(await sw.tick()).toBe(1);
    expect(triage).toHaveBeenCalledTimes(1);
    expect(appended).toHaveLength(0);
    // 同一任务第二轮不再重复分诊
    expect(await sw.tick()).toBe(0);
    expect(triage).toHaveBeenCalledTimes(1);
  });

  it("没有总管 / 派发失败 → 直接升级给人类(发 system 消息并广播)", async () => {
    const { deps, triage, appended, emitted } = makeDeps(false);
    const sw = new OrphanSweeper({ ...deps, now: () => new Date(10_000) });
    expect(await sw.tick()).toBe(1);
    expect(triage).toHaveBeenCalledTimes(1);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.content).toContain("无人认领");
    expect(emitted).toHaveLength(1);
  });

  it("分诊后仍长时间无人认领 → 升级给人类(只升一次)", async () => {
    const { deps, appended } = makeDeps(true);
    let now = 10_000;
    const sw = new OrphanSweeper({ ...deps, now: () => new Date(now) });
    await sw.tick();                  // 首轮:分诊给 Cindy
    expect(appended).toHaveLength(0);
    now += 6000;                      // 超过 humanThresholdMs(5000)仍是孤儿
    expect(await sw.tick()).toBe(1);
    expect(appended).toHaveLength(1);
    now += 2000;                      // 已升级人类 → 不再重复
    expect(await sw.tick()).toBe(0);
    expect(appended).toHaveLength(1);
  });
});
