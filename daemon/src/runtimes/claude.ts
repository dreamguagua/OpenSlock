/**
 * Claude Code runtime 适配:print + stream-json 模式,headless 驱动。
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

type AgentProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface SpawnInput {
  readonly bin: string; // "claude"
  readonly cwd: string; // agent workspace
  readonly systemPromptPath: string;
  readonly wakePrompt: string;
  readonly env: NodeJS.ProcessEnv;
  readonly dangerous: boolean;
  readonly model?: string | null; // 指定模型 → --model
}

export function buildClaudeArgs(input: SpawnInput): string[] {
  const args = [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
    "--append-system-prompt-file",
    input.systemPromptPath,
  ];
  if (input.model) args.push("--model", input.model);
  if (input.dangerous) args.push("--dangerously-skip-permissions");
  args.push(input.wakePrompt);
  return args;
}

export function spawnClaude(input: SpawnInput): AgentProcess {
  return spawn(input.bin, buildClaudeArgs(input), {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
