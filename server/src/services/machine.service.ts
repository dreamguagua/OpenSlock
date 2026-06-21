/**
 * 机器(运行 daemon 的电脑)管理服务。
 *
 * 新建机器:建行 → 为其签发 sk_machine_* 凭证(subject = system:machineId)→ 记前缀
 *   → 生成"在该电脑终端执行的连接命令"。
 * 机器凭证与 workspace 绑定;daemon 用它连控制面,server 据 subjectId 识别是哪台机器。
 *
 * 连接命令形态:本地 clone 没有发布到 npm 的包,故生成一行可直接跑通的本地 daemon 命令。
 * 命令各部分由 env 配置(不写死),便于换主机/路径。
 */

import { mintCredential as defaultMint } from "../auth/service.js";
import type { Actor } from "../domain/actor.js";
import type { MachineInfoPatch, MachineRepo, MachineRow } from "../repo/types.js";

/** 签发凭证的函数 (可注入,便于内存测试不连库)。 */
export type MintFn = (ws: string, tier: "machine", subject: Actor) => Promise<string>;

const DEFAULT_NAME = "New Computer";

/** server 对外可达地址 (daemon 连这个);默认本地。 */
const publicServerUrl = (): string =>
  (process.env.CREW_PUBLIC_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

/** 本地 daemon 目录 (生成命令用);默认按相对结构推断。 */
const daemonDir = (): string =>
  process.env.CREW_DAEMON_DIR ?? "<absolute path to crew/daemon>";

/** 生成"在目标电脑终端执行"的连接命令。 */
function buildConnectCommand(token: string): string {
  return [
    `CREW_SERVER_URL=${publicServerUrl()}`,
    `CREW_MACHINE_TOKEN=${token}`,
    `pnpm --dir ${daemonDir()} daemon serve`,
  ].join(" ");
}

export class MachineService {
  constructor(
    private readonly repo: MachineRepo,
    private readonly mint: MintFn = defaultMint,
  ) {}

  list(ws: string): Promise<MachineRow[]> {
    return this.repo.list(ws);
  }

  get(ws: string, id: string): Promise<MachineRow | null> {
    return this.repo.get(ws, id);
  }

  async create(
    ws: string,
    name?: string,
  ): Promise<{ machine: MachineRow; token: string; connectCommand: string }> {
    const machine = await this.repo.create(ws, { name: name?.trim() || DEFAULT_NAME });
    const { token, connectCommand } = await this.issueToken(ws, machine.id);
    return { machine: { ...machine, tokenPrefix: token.slice(0, 19) }, token, connectCommand };
  }

  /**
   * 为已存在的机器重新签发 token + 生成连接命令(token 哈希存储不可恢复,故需重发)。
   * 对应 raft 的 "Generate Connect Command"。机器不存在返回 null。
   */
  async regenerateCommand(
    ws: string,
    id: string,
  ): Promise<{ token: string; connectCommand: string } | null> {
    const machine = await this.repo.get(ws, id);
    if (!machine) return null;
    return this.issueToken(ws, id);
  }

  /** 为某机器签发 machine 凭证、记录前缀、返回 token + 连接命令。 */
  private async issueToken(
    ws: string,
    machineId: string,
  ): Promise<{ token: string; connectCommand: string }> {
    const token = await this.mint(ws, "machine", { type: "system", id: machineId });
    await this.repo.setTokenPrefix(ws, machineId, token.slice(0, 19)); // "sk_machine_" + 8 位
    return { token, connectCommand: buildConnectCommand(token) };
  }

  rename(ws: string, id: string, name: string): Promise<MachineRow | null> {
    return this.repo.rename(ws, id, name.trim() || DEFAULT_NAME);
  }

  setStatus(ws: string, id: string, status: "online" | "offline"): Promise<void> {
    return this.repo.setStatus(ws, id, status);
  }

  updateInfo(ws: string, id: string, patch: MachineInfoPatch): Promise<void> {
    return this.repo.updateInfo(ws, id, patch);
  }
}
