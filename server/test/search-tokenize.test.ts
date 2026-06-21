import { describe, it, expect } from "vitest";
import { cjkTokens, uniqueTokens, tokensMatch } from "../src/domain/search-tokenize.js";

describe("cjkTokens", () => {
  it("CJK 连续段 → 重叠 bigram", () => {
    expect(cjkTokens("产品专家")).toEqual(["产品", "品专", "专家"]);
  });
  it("单字保留", () => {
    expect(cjkTokens("猫")).toEqual(["猫"]);
  });
  it("ascii 整词 + 小写", () => {
    expect(cjkTokens("Bug Fix")).toEqual(["bug", "fix"]);
  });
  it("中英混合 + 标点分隔", () => {
    expect(cjkTokens("登录Bug,超时!")).toEqual(["登录", "bug", "超时"]);
  });
  it("uniqueTokens 去重", () => {
    expect(uniqueTokens("产品产品")).toEqual(["产品", "品产"]);
  });
});

describe("tokensMatch (查询全命中)", () => {
  const doc = new Set(cjkTokens("他是牛招的产品专家"));
  it("连续短语命中", () => {
    expect(tokensMatch(doc, "产品专家")).toBe(true);
  });
  it("空格分隔多关键词 → 乱序命中", () => {
    expect(tokensMatch(doc, "专家 牛招")).toBe(true); // 顺序与原文相反
  });
  it("缺一个词 → 不命中", () => {
    expect(tokensMatch(doc, "产品 测试")).toBe(false);
  });
  it("ascii 乱序命中", () => {
    expect(tokensMatch(new Set(cjkTokens("fix the bug")), "bug fix")).toBe(true);
  });
  it("空查询 → 不命中", () => {
    expect(tokensMatch(doc, "  ")).toBe(false);
  });
});
