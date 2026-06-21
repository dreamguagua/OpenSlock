import { describe, it, expect } from "vitest";
import { parseMentions, mentionedAgents } from "../src/domain/mention.js";

describe("parseMentions", () => {
  it("提取 @handle,去重保序", () => {
    expect(parseMentions("@alice 看下,@bob @alice 也是")).toEqual(["alice", "bob"]);
  });
  it("支持中文 handle", () => {
    expect(parseMentions("@产品专家 帮忙")).toEqual(["产品专家"]);
  });
  it("无 @ → 空", () => {
    expect(parseMentions("普通消息")).toEqual([]);
  });
});

describe("mentionedAgents", () => {
  it("只保留是 agent 的 @", () => {
    expect(mentionedAgents("@cindy @alice", ["cindy", "dave"])).toEqual(["cindy"]);
  });
});
