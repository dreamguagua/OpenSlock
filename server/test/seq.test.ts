import { describe, it, expect } from "vitest";
import { nextSeq, isContiguous, findGaps } from "../src/domain/seq.js";

describe("nextSeq", () => {
  it("starts an empty channel at 1", () => {
    expect(nextSeq(0)).toBe(1);
  });
  it("increments by one", () => {
    expect(nextSeq(41)).toBe(42);
  });
  it("rejects non-integers and negatives", () => {
    expect(() => nextSeq(-1)).toThrow(RangeError);
    expect(() => nextSeq(1.5)).toThrow(RangeError);
  });
});

describe("isContiguous", () => {
  it("true for strictly contiguous", () => {
    expect(isContiguous([5, 6, 7, 8])).toBe(true);
  });
  it("true for empty / single", () => {
    expect(isContiguous([])).toBe(true);
    expect(isContiguous([3])).toBe(true);
  });
  it("false for gaps", () => {
    expect(isContiguous([5, 7, 8])).toBe(false);
  });
  it("false for duplicates", () => {
    expect(isContiguous([5, 5, 6])).toBe(false);
  });
});

describe("findGaps", () => {
  it("finds missing seqs for reconnect compensation", () => {
    expect(findGaps([8, 10], 7, 11)).toEqual([9, 11]);
  });
  it("returns empty when fully present", () => {
    expect(findGaps([8, 9, 10], 7, 10)).toEqual([]);
  });
});
