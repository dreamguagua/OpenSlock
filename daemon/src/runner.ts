/**
 * Agent 运行编排:换令牌 → 备 workspace → spawn runtime → 归一化事件流。
 */

import { createInterface } from "node:readline";
import { delimiter, join } from "node:path";
import type { DaemonConfig } from "./config.js";
import { mintAgentToken } from "./token.js";
import { prepareWorkspace } from "./workspace.js";
import { buildSystemPrompt, buildWakePrompt } from "./prompt.js";
import { spawnClaude } from "./runtimes/claude.js";
import { normalizeEvent, parseLine, type Activity } from "./normalize.js";

export interface RunAgentInput {
  readonly handle: string;
  readonly channelId: string;
  readonly displayName?: string;
  readonly wake?: string;
}

export interface RunAgentResult {
  readonly exitCode: number;
  readonly activities: Activity[];
}

const ICON: Record<string, string> = {
  init: "🟢", text: "💬", reading: "📖", sending: "📨", checking: "🔎",
  claiming: "📌", crew: "⚙️", tool: "🛠️", tool_result: "↩️", done: "✅", error: "❌",
};

export async function runAgent(
  config: DaemonConfig,
  input: RunAgentInput,
  onActivity: (a: Activity) => void = defaultPrint,
): Promise<RunAgentResult> {
  // 1) 用机器令牌换 per-launch agent 令牌
  const cred = await mintAgentToken(
    config.serverUrl,
    config.machineToken,
    input.handle,
    input.displayName,
  );

  // 2) 准备 workspace + 注入 crew wrapper + 系统提示词
  // (agent 自行读 cwd 的 MEMORY.md,故系统提示不内嵌记忆)
  const systemPrompt = buildSystemPrompt({
    handle: input.handle,
    channelId: input.channelId,
    agentId: cred.agentId,
    workspaceDir: join(config.agentsRoot, input.handle),
  });
  const ws = await prepareWorkspace({
    agentsRoot: config.agentsRoot,
    handle: input.handle,
    cliPath: config.cliPath,
    systemPrompt,
  });

  // 3) spawn runtime,注入 PATH(crew wrapper)、凭证 env、以及 agent 运行时配置
  //    provider=custom → BYOC(ANTHROPIC_BASE_URL/API_KEY);reasoning → 思考预算;model → --model
  const cfg = cred.config ?? {};
  const REASONING_TOKENS: Record<string, string> = { low: "4000", medium: "10000", high: "31999" };
  const child = spawnClaude({
    bin: config.runtimeBin,
    cwd: ws.dir,
    systemPromptPath: ws.systemPromptPath,
    wakePrompt: input.wake ?? buildWakePrompt(input.channelId),
    dangerous: config.dangerous,
    ...(cfg.model ? { model: cfg.model } : {}),
    env: {
      ...process.env,
      PATH: `${ws.crewDir}${delimiter}${process.env.PATH ?? ""}`,
      CREW_SERVER_URL: config.serverUrl,
      CREW_TOKEN: cred.token,
      CREW_CHANNEL: input.channelId,
      // per-agent 凭证隔离:XDG 指向本 agent 独立目录(gh/gcloud 等 CLI 的 token 不互相串)。
      // 不覆盖 HOME(否则会破坏 claude 自身的 ~/.claude 鉴权);常用 CLI 也单独点名隔离。
      XDG_CONFIG_HOME: join(ws.homeDir, ".config"),
      XDG_DATA_HOME: join(ws.homeDir, ".local", "share"),
      XDG_CACHE_HOME: join(ws.homeDir, ".cache"),
      GH_CONFIG_DIR: join(ws.homeDir, ".config", "gh"),
      CLOUDSDK_CONFIG: join(ws.homeDir, ".config", "gcloud"),
      // provider custom = BYOC:为该 agent 单独设置 Anthropic 端点/密钥
      ...(cfg.provider === "custom" && cfg.providerBaseUrl ? { ANTHROPIC_BASE_URL: cfg.providerBaseUrl } : {}),
      ...(cfg.provider === "custom" && cfg.providerApiKey ? { ANTHROPIC_API_KEY: cfg.providerApiKey } : {}),
      // reasoning → 思考预算 (claude 读 MAX_THINKING_TOKENS)
      ...(cfg.reasoning && cfg.reasoning !== "default" && REASONING_TOKENS[cfg.reasoning]
        ? { MAX_THINKING_TOKENS: REASONING_TOKENS[cfg.reasoning]! }
        : {}),
      // fast 模式 → 透传给 runtime(best-effort,供 wrapper/runtime 读取)
      ...(cfg.fastMode ? { CREW_FAST_MODE: "1" } : {}),
    },
  });

  // 4) 逐行解析 stdout → 归一化 → 回调
  const activities: Activity[] = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const evt = parseLine(line);
    if (!evt) return;
    for (const a of normalizeEvent(evt)) {
      activities.push(a);
      onActivity(a);
    }
  });
  child.stderr.on("data", (d) => process.stderr.write(d));

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
  });

  return { exitCode, activities };
}

function defaultPrint(a: Activity): void {
  const icon = ICON[a.kind] ?? "·";
  const detail = a.detail ? `  ${a.detail.replace(/\s+/g, " ").slice(0, 120)}` : "";
  process.stdout.write(`${icon} ${a.label}${detail}\n`);
}
