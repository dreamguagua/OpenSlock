/**
 * 只读、沙箱化地暴露某 agent 工作区 (<agentsRoot>/<handle>/) 给控制面查看。
 *
 * 安全铁律:
 *  - 所有路径都 resolve 后必须仍落在 agent 根内 (防 `..` / 符号链接逃逸)。
 *  - 隐藏内部目录与点文件 (.crew / .git / 任何 . 开头)。
 *  - 只回文本文件,二进制拒绝;单文件大小上限,超出截断。
 *  - 仅 list / read,无写删。
 */

import { realpath, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export interface FsEntry {
  readonly name: string;
  readonly type: "dir" | "file";
  readonly size?: number;
}
export interface FsListResult {
  readonly root: string; // agent 工作区绝对路径 (UI 顶部展示)
  readonly path: string; // 相对 root 的当前目录 ("" = 根)
  readonly entries: FsEntry[];
}
export interface FsReadResult {
  readonly path: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly size: number;
}

export class FsError extends Error {}

const MAX_FILE_BYTES = 256 * 1024; // 单文件查看上限 256KB
const HIDDEN = new Set([".crew", ".git", ".slock"]);

const isHidden = (name: string): boolean => name.startsWith(".") || HIDDEN.has(name);

/** 把相对路径安全解析到 root 内的绝对路径;越界抛错。realpath 兜底符号链接逃逸。 */
async function safeResolve(root: string, rel: string): Promise<string> {
  const rootResolved = await realpath(root);
  const target = resolve(rootResolved, rel.replace(/^\/+/, ""));
  const withSep = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (target !== rootResolved && !target.startsWith(withSep)) {
    throw new FsError("path escapes workspace");
  }
  // 解析真实路径再校验一次 (符号链接)
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    return target; // 不存在的路径交给后续 stat 报错
  }
  if (real !== rootResolved && !real.startsWith(withSep)) {
    throw new FsError("path escapes workspace (symlink)");
  }
  return real;
}

/** 列出某目录 (相对 root)。隐藏点文件/内部目录;目录在前、按名排序。 */
export async function listWorkspace(root: string, rel: string): Promise<FsListResult> {
  // 工作区尚未创建 (agent 还没跑过):返回空,而不是报错
  const rootExists = await stat(root).then((s) => s.isDirectory()).catch(() => false);
  if (!rootExists) return { root: resolve(root), path: rel.replace(/^\/+/, ""), entries: [] };
  const rootResolved = await realpath(root);
  const dir = await safeResolve(root, rel);
  const st = await stat(dir).catch(() => null);
  if (!st || !st.isDirectory()) throw new FsError("not a directory");
  const names = await readdir(dir);
  const entries: FsEntry[] = [];
  for (const name of names) {
    if (isHidden(name)) continue;
    const full = join(dir, name);
    const s = await stat(full).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) entries.push({ name, type: "dir" });
    else if (s.isFile()) entries.push({ name, type: "file", size: s.size });
  }
  entries.sort((a, b) =>
    a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name),
  );
  return { root: rootResolved, path: rel.replace(/^\/+/, ""), entries };
}

/** 读取某文本文件 (相对 root)。二进制/超大拒绝或截断。 */
export async function readWorkspaceFile(root: string, rel: string): Promise<FsReadResult> {
  const file = await safeResolve(root, rel);
  const s = await stat(file).catch(() => null);
  if (!s || !s.isFile()) throw new FsError("not a file");
  const buf = await readFile(file);
  // 二进制探测:含 NUL 即视为二进制
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) throw new FsError("binary file not viewable");
  const truncated = buf.length > MAX_FILE_BYTES;
  const content = buf.subarray(0, MAX_FILE_BYTES).toString("utf8");
  return { path: rel.replace(/^\/+/, ""), content, truncated, size: buf.length };
}
