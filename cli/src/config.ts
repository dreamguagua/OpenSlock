/** CLI 配置:从环境变量读取 server 地址与 agent 凭证。 */

export interface CliConfig {
  readonly serverUrl: string;
  readonly token: string;
}

export class ConfigError extends Error {}

/** 从 env 解析配置。token 缺失时抛 ConfigError (whoami 等所有命令都需要)。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const serverUrl = (env.CREW_SERVER_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
  const token = env.CREW_TOKEN ?? "";
  if (!token) {
    throw new ConfigError("缺少 CREW_TOKEN (应为 sk_agent_* 凭证,由 daemon 注入)");
  }
  return { serverUrl, token };
}
