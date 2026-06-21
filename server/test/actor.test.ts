import { describe, it, expect } from "vitest";
import {
  isActorType,
  actorEquals,
  isAssignable,
  formatActor,
  type Actor,
} from "../src/domain/actor.js";

describe("actor", () => {
  it("recognizes valid actor types", () => {
    expect(isActorType("human")).toBe(true);
    expect(isActorType("agent")).toBe(true);
    expect(isActorType("system")).toBe(true);
    expect(isActorType("robot")).toBe(false);
  });

  it("compares actor identity by type+id", () => {
    const a: Actor = { type: "agent", id: "x" };
    expect(actorEquals(a, { type: "agent", id: "x" })).toBe(true);
    expect(actorEquals(a, { type: "human", id: "x" })).toBe(false);
    expect(actorEquals(a, { type: "agent", id: "y" })).toBe(false);
  });

  it("treats only human/agent as assignable, never system", () => {
    expect(isAssignable({ type: "human", id: "u" })).toBe(true);
    expect(isAssignable({ type: "agent", id: "a" })).toBe(true);
    expect(isAssignable({ type: "system", id: "platform" })).toBe(false);
  });

  it("formats actor as type:id", () => {
    expect(formatActor({ type: "agent", id: "cindy" })).toBe("agent:cindy");
  });
});
