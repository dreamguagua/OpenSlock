import { describe, it, expect } from "vitest";
import { slugify } from "../src/auth/service.js";

describe("slugify (registration)", () => {
  it("ascii 名 → 小写连字符 slug", () => {
    expect(slugify("Acme Crew", "x")).toBe("acme-crew");
    expect(slugify("  Hello World!! ", "x")).toBe("hello-world");
  });
  it("无 ascii(纯中文)→ 回退", () => {
    expect(slugify("牛招团队", "workspace")).toBe("workspace");
  });
  it("混合 → 取 ascii 部分", () => {
    expect(slugify("牛招 Crew 2", "x")).toBe("crew-2");
  });
  it("超长截断到 40", () => {
    expect(slugify("a".repeat(60), "x").length).toBe(40);
  });
});
