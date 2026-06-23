/**
 * 准备 agent 在本机的工作区:
 *   <agentsRoot>/<handle>/
 *     ├── MEMORY.md                     长期记忆/角色 (首次创建种子)
 *     ├── .crew/system-prompt.md        注入 runtime 的系统提示词
 *     └── .crew/crew                    注入 PATH 的 CLI wrapper (0755)
 *
 * spawn runtime 时把 <ws>/.crew 置于 PATH 最前,于是 agent 的 `crew ...` 命中 wrapper。
 */

import { mkdir, writeFile, readFile, chmod, access } from "node:fs/promises";
import { join } from "node:path";

export interface PreparedWorkspace {
  readonly dir: string;
  readonly crewDir: string;
  readonly systemPromptPath: string;
  readonly memory: string;
  /** 每个 agent 独立的 XDG 配置根(<dir>/.home),隔离第三方 CLI 凭证(gh/gcloud 等)。 */
  readonly homeDir: string;
  /** 本次运行的隔离工作目录(<dir>/tasks/<taskKey>/);并行运行互不干扰。无 taskKey 时回退到 dir。 */
  readonly runDir: string;
  /** 本任务的工作日志文件(<runDir>/work-log.md);每任务一份,并行写入不冲突。 */
  readonly workLogPath: string;
  /** 当前工作日志内容(用于注入提示词,让 agent 续上进度)。 */
  readonly workLog: string;
}

/** 文件系统安全的 taskKey:仅留 [\w.-],其余转 _,截断,避免路径穿越/超长。 */
export function safeKey(key: string): string {
  return key.replace(/[^\w.-]+/g, "_").replace(/^[-.]+/, "").slice(0, 80) || "default";
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export interface PrepareInput {
  readonly agentsRoot: string;
  readonly handle: string;
  readonly cliPath: string; // 构建后的 crew CLI 入口
  /** 系统提示词;省略则不写(调用方拿到 memory/workLog 后自行 build 再写 systemPromptPath)。 */
  readonly systemPrompt?: string;
  /** 本次运行的任务键(线程锚点/频道);用于隔离 cwd 与 per-task work-log。 */
  readonly taskKey?: string;
}

export async function prepareWorkspace(input: PrepareInput): Promise<PreparedWorkspace> {
  const dir = join(input.agentsRoot, input.handle);
  const crewDir = join(dir, ".crew");
  await mkdir(crewDir, { recursive: true });

  // MEMORY.md:首次创建"索引 + Active Context"骨架,之后由 agent 自己维护
  const memoryPath = join(dir, "MEMORY.md");
  if (!(await exists(memoryPath))) {
    await writeFile(memoryPath, memorySeed(input.handle), "utf8");
  }
  const memory = await readFile(memoryPath, "utf8");

  // 系统提示词 (每次覆盖,保证最新);省略时由调用方在拿到 memory 后自行写入。
  const systemPromptPath = join(crewDir, "system-prompt.md");
  if (input.systemPrompt != null) await writeFile(systemPromptPath, input.systemPrompt, "utf8");

  // crew wrapper:exec 构建后的 CLI;凭证/地址经 env 注入,故 wrapper 极简
  const wrapper = join(crewDir, "crew");
  await writeFile(
    wrapper,
    `#!/bin/sh\nexec node ${JSON.stringify(input.cliPath)} "$@"\n`,
    "utf8",
  );
  await chmod(wrapper, 0o755);

  // 每个 agent 独立的 XDG 配置根:隔离第三方 CLI 凭证,避免 agent 之间互相串号
  const homeDir = join(dir, ".home");
  await mkdir(join(homeDir, ".config"), { recursive: true });
  await mkdir(join(homeDir, ".local", "share"), { recursive: true });
  await mkdir(join(homeDir, ".cache"), { recursive: true });

  // 每任务隔离的运行目录(并行运行互不干扰的 cwd)+ per-task work-log。
  // 无 taskKey(罕见)时回退到共享 dir(单运行旧行为)。
  let runDir = dir;
  let workLogPath = join(dir, "tasks", "default", "work-log.md");
  if (input.taskKey) {
    runDir = join(dir, "tasks", safeKey(input.taskKey));
    await mkdir(runDir, { recursive: true });
    workLogPath = join(runDir, "work-log.md");
  }
  const workLog = (await exists(workLogPath)) ? await readFile(workLogPath, "utf8") : "";

  return { dir, crewDir, systemPromptPath, memory, homeDir, runDir, workLogPath, workLog };
}

/**
 * MEMORY.md 种子骨架:分层记忆的"索引 + Active Context"结构。
 * 第一次准备工作区时写入;之后 agent 自己维护(系统提示词里有协议)。
 */
function memorySeed(handle: string): string {
  return `# ${handle}

## Role
(Who you are and what you're responsible for. Keep it to a few lines.)

## Core Goals
(What you optimize for.)

## Knowledge Index
<!-- The map to your detailed notes. Add a line here whenever you create a note. -->
<!-- e.g. - [Channels](notes/channels.md) — what each channel is for -->
<!-- e.g. - [User Preferences](notes/user-preferences.md) — conventions to follow -->

## Active Context
<!-- Running log of what you're doing now: in-progress tasks, next steps, what you owe whom.
     Write an entry here BEFORE a long task so you can resume after sleep/compaction. -->

---
How to maintain this file:
- This is the FIRST file read on every startup (including after context compaction).
- Keep it self-sufficient: reading only this file should tell you who you are, what you
  know (and which note to read for detail), what you're working on, and what you owe.
- Put details in notes/<topic>.md; keep this file an index + active context.
`;
}
