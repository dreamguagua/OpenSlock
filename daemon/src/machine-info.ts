/**
 * 采集本机信息上报给控制面 (machine:hello):hostname / os / daemon 版本 / 已装 runtimes。
 * runtimes 探测靠 `which <bin>`,只报真实可执行的 CLI(用于展示 Detected Runtimes)。
 */

import { hostname, arch, platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const execFileP = promisify(execFile);

export interface MachineHello {
  readonly type: "machine:hello";
  readonly hostname: string;
  readonly os: string;
  readonly daemonVersion: string;
  readonly runtimes: string[];
}

/** 候选 runtime CLI:展示名 → 可执行文件名。 */
const RUNTIME_BINS: ReadonlyArray<readonly [string, string]> = [
  ["claude", "claude"],
  ["codex", "codex"],
  ["cursor", "cursor-agent"],
  ["gemini", "gemini"],
  ["opencode", "opencode"],
  ["copilot", "copilot"],
  ["kimi", "kimi"],
  ["pi", "pi"],
];

async function isInstalled(bin: string): Promise<boolean> {
  try {
    await execFileP("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

/** 并发探测所有候选 runtime,返回已安装的展示名列表。 */
export async function detectRuntimes(): Promise<string[]> {
  const checks = await Promise.all(
    RUNTIME_BINS.map(async ([name, bin]) => ((await isInstalled(bin)) ? name : null)),
  );
  return checks.filter((x): x is string => x !== null);
}

function daemonVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function collectMachineHello(): Promise<MachineHello> {
  return {
    type: "machine:hello",
    hostname: hostname(),
    os: `${platform()} ${arch()}`,
    daemonVersion: daemonVersion(),
    runtimes: await detectRuntimes(),
  };
}
