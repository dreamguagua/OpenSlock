#!/usr/bin/env node
/**
 * crew-daemon 入口 (M3b 当前形态:本地手动唤醒一个 agent 跑一轮)。
 *   crew-daemon run --agent <handle> --channel <id> [--wake "<text>"] [--display "<name>"]
 *
 * 后续 (M3c):常驻 + 连 server 控制面 WS,由 agent:start 自动唤醒。
 */

import { parseArgs } from "node:util";
import { loadConfig, ConfigError } from "./config.js";
import { runAgent } from "./runner.js";
import { serve } from "./serve.js";

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      agent: { type: "string" },
      channel: { type: "string" },
      wake: { type: "string" },
      display: { type: "string" },
      // 连接参数(也可用 CREW_SERVER_URL / CREW_MACHINE_TOKEN 环境变量)
      "server-url": { type: "string" },
      "api-key": { type: "string" },
      token: { type: "string" }, // --api-key 的别名
    },
  });

  // 无子命令时默认 serve(对齐 `npx @crew-ai/daemon@latest --server-url ... --api-key ...`)
  const cmd = positionals[0] ?? "serve";
  if (cmd !== "run" && cmd !== "serve") {
    process.stderr.write(
      "用法:\n  npx @crew-ai/daemon@latest --server-url <url> --api-key <sk_machine_*>   # 连接并常驻\n  crew-daemon run --agent <h> --channel <id> [--wake ...]                  # 手动跑一次\n",
    );
    process.exit(2);
  }

  // 命令行参数优先于环境变量,填回 env 供 loadConfig 读取
  if (values["server-url"]) process.env.CREW_SERVER_URL = values["server-url"];
  const apiKey = values["api-key"] ?? values.token;
  if (apiKey) process.env.CREW_MACHINE_TOKEN = apiKey;

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(e.message + "\n");
      process.exit(3);
    }
    throw e;
  }

  if (cmd === "serve") {
    process.stdout.write(`\n🛰️  crew-daemon 常驻,连接 ${config.serverUrl} 控制面...\n`);
    serve(config);
    await new Promise(() => {}); // 常驻,直到被 kill
    return;
  }

  if (!values.agent || !values.channel) {
    process.stderr.write("用法: crew-daemon run --agent <handle> --channel <id> [--wake ...]\n");
    process.exit(2);
  }

  process.stdout.write(`\n🚀 唤醒 agent "${values.agent}" 处理频道 ${values.channel}\n\n`);
  const result = await runAgent(config, {
    handle: values.agent,
    channelId: values.channel,
    ...(values.wake ? { wake: values.wake } : {}),
    ...(values.display ? { displayName: values.display } : {}),
  });
  process.stdout.write(`\n— agent 退出 (code ${result.exitCode}),共 ${result.activities.length} 个活动 —\n`);
  process.exit(result.exitCode);
}

main().catch((e) => {
  process.stderr.write(`crew-daemon: ${(e as Error).message}\n`);
  process.exit(1);
});
