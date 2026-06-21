/** daemon 配置:从 env 读取,解析 crew CLI 路径 (注入给 agent 的 wrapper 用)。 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

export interface DaemonConfig {
  readonly serverUrl: string;
  readonly machineToken: string;
  readonly agentsRoot: string; // ~/.crew/agents
  readonly cliPath: string; // 构建后的 crew CLI 入口 (dist/main.js)
  readonly runtimeBin: string; // claude / codex 等
  readonly dangerous: boolean; // 是否给 runtime 传 --dangerously-skip-permissions
}

export class ConfigError extends Error {}

function defaultCliPath(): string {
  // daemon/src → 上两级到 crew/,再进 cli/dist/main.js
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../cli/dist/main.js");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const serverUrl = (env.CREW_SERVER_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
  const machineToken = env.CREW_MACHINE_TOKEN ?? "";
  if (!machineToken) {
    throw new ConfigError("缺少 CREW_MACHINE_TOKEN (sk_machine_*,由 seed 打印)");
  }
  return {
    serverUrl,
    machineToken,
    agentsRoot: env.CREW_AGENTS_ROOT ?? resolve(homedir(), ".crew/agents"),
    cliPath: env.CREW_CLI_PATH ?? defaultCliPath(),
    runtimeBin: env.CREW_RUNTIME ?? "claude",
    dangerous: env.CREW_RUNTIME_SAFE !== "1", // 默认开启 (headless agent 在自有 workspace 内运行)
  };
}
