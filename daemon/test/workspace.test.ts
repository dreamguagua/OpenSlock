import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareWorkspace } from "../src/workspace.js";
import { buildClaudeArgs } from "../src/runtimes/claude.js";

let roots: string[] = [];
afterEach(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
  roots = [];
});
async function tmpRoot() {
  const r = await mkdtemp(join(tmpdir(), "crew-ws-"));
  roots.push(r);
  return r;
}

describe("prepareWorkspace", () => {
  it("创建 workspace、MEMORY.md、系统提示、可执行 crew wrapper", async () => {
    const agentsRoot = await tmpRoot();
    const ws = await prepareWorkspace({
      agentsRoot, handle: "cindy", cliPath: "/abs/cli/dist/main.js",
      systemPrompt: "SYS-PROMPT-CONTENT",
    });

    const seed = await readFile(join(ws.dir, "MEMORY.md"), "utf8");
    expect(seed).toContain("# cindy");
    expect(seed).toContain("## Knowledge Index");
    expect(seed).toContain("## Active Context");
    expect(await readFile(ws.systemPromptPath, "utf8")).toBe("SYS-PROMPT-CONTENT");

    const wrapper = join(ws.crewDir, "crew");
    const content = await readFile(wrapper, "utf8");
    expect(content).toContain("exec node");
    expect(content).toContain("/abs/cli/dist/main.js");
    // 0755 可执行
    expect((await stat(wrapper)).mode & 0o111).toBeTruthy();

    // per-agent 凭证隔离:独立 XDG 配置根
    expect(ws.homeDir).toBe(join(agentsRoot, "cindy", ".home"));
    expect((await stat(join(ws.homeDir, ".config"))).isDirectory()).toBe(true);
    expect((await stat(join(ws.homeDir, ".local", "share"))).isDirectory()).toBe(true);
  });

  it("保留已存在的 MEMORY.md (不覆盖 agent 记忆)", async () => {
    const agentsRoot = await tmpRoot();
    await prepareWorkspace({ agentsRoot, handle: "cindy", cliPath: "/x", systemPrompt: "v1" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(agentsRoot, "cindy", "MEMORY.md"), "我自己的记忆", "utf8");

    const ws2 = await prepareWorkspace({ agentsRoot, handle: "cindy", cliPath: "/x", systemPrompt: "v2" });
    expect(ws2.memory).toBe("我自己的记忆"); // 未被覆盖
    expect(await readFile(ws2.systemPromptPath, "utf8")).toBe("v2"); // 系统提示则刷新
  });
});

describe("buildClaudeArgs", () => {
  it("print + stream-json + 系统提示文件 + 唤醒词", () => {
    const args = buildClaudeArgs({
      bin: "claude", cwd: "/ws", systemPromptPath: "/ws/.crew/system-prompt.md",
      wakePrompt: "醒醒", env: {}, dangerous: true,
    });
    expect(args).toContain("--print");
    expect(args).toContain("stream-json");
    expect(args).toContain("--append-system-prompt-file");
    expect(args).toContain("/ws/.crew/system-prompt.md");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args[args.length - 1]).toBe("醒醒");
  });

  it("safe 模式不加 dangerous 标志", () => {
    const args = buildClaudeArgs({
      bin: "claude", cwd: "/ws", systemPromptPath: "/p", wakePrompt: "x", env: {}, dangerous: false,
    });
    expect(args).not.toContain("--dangerously-skip-permissions");
  });
});
