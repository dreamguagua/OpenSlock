import { describe, it, expect } from "vitest";
import { DomainError, isDomainError } from "../src/domain/errors.js";

describe("DomainError", () => {
  it("carries a stable code and frozen details", () => {
    const e = new DomainError("CLAIM_CONFLICT", "already assigned", {
      taskId: "t1",
    });
    expect(e.code).toBe("CLAIM_CONFLICT");
    expect(e.message).toBe("already assigned");
    expect(e.details).toEqual({ taskId: "t1" });
    expect(Object.isFrozen(e.details)).toBe(true);
  });

  it("is identifiable via isDomainError", () => {
    expect(isDomainError(new DomainError("VALIDATION", "x"))).toBe(true);
    expect(isDomainError(new Error("plain"))).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });

  it("defaults details to an empty object", () => {
    expect(new DomainError("NOT_FOUND", "x").details).toEqual({});
  });
});
