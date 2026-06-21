/**
 * 把 coding-agent runtime 的 stream-json 事件归一化为**语义活动**。
 *
 * 这是 daemon 的关键职责:前端/server 看到的是"在读历史/领任务/发消息",而非裸 Bash。
 * 纯函数,无 IO,完整单测。
 */

export type ActivityKind =
  | "init"
  | "text"
  | "reading" // crew message read
  | "sending" // crew message send
  | "claiming" // crew task claim
  | "checking" // crew message check
  | "crew" // 其它 crew 子命令
  | "tool" // 非 crew 的工具调用
  | "tool_result"
  | "done"
  | "error";

export interface Activity {
  readonly kind: ActivityKind;
  readonly label: string;
  readonly detail?: string;
}

/** 把一条 Bash 命令归类为语义活动 (仅看 crew 子命令)。 */
export function classifyCommand(command: string): Activity {
  const c = command.trim();
  if (/^crew\s+message\s+read\b/.test(c)) return { kind: "reading", label: "读历史", detail: c };
  if (/^crew\s+message\s+send\b/.test(c)) return { kind: "sending", label: "发消息", detail: c };
  if (/^crew\s+message\s+check\b/.test(c)) return { kind: "checking", label: "查未读", detail: c };
  if (/^crew\s+task\s+claim\b/.test(c)) return { kind: "claiming", label: "领任务", detail: c };
  if (/^crew\b/.test(c)) return { kind: "crew", label: "crew 命令", detail: c };
  return { kind: "tool", label: "执行命令", detail: c };
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: { command?: string };
  content?: unknown;
}
interface StreamEvent {
  type?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
  message?: { content?: ContentBlock[] };
}

/** 把一个 stream-json 事件归一化为 0..N 个活动。 */
export function normalizeEvent(event: unknown): Activity[] {
  const e = (event ?? {}) as StreamEvent;

  if (e.type === "system" && e.subtype === "init") {
    return [{ kind: "init", label: "agent 启动" }];
  }

  if (e.type === "result") {
    return e.is_error
      ? [{ kind: "error", label: "运行出错", ...(e.result ? { detail: e.result } : {}) }]
      : [{ kind: "done", label: "本轮结束", ...(e.result ? { detail: e.result } : {}) }];
  }

  if (e.type === "assistant" && Array.isArray(e.message?.content)) {
    const out: Activity[] = [];
    for (const block of e.message!.content!) {
      if (block.type === "text" && block.text?.trim()) {
        out.push({ kind: "text", label: "思考/说明", detail: block.text.trim() });
      } else if (block.type === "tool_use" && block.name === "Bash" && block.input?.command) {
        out.push(classifyCommand(block.input.command));
      } else if (block.type === "tool_use" && block.name) {
        out.push({ kind: "tool", label: `工具:${block.name}` });
      }
    }
    return out;
  }

  if (e.type === "user" && Array.isArray(e.message?.content)) {
    const hasResult = e.message!.content!.some((b) => b.type === "tool_result");
    if (hasResult) return [{ kind: "tool_result", label: "工具返回" }];
  }

  return [];
}

/** 解析一行 ndjson;非法行返回 null。 */
export function parseLine(line: string): unknown | null {
  const t = line.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
