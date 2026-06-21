import { describe, it, expect } from "vitest";
import {
  runWithContext,
  currentContext,
  currentWorkspaceId,
  currentActor,
} from "../src/tenant/context.js";
import { isDomainError } from "../src/domain/errors.js";
import type { Actor } from "../src/domain/actor.js";

const actor: Actor = { type: "agent", id: "a" };

describe("tenant context", () => {
  it("binds and reads workspaceId + actor inside the scope", () => {
    runWithContext({ workspaceId: "ws1", actor }, () => {
      expect(currentWorkspaceId()).toBe("ws1");
      expect(currentActor()).toEqual(actor);
      expect(currentContext()).toEqual({ workspaceId: "ws1", actor });
    });
  });

  it("throws FORBIDDEN when read outside any context", () => {
    try {
      currentContext();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(isDomainError(e) && e.code).toBe("FORBIDDEN");
    }
  });

  it("rejects a context without workspaceId", () => {
    expect(() =>
      runWithContext({ workspaceId: "", actor }, () => undefined),
    ).toThrow();
  });

  it("isolates concurrent async contexts (no tenant leak)", async () => {
    const seen: string[] = [];
    await Promise.all([
      new Promise<void>((resolve) =>
        runWithContext({ workspaceId: "wsA", actor }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          seen.push(currentWorkspaceId());
          resolve();
        }),
      ),
      new Promise<void>((resolve) =>
        runWithContext({ workspaceId: "wsB", actor }, async () => {
          seen.push(currentWorkspaceId());
          resolve();
        }),
      ),
    ]);
    expect(seen.sort()).toEqual(["wsA", "wsB"]);
  });
});
