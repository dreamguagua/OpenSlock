/**
 * Agent 唤醒模式与命令白名单 (纯规则)。
 *
 * - **catch-up**:补课模式。只读 —— 读完列出的频道即停。**禁止** send / claim / check。
 *   仅当历史里发现直接指向自己的请求/指派/@mention/review 时,才切到 active。
 * - **active**:主动处理模式。可 send / claim / update / check 等全部命令。
 *
 * 两种模式让被唤醒的 agent 默认"只读补课",避免无关唤醒造成刷屏。
 */

export const WAKE_MODES = ["catchup", "active"] as const;
export type WakeMode = (typeof WAKE_MODES)[number];

/** CLI 命令族 (`crew <family> <verb>`)。 */
export type CommandFamily =
  | "message"
  | "task"
  | "channel"
  | "attachment"
  | "profile"
  | "integration"
  | "reminder"
  | "action"
  | "whoami"
  | "version";

export interface Command {
  readonly family: CommandFamily;
  /** 子动作,如 read/send/check/claim/update/list。 */
  readonly verb: string;
}

/** 是否为产生 side effect 的命令 (写消息、改任务状态等)。 */
export function hasSideEffect(cmd: Command): boolean {
  if (cmd.family === "message") return cmd.verb !== "read";
  if (cmd.family === "task") return cmd.verb !== "list" && cmd.verb !== "get";
  if (cmd.family === "channel") return cmd.verb !== "list" && cmd.verb !== "get";
  // 只读族
  if (cmd.family === "whoami" || cmd.family === "version") return false;
  // 其余族 (attachment/profile/integration/reminder/action) 的非 list/get 默认有副作用
  return cmd.verb !== "list" && cmd.verb !== "get";
}

/** catch-up 下,`message check` 也被明确禁止 (不止"有副作用")。 */
function isForbiddenInCatchup(cmd: Command): boolean {
  if (cmd.family === "message" && cmd.verb === "check") return true;
  return hasSideEffect(cmd);
}

export function isCommandAllowed(mode: WakeMode, cmd: Command): boolean {
  if (mode === "active") return true;
  return !isForbiddenInCatchup(cmd);
}
