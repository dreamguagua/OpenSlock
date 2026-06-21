/**
 * Agent 实时状态:单一数据源的派生逻辑。
 * 颜色三态 —— online 🟢 / busy 🟡 / offline ⚪ —— 由 deriveStatus 统一计算,
 * 全站所有头像角标、状态点、DM 头部都读它,保证「一处变、处处变」。
 */

import type { AgentActivity, AgentStatusInfo } from "./types.js";

/** daemon 上报的活动字符串 → 人类可读文案(busy 态的标签)。 */
export const ACTIVITY_LABEL: Record<string, string> = {
  working: "running command",
  thinking: "thinking",
  reading: "reading history",
  sending: "sending",
  checking: "checking unread",
  claiming: "claiming a task",
};

/** 表示「活动已结束」的终态:收到即清除 busy。 */
export const TERMINAL_ACTIVITIES: ReadonlySet<string> = new Set(["done", "error"]);

/** busy 活动视为过期的时长(ms):超过即回落到 online/offline。
 *  调大到 90s:agent 一轮里 LLM 思考 / 长命令之间的间隔常 >12s,太短会在工作中途
 *  误回落成绿(online)。每轮结束 daemon 会发 done/error 终态立即清除,故无需短 TTL。 */
export const ACTIVITY_TTL_MS = 90_000;

/**
 * 由「daemon 是否在线」+「当前活动」派生出 agent 的展示状态。
 * 有活跃 activity 即证明 agent 在做事(busy),优先级最高;否则看 online。
 */
export function deriveStatus(
  online: boolean | undefined,
  activity: AgentActivity | undefined,
): AgentStatusInfo {
  if (activity && !TERMINAL_ACTIVITIES.has(activity.activity)) {
    return {
      kind: "busy",
      activity: activity.activity,
      label: ACTIVITY_LABEL[activity.activity] ?? activity.activity,
    };
  }
  if (online) return { kind: "online", label: "Online" };
  return { kind: "offline", label: "Offline" };
}
