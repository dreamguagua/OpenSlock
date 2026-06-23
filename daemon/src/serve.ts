/**
 * 常驻模式 (M3c):连接 server 控制面 WS,注册机器,监听 agent:start 自动唤醒 agent。
 * 断线指数退避重连。一个 agent:start 进来就跑一次现有的 runAgent。
 */

import { WebSocket } from "ws";
import { join } from "node:path";
import type { DaemonConfig } from "./config.js";
import { runAgent } from "./runner.js";
import { collectMachineHello } from "./machine-info.js";
import { listWorkspace, readWorkspaceFile } from "./workspace-fs.js";
import { listSkills } from "./skills.js";
import { inspectRaftWorkspace, importRaftWorkspace } from "./workspace-import.js";

interface AgentStart {
  type: "agent:start";
  agentHandle: string;
  channelId: string;
  reason?: string;
  wake?: { content?: string; senderHandle?: string; threadId?: string };
}

interface FsRequest {
  type: "fs:list" | "fs:read" | "skills:list" | "raft:inspect" | "raft:import";
  reqId: string;
  handle: string; // raft:inspect 时为空;raft:import 时为目标 handle(= 目标目录名)
  path: string; // fs:* 时为工作区相对路径;raft:* 时为源 raft 工作区绝对/家目录路径
}

// normalize.ts 的活动种类 → activity 枚举
const ACTIVITY_MAP: Record<string, string> = {
  init: "working", text: "thinking", reading: "reading", sending: "sending",
  checking: "checking", claiming: "claiming", crew: "working", tool: "working",
  tool_result: "working", done: "done", error: "error",
};

export interface ServeOptions {
  readonly maxBackoffMs?: number;
  /** 测试钩子:连上后回调 (传入当前 socket)。 */
  readonly onOpen?: (ws: WebSocket) => void;
}

export function serve(config: DaemonConfig, opts: ServeOptions = {}): { stop: () => void } {
  const wsUrl =
    config.serverUrl.replace(/^http/, "ws") +
    `/daemon/connect?key=${encodeURIComponent(config.machineToken)}`;
  let stopped = false;
  let ws: WebSocket | null = null;
  let backoff = 1000;
  const maxBackoff = opts.maxBackoffMs ?? 30_000;

  // 并行调度:同一 agent 可并行处理多个【不同任务】(线程/频道),每任务隔离 cwd+work-log。
  // - running:正在跑的「agent:任务」去重键(同一任务重复唤醒才跳过)。
  // - agentSlots:每 agent 当前并行数;超过 MAX_PARALLEL 的进 FIFO 队列(不丢)。
  const MAX_PARALLEL = Number(process.env.CREW_MAX_PARALLEL) || 4;
  const running = new Set<string>();
  const agentSlots = new Map<string, number>();
  const waitQueue = new Map<string, Array<() => void>>();
  const acquireSlot = async (handle: string): Promise<void> => {
    const n = agentSlots.get(handle) ?? 0;
    if (n < MAX_PARALLEL) { agentSlots.set(handle, n + 1); return; }
    await new Promise<void>((resolve) => {
      const q = waitQueue.get(handle) ?? [];
      q.push(resolve);
      waitQueue.set(handle, q);
    });
    agentSlots.set(handle, (agentSlots.get(handle) ?? 0) + 1);
  };
  const releaseSlot = (handle: string): void => {
    agentSlots.set(handle, Math.max(0, (agentSlots.get(handle) ?? 1) - 1));
    const q = waitQueue.get(handle);
    if (q && q.length) (q.shift())!();
  };

  const log = (s: string) => process.stdout.write(s + "\n");

  function connect() {
    if (stopped) return;
    ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      backoff = 1000;
      log(`🔌 已连接控制面 ${config.serverUrl}`);
      // 上报本机信息 (hostname/os/daemon 版本/已装 runtimes)
      void collectMachineHello()
        .then((hello) => {
          try {
            ws?.send(JSON.stringify(hello));
            log(`📤 已上报机器信息: ${hello.hostname} · ${hello.os} · runtimes=[${hello.runtimes.join(",")}]`);
          } catch { /* 非 OPEN,忽略 */ }
        })
        .catch(() => {});
      opts.onOpen?.(ws!);
    });

    ws.on("message", async (data) => {
      let msg: AgentStart | FsRequest;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      // 导入 raft agent 工作区:inspect 反填 name/description;import 复制用户内容
      if (msg.type === "raft:inspect" || msg.type === "raft:import") {
        const req = msg as FsRequest;
        const reply = (r: { ok: boolean; data?: unknown; error?: string }) => {
          try { ws?.send(JSON.stringify({ type: "fs:result", reqId: req.reqId, ...r })); } catch { /* 忽略 */ }
        };
        try {
          const data2 =
            req.type === "raft:inspect"
              ? await inspectRaftWorkspace(req.path)
              : await importRaftWorkspace(req.path, join(config.agentsRoot, req.handle));
          if (req.type === "raft:import") {
            log(`📦 已导入 raft 工作区 → ${req.handle}: 复制 ${(data2 as { copied: readonly string[] }).copied.length} 项`);
          }
          reply({ ok: true, data: data2 });
        } catch (e) {
          reply({ ok: false, error: (e as Error).message });
        }
        return;
      }

      // workspace 文件浏览 / skills 枚举请求 (只读、沙箱;见 workspace-fs.ts / skills.ts)
      if (msg.type === "fs:list" || msg.type === "fs:read" || msg.type === "skills:list") {
        const req = msg as FsRequest;
        const root = join(config.agentsRoot, req.handle);
        const reply = (r: { ok: boolean; data?: unknown; error?: string }) => {
          try { ws?.send(JSON.stringify({ type: "fs:result", reqId: req.reqId, ...r })); } catch { /* 忽略 */ }
        };
        try {
          const data2 =
            req.type === "fs:list" ? await listWorkspace(root, req.path)
            : req.type === "fs:read" ? await readWorkspaceFile(root, req.path)
            : await listSkills(config.agentsRoot, req.handle);
          reply({ ok: true, data: data2 });
        } catch (e) {
          reply({ ok: false, error: (e as Error).message });
        }
        return;
      }

      if (msg.type !== "agent:start") return; // ready/error 等忽略

      // 任务键 = 线程锚点(≈任务)优先,否则频道。同一 agent 的不同任务可并行;同一任务重复唤醒才跳过。
      const threadId = msg.wake?.threadId;
      const taskKey = threadId ?? msg.channelId;
      const key = `${msg.agentHandle}:${taskKey}`;
      if (running.has(key)) {
        log(`↩︎ 跳过(该任务已在运行): ${key}`);
        return;
      }
      running.add(key);
      // 并行槽:同 agent 超过 MAX_PARALLEL 个任务时在此排队(不丢),有空位再跑。
      await acquireSlot(msg.agentHandle);
      const threadCode = threadId ? threadId.slice(0, 8) : null;
      const from = msg.wake?.senderHandle ?? "?";
      const incoming = msg.wake?.content ?? "";
      log(`\n${"─".repeat(56)}`);
      log(`🔔 唤醒 agent=${msg.agentHandle}  reason=${msg.reason ?? "?"}`);
      log(`   channel = ${msg.channelId}`);
      log(`   thread  = ${threadCode ? `${threadCode} (要求线程内回复)` : "(无,顶层回复)"}`);
      if (incoming) log(`📥 来信 @${from}: ${incoming.replace(/\s+/g, " ").slice(0, 200)}`);
      let actSeq = 0;
      const reportActivity = (a: { kind: string; label: string; detail?: string }) => {
        const det = a.detail ? a.detail.replace(/\s+/g, " ").trim() : "";
        // 发消息时尽量打印回复正文/目标(--content "..." 或 heredoc 首行)
        let line = `  · ${a.label}`;
        if (a.kind === "sending") {
          const m = det.match(/--content\s+"([^"]*)"/) || det.match(/<<'?\w+'?\s*(.*)/);
          line = `  💬 回复${threadCode ? `(thread ${threadCode})` : ""}: ${m ? m[1]!.slice(0, 160) : det.slice(0, 120)}`;
        } else if (det) {
          line += ` ${det.slice(0, 80)}`;
        }
        log(line);
        try {
          ws?.send(JSON.stringify({
            type: "agent:activity",
            agentHandle: msg.agentHandle,
            channelId: msg.channelId,
            activity: ACTIVITY_MAP[a.kind] ?? "working",
            detail: a.detail || a.label,
            seq: actSeq++,
          }));
        } catch { /* ws 非 OPEN,忽略 */ }
      };
      try {
        // 线程聚合:触发消息即任务线程根,你的确认+后续所有回复都要发到它的线程里,
        // 不要发顶层——这样 task 讨论全部聚合在该 thread 下。
        const threadHint = threadCode
          ? `\n**所有回复都必须发到这条消息的线程里**(任务线程):用 crew message send --channel ${msg.channelId} --thread ${threadCode} 发送,不要发频道顶层。`
          : "";
        // channel(广播投递):你是频道成员之一,自己判断是否与你职责相关——相关才行动(回复 /
        // crew task create / claim / 交接给下一棒),不相关就不回(频道沉默不算失败,避免人人都答)。
        const reasonHint = msg.reason === "channel"
          ? `\n这是频道里的新消息(广播给频道成员)。**先判断是否属于你的职责**:与你无关就直接结束、不要回复(频道沉默不算失败);相关才接手。`
          : "";
        // 关键协作礼仪:一旦决定接手,**第一步就先在频道发一句简短确认**
        // (例:"收到,我接 task #N。先做 X / 排查 Y,有结论再同步"),别让频道空着干等;
        // 然后再开始读日志/跑命令。干完用 @下一棒 或 crew task assign 交接。
        const sendCmd = threadCode
          ? `crew message send --channel ${msg.channelId} --thread ${threadCode}`
          : `crew message send --channel ${msg.channelId}`;
        const ackHint =
          `\n**协作礼仪:决定接手后,务必先用 \`${sendCmd}\` 在该任务线程发一句简短确认**(收到 + 我接 task #N + 接下来要做什么),再开始干活——不要闷头工作把线程空着。`;
        // 图片/文件附件:crew message read 会在消息下列出附件及其 id;图片需下载后用 Read 工具查看,才能真正"看到"内容。
        const attHint =
          `\n若消息带图片/文件附件(read 会列出 id),用 \`crew attachment get <id>\` 下载到本地,图片再用 Read 工具打开查看后再处理。`;
        await runAgent(config, {
          handle: msg.agentHandle,
          channelId: msg.channelId,
          taskKey, // 每任务隔离 cwd + work-log(并行不冲突)
          ...(msg.wake?.content ? { wake: `你被唤醒(${msg.reason}): ${msg.wake.content}\n用 crew message read --channel ${msg.channelId} 读频道后按需处理。${reasonHint}${ackHint}${threadHint}${attHint}` } : {}),
        }, reportActivity);
        reportActivity({ kind: "done", label: "本轮结束" });
        log(`✅ agent=${msg.agentHandle} 本轮完成`);
      } catch (e) {
        log(`❌ runAgent 失败: ${(e as Error).message}`);
      } finally {
        running.delete(key);
        releaseSlot(msg.agentHandle);
      }
    });

    ws.on("close", () => {
      if (stopped) return;
      log(`🔁 控制面断开,${Math.round(backoff / 1000)}s 后重连`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    });
    ws.on("error", () => ws?.close());
  }

  connect();
  return {
    stop: () => {
      stopped = true;
      ws?.close();
    },
  };
}
