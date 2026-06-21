import { describe, it, expect } from "vitest";
import {
  unreadCount,
  advanceReadCursor,
  summarizeUnread,
} from "../src/domain/unread.js";

describe("unreadCount", () => {
  it("computes latest - lastRead", () => {
    expect(unreadCount({ lastReadSeq: 7, latestSeq: 12 })).toBe(5);
  });
  it("is zero when caught up", () => {
    expect(unreadCount({ lastReadSeq: 12, latestSeq: 12 })).toBe(0);
  });
  it("never negative", () => {
    expect(unreadCount({ lastReadSeq: 20, latestSeq: 12 })).toBe(0);
  });
});

describe("advanceReadCursor", () => {
  it("advances forward", () => {
    expect(advanceReadCursor(7, 12)).toBe(12);
  });
  it("does not regress", () => {
    expect(advanceReadCursor(12, 7)).toBe(12);
  });
});

describe("summarizeUnread", () => {
  it("includes only channels with unread > 0", () => {
    const out = summarizeUnread([
      { target: "#all", state: { lastReadSeq: 0, latestSeq: 9 } },
      { target: "#quiet", state: { lastReadSeq: 5, latestSeq: 5 } },
      { target: "#skill", state: { lastReadSeq: 10, latestSeq: 21 } },
    ]);
    expect(out).toEqual([
      { target: "#all", unread: 9 },
      { target: "#skill", unread: 11 },
    ]);
  });
});
