import { describe, it, expect } from "vitest";
import {
  decideStatusUpdate,
  decideUnclaim,
  isTaskStatus,
} from "../src/domain/task-ops.js";
import type { Actor } from "../src/domain/actor.js";

const me: Actor = { type: "agent", id: "a" };
const other: Actor = { type: "agent", id: "b" };
const human: Actor = { type: "human", id: "u1" };

describe("isTaskStatus", () => {
  it("识别合法状态", () => {
    expect(isTaskStatus("in_review")).toBe(true);
    expect(isTaskStatus("nope")).toBe(false);
  });
});

describe("decideStatusUpdate", () => {
  it("assignee 推进到合法状态 → ok", () => {
    expect(decideStatusUpdate({ assignee: me, status: "in_progress" }, me, "in_review"))
      .toEqual({ kind: "ok", status: "in_review" });
  });
  it("非法目标状态 → invalid", () => {
    expect(decideStatusUpdate({ assignee: me, status: "todo" }, me, "wat").kind).toBe("invalid");
  });
  it("done 可被重新打开(assignee 把 done → in_review)", () => {
    expect(decideStatusUpdate({ assignee: me, status: "done" }, me, "in_review"))
      .toEqual({ kind: "ok", status: "in_review" });
  });
  it("agent 改别人/无主的任务 → forbidden", () => {
    expect(decideStatusUpdate({ assignee: other, status: "in_progress" }, me, "done").kind).toBe("forbidden");
    expect(decideStatusUpdate({ assignee: null, status: "todo" }, me, "in_progress").kind).toBe("forbidden");
  });
  it("人类可改任意任务状态(非 assignee / 无主 / 重开 done / closed 也行)", () => {
    expect(decideStatusUpdate({ assignee: other, status: "in_review" }, human, "done"))
      .toEqual({ kind: "ok", status: "done" });
    expect(decideStatusUpdate({ assignee: null, status: "todo" }, human, "in_progress"))
      .toEqual({ kind: "ok", status: "in_progress" });
    expect(decideStatusUpdate({ assignee: other, status: "done" }, human, "in_review"))
      .toEqual({ kind: "ok", status: "in_review" });
  });
});

describe("decideUnclaim", () => {
  it("assignee 释放 in_progress → 回退 todo", () => {
    expect(decideUnclaim({ assignee: me, status: "in_progress" }, me))
      .toEqual({ kind: "ok", status: "todo" });
  });
  it("assignee 释放 in_review → 保持状态", () => {
    expect(decideUnclaim({ assignee: me, status: "in_review" }, me))
      .toEqual({ kind: "ok", status: "in_review" });
  });
  it("未认领 → not_claimed", () => {
    expect(decideUnclaim({ assignee: null, status: "todo" }, me).kind).toBe("not_claimed");
  });
  it("别人的任务 → forbidden", () => {
    expect(decideUnclaim({ assignee: other, status: "in_progress" }, me).kind).toBe("forbidden");
  });
});
