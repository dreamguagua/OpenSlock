import { describe, it, expect } from "vitest";
import { decideFreshness, advanceSeenCursor } from "../src/domain/freshness.js";

describe("decideFreshness", () => {
  it("passes when model has seen the latest message", () => {
    expect(decideFreshness({ modelSeenSeq: 10, latestSeq: 10 })).toEqual({
      kind: "pass",
    });
  });

  it("passes when model is ahead (defensive, e.g. just sent)", () => {
    expect(decideFreshness({ modelSeenSeq: 12, latestSeq: 10 })).toEqual({
      kind: "pass",
    });
  });

  it("holds when there are model-unseen newer messages", () => {
    expect(decideFreshness({ modelSeenSeq: 7, latestSeq: 10 })).toEqual({
      kind: "hold",
      unseenCount: 3,
      fromSeq: 8,
      toSeq: 10,
    });
  });

  it("holds with count 1 for a single unseen message (task#160 case)", () => {
    expect(decideFreshness({ modelSeenSeq: 0, latestSeq: 1 })).toEqual({
      kind: "hold",
      unseenCount: 1,
      fromSeq: 1,
      toSeq: 1,
    });
  });

  it("force overrides a hold into pass (--send-draft)", () => {
    expect(
      decideFreshness({ modelSeenSeq: 7, latestSeq: 10, force: true }),
    ).toEqual({ kind: "pass" });
  });

  it("rejects negative cursors", () => {
    expect(() => decideFreshness({ modelSeenSeq: -1, latestSeq: 5 })).toThrow(
      RangeError,
    );
  });
});

describe("advanceSeenCursor", () => {
  it("moves forward monotonically", () => {
    expect(advanceSeenCursor(5, 9)).toBe(9);
  });
  it("never moves backward", () => {
    expect(advanceSeenCursor(9, 5)).toBe(9);
  });
});
