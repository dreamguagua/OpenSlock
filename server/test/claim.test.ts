import { describe, it, expect } from "vitest";
import { decideClaim, type TaskState } from "../src/domain/claim.js";
import type { Actor } from "../src/domain/actor.js";

const agentA: Actor = { type: "agent", id: "a" };
const agentB: Actor = { type: "agent", id: "b" };

const base: TaskState = {
  assignee: null,
  status: "todo",
  anchoredOnSystemMessage: false,
};

describe("decideClaim", () => {
  it("claims an unassigned task and moves todo → in_progress", () => {
    expect(decideClaim(base, agentA)).toEqual({
      kind: "claimed",
      assignee: agentA,
      status: "in_progress",
    });
  });

  it("preserves a later status when claiming (does not regress)", () => {
    expect(decideClaim({ ...base, status: "in_review" }, agentA)).toEqual({
      kind: "claimed",
      assignee: agentA,
      status: "in_review",
    });
  });

  it("is idempotent when the claimant already holds it", () => {
    expect(decideClaim({ ...base, assignee: agentA }, agentA)).toEqual({
      kind: "already_mine",
    });
  });

  it("conflicts when another actor holds it (no stealing)", () => {
    expect(decideClaim({ ...base, assignee: agentB }, agentA)).toEqual({
      kind: "conflict",
      heldBy: agentB,
    });
  });

  it("refuses to claim a task anchored on a system message", () => {
    expect(
      decideClaim({ ...base, anchoredOnSystemMessage: true }, agentA),
    ).toEqual({ kind: "not_claimable" });
  });
});
