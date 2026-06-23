import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMemory, stripActiveContext, inspectRaftWorkspace, importRaftWorkspace } from "../src/workspace-import.js";

let roots: string[] = [];
afterEach(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
  roots = [];
});
async function tmpRoot() {
  const r = await mkdtemp(join(tmpdir(), "crew-import-"));
  roots.push(r);
  return r;
}

/** 造一个仿 raft 工作区:用户内容 + raft 内部隐藏目录。 */
async function fakeRaftWorkspace(): Promise<string> {
  const dir = join(await tmpRoot(), "agent-uuid");
  await mkdir(join(dir, "notes"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await mkdir(join(dir, ".slock"), { recursive: true });
  await writeFile(join(dir, "MEMORY.md"), "# HR大脑线上Skill执行效果监测员\n\n## Role\nYou audit skill execution effects.\nReport anomalies daily.\n\n## Core Goals\n1. accuracy\n", "utf8");
  await writeFile(join(dir, "notes", "playbook.md"), "playbook", "utf8");
  await writeFile(join(dir, "artifacts", "report.html"), "<html>", "utf8");
  await writeFile(join(dir, "sop.html"), "<sop>", "utf8");
  await writeFile(join(dir, ".git", "HEAD"), "ref: x", "utf8");
  await writeFile(join(dir, ".slock", "claude-system-prompt.md"), "raft internal", "utf8");
  return dir;
}

describe("parseMemory", () => {
  it("H1 → name,## Role 段 → description", () => {
    const r = parseMemory("# Cindy\n\n## Role\nYou are Cindy, the lead.\nHelp users.\n\n## Core Goals\nx");
    expect(r.name).toBe("Cindy");
    expect(r.description).toBe("You are Cindy, the lead.\nHelp users.");
  });

  it("无 Role 时回退到 H1 后首段", () => {
    const r = parseMemory("# Bob\n\nA general helper agent.\n\n## Notes\nfoo");
    expect(r.name).toBe("Bob");
    expect(r.description).toBe("A general helper agent.");
  });
});

describe("stripActiveContext", () => {
  it("清空 Active Context 正文,保留标题 + 其它段落", () => {
    const md = "# Cindy\n\n## Role\nlead\n\n## Active Context\n- task #181 in_review\n- task #7 blocked\n\n## Index\n- notes/x.md";
    const out = stripActiveContext(md);
    expect(out).toContain("## Role\nlead");
    expect(out).toContain("## Active Context"); // 标题保留
    expect(out).not.toContain("task #181"); // 陈旧任务 id 已剥离
    expect(out).not.toContain("task #7");
    expect(out).toContain("## Index\n- notes/x.md"); // 后续段落完整保留
  });
  it("以 --- 结尾的 Active Context 也能剥离(保留 --- 后内容)", () => {
    const md = "# A\n## Active Context\n- task #99 doing\n\n---\nhow to maintain";
    const out = stripActiveContext(md);
    expect(out).not.toContain("task #99");
    expect(out).toContain("---\nhow to maintain");
  });
  it("无 Active Context 段 → 原样返回", () => {
    const md = "# A\n## Role\nx";
    expect(stripActiveContext(md)).toBe(md);
  });
});

describe("inspectRaftWorkspace", () => {
  it("反填 name/description,只统计可复制条目(跳过 .git/.slock)", async () => {
    const src = await fakeRaftWorkspace();
    const info = await inspectRaftWorkspace(src);
    expect(info.name).toBe("HR大脑线上Skill执行效果监测员");
    expect(info.description).toContain("audit skill execution");
    expect(info.entries.sort()).toEqual(["MEMORY.md", "artifacts", "notes", "sop.html"]);
    expect(info.fileCount).toBe(4);
  });

  it("缺 MEMORY.md → 报错", async () => {
    const dir = join(await tmpRoot(), "empty");
    await mkdir(dir, { recursive: true });
    await expect(inspectRaftWorkspace(dir)).rejects.toThrow(/MEMORY\.md/);
  });

  it("路径不存在 → 报错", async () => {
    await expect(inspectRaftWorkspace("/no/such/path-xyz")).rejects.toThrow(/not found/);
  });
});

describe("importRaftWorkspace", () => {
  it("复制用户内容,跳过 .git/.slock,保留目录树", async () => {
    const src = await fakeRaftWorkspace();
    const dest = join(await tmpRoot(), "hr-skill");
    const res = await importRaftWorkspace(src, dest);

    expect(res.copied.sort()).toEqual(["MEMORY.md", "artifacts", "notes", "sop.html"]);
    const entries = (await readdir(dest)).sort();
    expect(entries).toEqual(["MEMORY.md", "artifacts", "notes", "sop.html"]); // 无 .git/.slock
    expect(await readFile(join(dest, "MEMORY.md"), "utf8")).toContain("HR大脑线上Skill");
    expect(await readFile(join(dest, "notes", "playbook.md"), "utf8")).toBe("playbook");
    expect(await readFile(join(dest, "artifacts", "report.html"), "utf8")).toBe("<html>");
  });
});
