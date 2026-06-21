/**
 * 枚举某 agent 可用的 skill,供 Profile 的 SKILLS 区展示。两个来源:
 *  - workspace 私有:<agentsRoot>/<handle>/skills/<name>/SKILL.md
 *  - 全局共享:    ~/.claude/skills/<name>/SKILL.md (可经 CREW_GLOBAL_SKILLS_DIR 覆盖)
 *
 * 每个 skill = 一个目录,内含 SKILL.md;从其 YAML frontmatter 取 name/description,
 * 缺失则回退到目录名。只读、容错(目录不存在/无 frontmatter 都不报错)。
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SkillInfo {
  readonly scope: "workspace" | "global";
  readonly name: string;
  readonly description: string;
}

const globalSkillsDir = (): string =>
  process.env.CREW_GLOBAL_SKILLS_DIR ?? join(homedir(), ".claude", "skills");

/** 从 SKILL.md 顶部 YAML frontmatter 取 name / description (简易解析,够用)。 */
function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^(name|description)\s*:\s*(.+?)\s*$/);
    if (kv) {
      const val = kv[2]!.replace(/^["']|["']$/g, "");
      if (kv[1] === "name") out.name = val;
      else out.description = val;
    }
  }
  return out;
}

async function readSkillsFrom(dir: string, scope: SkillInfo["scope"]): Promise<SkillInfo[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const skills: SkillInfo[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const skillMd = join(dir, name, "SKILL.md");
    const s = await stat(skillMd).catch(() => null);
    if (!s || !s.isFile()) continue;
    const md = await readFile(skillMd, "utf8").catch(() => "");
    const fm = parseFrontmatter(md);
    skills.push({ scope, name: fm.name || name, description: fm.description ?? "" });
  }
  return skills;
}

/** 列出 agent 的 workspace 私有 + 全局 skill,按 name 排序。 */
export async function listSkills(agentsRoot: string, handle: string): Promise<SkillInfo[]> {
  const [ws, global] = await Promise.all([
    readSkillsFrom(join(agentsRoot, handle, "skills"), "workspace"),
    readSkillsFrom(globalSkillsDir(), "global"),
  ]);
  const all = [...ws, ...global];
  all.sort((a, b) => (a.scope !== b.scope ? (a.scope === "workspace" ? -1 : 1) : a.name.localeCompare(b.name)));
  return all;
}
