import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { hashPassword, verifyPassword, needsUpgrade } from "../src/auth/password.js";

describe("password (scrypt)", () => {
  it("hash 带前缀 + 随机 salt(同密码两次哈希不同)", () => {
    const a = hashPassword("hunter2");
    const b = hashPassword("hunter2");
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(a).not.toBe(b); // 每次 salt 不同
  });

  it("verify 正确密码 → true,错误 → false", () => {
    const h = hashPassword("correct horse");
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });

  it("needsUpgrade:scrypt=false", () => {
    expect(needsUpgrade(hashPassword("x"))).toBe(false);
  });

  it("兼容历史 sha256 哈希:verify 通过且标记需升级", () => {
    const legacy = createHash("sha256").update("crew-pw:oldpass").digest("hex");
    expect(verifyPassword("oldpass", legacy)).toBe(true);
    expect(verifyPassword("nope", legacy)).toBe(false);
    expect(needsUpgrade(legacy)).toBe(true);
  });
});
