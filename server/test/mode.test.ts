import { describe, it, expect } from "vitest";
import { isCommandAllowed, hasSideEffect } from "../src/domain/mode.js";

describe("hasSideEffect", () => {
  it("message read is read-only; send/check have effects", () => {
    expect(hasSideEffect({ family: "message", verb: "read" })).toBe(false);
    expect(hasSideEffect({ family: "message", verb: "send" })).toBe(true);
    expect(hasSideEffect({ family: "message", verb: "check" })).toBe(true);
  });
  it("task list/get are read-only; claim/update have effects", () => {
    expect(hasSideEffect({ family: "task", verb: "list" })).toBe(false);
    expect(hasSideEffect({ family: "task", verb: "claim" })).toBe(true);
    expect(hasSideEffect({ family: "task", verb: "update" })).toBe(true);
  });

  it("other families (reminder/attachment/...) treat non list/get as side-effecting", () => {
    expect(hasSideEffect({ family: "reminder", verb: "create" })).toBe(true);
    expect(hasSideEffect({ family: "attachment", verb: "list" })).toBe(false);
    expect(hasSideEffect({ family: "integration", verb: "get" })).toBe(false);
    expect(hasSideEffect({ family: "channel", verb: "list" })).toBe(false);
    expect(hasSideEffect({ family: "channel", verb: "get" })).toBe(false);
    expect(hasSideEffect({ family: "channel", verb: "create" })).toBe(true);
  });

  it("whoami and version are always read-only", () => {
    expect(hasSideEffect({ family: "whoami", verb: "" })).toBe(false);
    expect(hasSideEffect({ family: "version", verb: "" })).toBe(false);
  });
});

describe("isCommandAllowed", () => {
  it("active mode allows everything", () => {
    expect(isCommandAllowed("active", { family: "message", verb: "send" })).toBe(true);
    expect(isCommandAllowed("active", { family: "task", verb: "claim" })).toBe(true);
    expect(isCommandAllowed("active", { family: "message", verb: "check" })).toBe(true);
  });

  it("catchup allows read-only commands", () => {
    expect(isCommandAllowed("catchup", { family: "message", verb: "read" })).toBe(true);
    expect(isCommandAllowed("catchup", { family: "channel", verb: "list" })).toBe(true);
    expect(isCommandAllowed("catchup", { family: "whoami", verb: "" })).toBe(true);
  });

  it("catchup forbids send, claim, and explicitly check", () => {
    expect(isCommandAllowed("catchup", { family: "message", verb: "send" })).toBe(false);
    expect(isCommandAllowed("catchup", { family: "task", verb: "claim" })).toBe(false);
    expect(isCommandAllowed("catchup", { family: "message", verb: "check" })).toBe(false);
  });
});
