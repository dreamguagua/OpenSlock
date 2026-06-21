/**
 * 导入一个已有的 raft agent 工作区到本机的 crew 工作区。
 *
 * raft 工作区目录(~/.slock/agents/<uuid>/)里:
 *   - 用户内容(复制):MEMORY.md、notes/、artifacts/、incoming/、*.html 等非隐藏文件
 *   - raft 内部(不复制,crew 自己重建):.git/、.slock/(系统提示词/mcp/CLI wrapper)
 *
 * crew 侧的唯一 id、隐藏的 .crew/(system-prompt + crew wrapper)由 prepareWorkspace 在
 * 首次运行时生成,DB 行另起新 uuid —— 所以这里只搬运用户内容,内部一律重建。
 */

import { readFile, readdir, stat, cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/** 一律跳过的隐藏/内部条目(其余 dotfile 也跳过)。 */
const SKIP = new Set([".git", ".slock", ".crew", ".DS_Store"]);

export interface RaftInspect {
  readonly name: string;
  readonly description: string;
  readonly fileCount: number;
  readonly entries: readonly string[];
}

export interface RaftImportResult {
  readonly copied: readonly string[];
  readonly dir: string;
}

/** 展开开头的 `~` 为用户主目录(daemon 在被测机器上跑,路径里常带 ~)。 */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** 从 MEMORY.md 反填:H1 → name;`## Role` 段正文 → description(无 Role 则取 H1 后首段)。 */
export function parseMemory(md: string): { name: string; description: string } {
  const lines = md.split(/\r?\n/);

  let name = "";
  let h1Idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^#\s+(.+?)\s*$/);
    if (m) { name = m[1]!.trim(); h1Idx = i; break; }
  }

  const sectionBody = (startIdx: number): string => {
    const body: string[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      if (/^#{1,6}\s+/.test(lines[i]!)) break; // 下一个标题为止
      body.push(lines[i]!);
    }
    return body.join("\n").trim();
  };

  let description = "";
  const roleIdx = lines.findIndex((l) => /^##\s+Role\b/i.test(l));
  if (roleIdx >= 0) description = sectionBody(roleIdx + 1);
  if (!description && h1Idx >= 0) description = sectionBody(h1Idx + 1); // 兜底:H1 后首段

  return { name, description: description.slice(0, 3000) };
}

async function assertDir(srcPath: string): Promise<void> {
  let st;
  try {
    st = await stat(srcPath);
  } catch {
    throw new Error(`workspace path not found: ${srcPath}`);
  }
  if (!st.isDirectory()) throw new Error(`not a directory: ${srcPath}`);
}

/** 读取 raft 工作区元信息(name/description/可复制条目),不写入任何文件。 */
export async function inspectRaftWorkspace(rawPath: string): Promise<RaftInspect> {
  const srcPath = expandHome(rawPath);
  await assertDir(srcPath);

  let memory: string;
  try {
    memory = await readFile(join(srcPath, "MEMORY.md"), "utf8");
  } catch {
    throw new Error("no MEMORY.md in this folder — is it a raft agent workspace?");
  }
  const { name, description } = parseMemory(memory);

  const all = await readdir(srcPath);
  const entries = all.filter((e) => !SKIP.has(e) && !e.startsWith("."));
  return { name, description, fileCount: entries.length, entries };
}

/** 复制 raft 工作区的用户内容到目标目录(隐藏/内部条目不复制)。 */
export async function importRaftWorkspace(rawPath: string, destDir: string): Promise<RaftImportResult> {
  const srcPath = expandHome(rawPath);
  await assertDir(srcPath);

  await mkdir(destDir, { recursive: true });
  const all = await readdir(srcPath);
  const copied: string[] = [];
  for (const e of all) {
    if (SKIP.has(e) || e.startsWith(".")) continue;
    await cp(join(srcPath, e), join(destDir, e), { recursive: true });
    copied.push(e);
  }
  return { copied, dir: destDir };
}
