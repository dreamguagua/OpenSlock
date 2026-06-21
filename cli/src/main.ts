#!/usr/bin/env node
/** crew CLI 入口:从 env 装配 client,跑命令,按退出码退出。 */

import { loadConfig, ConfigError } from "./config.js";
import { CrewClient } from "./client.js";
import { run, type Io } from "./run.js";
import { EXIT } from "./exit.js";

const io: Io = {
  out: (s) => process.stdout.write(s + "\n"),
  err: (s) => process.stderr.write(s + "\n"),
};

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      io.err(e.message);
      process.exit(EXIT.AUTH);
    }
    throw e;
  }
  const client = new CrewClient(config.serverUrl, config.token);
  const code = await run(process.argv.slice(2), { client, io, readStdin });
  process.exit(code);
}

main().catch((e) => {
  io.err(`crew: ${(e as Error).message}`);
  process.exit(EXIT.GENERIC);
});
