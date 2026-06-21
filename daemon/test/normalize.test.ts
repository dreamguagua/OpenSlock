import { describe, it, expect } from "vitest";
import { classifyCommand, normalizeEvent, parseLine } from "../src/normalize.js";

describe("classifyCommand", () => {
  it("识别 crew 各子命令", () => {
    expect(classifyCommand("crew message read --channel c1").kind).toBe("reading");
    expect(classifyCommand("crew message send --channel c1 -m hi").kind).toBe("sending");
    expect(classifyCommand("crew message check --channel c1").kind).toBe("checking");
    expect(classifyCommand("crew task claim t1").kind).toBe("claiming");
    expect(classifyCommand("crew whoami").kind).toBe("crew");
  });
  it("非 crew 命令归为 tool", () => {
    expect(classifyCommand("git status").kind).toBe("tool");
  });
});

describe("normalizeEvent", () => {
  it("system/init → 启动", () => {
    expect(normalizeEvent({ type: "system", subtype: "init" })).toEqual([
      { kind: "init", label: "agent 启动" },
    ]);
  });

  it("assistant 文本 + Bash 工具 → 文本 + 语义活动", () => {
    const out = normalizeEvent({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "我先读一下频道" },
          { type: "tool_use", name: "Bash", input: { command: "crew message read --channel c1" } },
        ],
      },
    });
    expect(out.map((a) => a.kind)).toEqual(["text", "reading"]);
  });

  it("assistant 里的 task claim → claiming", () => {
    const out = normalizeEvent({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "crew task claim t9" } }] },
    });
    expect(out[0]?.kind).toBe("claiming");
  });

  it("user tool_result → 工具返回", () => {
    expect(normalizeEvent({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }))
      .toEqual([{ kind: "tool_result", label: "工具返回" }]);
  });

  it("result success/error", () => {
    expect(normalizeEvent({ type: "result", subtype: "success", result: "done" })[0]?.kind).toBe("done");
    expect(normalizeEvent({ type: "result", is_error: true, result: "boom" })[0]?.kind).toBe("error");
  });

  it("未知事件 → 空", () => {
    expect(normalizeEvent({ type: "whatever" })).toEqual([]);
    expect(normalizeEvent(null)).toEqual([]);
  });
});

describe("parseLine", () => {
  it("解析合法 ndjson", () => {
    expect(parseLine('{"type":"system"}')).toEqual({ type: "system" });
  });
  it("空行/非法行 → null", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("not json")).toBeNull();
  });
});
