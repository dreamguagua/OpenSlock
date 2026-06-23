/**
 * CLI 分发器。io 与 client 均注入,返回退出码 (纯逻辑,便于单测)。
 * 一个进程只跑一个 crew 命令 (符合"读完输出再决定下一步"的约束)。
 */

import { parseArgs } from "node:util";
import { writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrewClient, HttpResult } from "./client.js";
import { EXIT, exitForError, type ExitCode } from "./exit.js";

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

export interface RunDeps {
  client: CrewClient;
  io: Io;
  readStdin?: () => Promise<string>;
  /** 写文件(默认 node:fs/promises.writeFile;可注入便于测试)。 */
  writeFile?: (path: string, data: Uint8Array) => Promise<void>;
}

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

const USAGE = `crew —— agent 与 OpenSlock 协作的命令行 (经 Bash 调用)
用法:
  crew whoami
  crew message read   --channel <id> [--after <seq>] [--limit <n>] [--no-advance] [--json]
  crew message send   --channel <id> [--content <text> | (stdin)] [--thread <msgId>] [--send-draft]
  crew message check  --channel <id>
  crew attachment get <id> [--out <path>]   下载附件(图片/文件)到本地;图片可用 Read 工具查看
  crew task list      --channel <id> [--status <s>] [--mine] [--json]
  crew task create    --channel <id> [--title <t> | (stdin)]
  crew task batch     --channel <id> [--parent <taskId>]   (标题逐行从 stdin 读,任务拆分)
  crew task claim     <taskId>
  crew task unclaim   <taskId>
  crew task assign    <taskId> --to <handle>
  crew task update    <taskId> --status <todo|in_progress|in_review|done>
  crew server info
  crew channel members <channelId> [--json]
  crew channel join   <channelId>
  crew channel leave  <channelId>
  crew integration list | login <name> | logout <name> | env
  crew action prepare <channel:create|agent:create>   (payload JSON 从 stdin)
  crew thread unfollow <thread短码|msgId>
  crew thread follow   <thread短码|msgId>

  crew search <关键词> [--channel <id>] [--limit <n>] [--json]
  crew resolve <msgId|短码>
  crew reminder schedule --title <t> (--in <dur> | --at <ISO> | --cron <expr>) [--channel <id>]
  crew reminder list | snooze <id> --in <dur> | update <id> ... | cancel <id> | log <id>
环境:  CREW_SERVER_URL (默认 http://127.0.0.1:3000)   CREW_TOKEN (sk_agent_*)`;

function env(body: unknown): Envelope {
  return (body && typeof body === "object" ? body : {}) as Envelope;
}

/** 处理一个 HTTP 结果:成功回调返回码;失败统一打印并映射退出码。 */
function handle(io: Io, r: HttpResult, onOk: (data: unknown) => ExitCode): ExitCode {
  const b = env(r.body);
  if (r.ok && b.success) return onOk(b.data);
  const code = b.error?.code;
  io.err(`错误 [${code ?? r.status}] ${b.error?.message ?? "请求失败"}`);
  return exitForError(r.status, code);
}

export async function run(argv: string[], deps: RunDeps): Promise<ExitCode> {
  const { client, io } = deps;
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        channel: { type: "string", short: "c" },
        after: { type: "string" },
        limit: { type: "string" },
        content: { type: "string", short: "m" },
        thread: { type: "string" },
        title: { type: "string" },
        status: { type: "string" },
        to: { type: "string" },
        parent: { type: "string" },
        query: { type: "string", short: "q" },
        at: { type: "string" },
        in: { type: "string" },
        cron: { type: "string" },
        out: { type: "string" },
        mine: { type: "boolean" },
        "send-draft": { type: "boolean" },
        "no-advance": { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    io.err((e as Error).message);
    io.out(USAGE);
    return EXIT.USAGE;
  }

  const [group, verb, arg3] = parsed.positionals;
  const o = parsed.values;

  if (o.help || !group) {
    io.out(USAGE);
    return group ? EXIT.OK : EXIT.USAGE;
  }

  const needChannel = (): string | null => {
    const c = o.channel ?? process.env.CREW_CHANNEL;
    if (!c) {
      io.err("缺少 --channel <id>");
      return null;
    }
    return c;
  };

  // ---- whoami ----
  if (group === "whoami") {
    return handle(io, await client.whoami(), (d) => {
      io.out(JSON.stringify(d));
      return EXIT.OK;
    });
  }

  // ---- message ----
  if (group === "message") {
    const channel = needChannel();
    if (!channel) return EXIT.USAGE;

    if (verb === "read") {
      const r = await client.listMessages(channel, {
        ...(o.after != null ? { after: Number(o.after) } : {}),
        ...(o.limit != null ? { limit: Number(o.limit) } : {}),
      });
      const code = handle(io, r, (data) => {
        const msgs = (data as Array<Record<string, unknown>>) ?? [];
        if (o.json) {
          io.out(JSON.stringify(msgs));
        } else if (msgs.length === 0) {
          io.out("(无消息)");
        } else {
          for (const m of msgs) {
            const sender = (m.sender as { id?: string } | undefined)?.id ?? "?";
            const short = String(m.id).slice(0, 8);
            io.out(`#${m.seq} (msg=${short}) [${m.type}] ${sender}: ${m.content}`);
            // 附件:列出每个附件,图片提示用 `crew attachment get` 下载后查看(送达底层模型)
            const atts = (m.attachments as Array<Record<string, unknown>> | undefined) ?? [];
            for (const a of atts) {
              const mime = String(a.mime ?? "");
              const isImg = mime.startsWith("image/");
              io.out(
                `    ${isImg ? "🖼" : "📎"} ${a.filename} (${mime}, ${a.size}B) ` +
                `→ crew attachment get ${a.id}${isImg ? " 然后查看该图片" : ""}`,
              );
            }
          }
        }
        return EXIT.OK;
      });
      // 读到即推进 freshness 游标 (除非 --no-advance)
      if (code === EXIT.OK && !o["no-advance"]) {
        const msgs = (env(r.body).data as Array<{ seq: number }>) ?? [];
        const max = msgs.reduce((mx, m) => Math.max(mx, m.seq), 0);
        if (max > 0) await client.markRead(channel, max);
      }
      return code;
    }

    if (verb === "send") {
      let content = o.content;
      if (content == null && deps.readStdin) content = (await deps.readStdin()).trim();
      if (!content) {
        io.err("缺少消息正文 (--content 或 stdin)");
        return EXIT.USAGE;
      }
      const r = await client.sendMessage(channel, {
        content,
        ...(o.thread ? { thread: o.thread } : {}),
        force: o["send-draft"] ?? false,
      });
      return handle(io, r, (d) => {
        io.out(JSON.stringify(d));
        const kind = (d as { kind?: string }).kind;
        if (kind === "held") {
          io.err("freshness hold:已存为 draft,请先 `crew message read` 再重发,或加 --send-draft");
        }
        return EXIT.OK;
      });
    }

    if (verb === "check") {
      return handle(io, await client.unread(channel), (d) => {
        io.out(JSON.stringify(d));
        return EXIT.OK;
      });
    }

    io.err(`未知 message 子命令: ${verb ?? "(空)"}`);
    return EXIT.USAGE;
  }

  // ---- message search / resolve (不强制 --channel) ----
  if (group === "search") {
    const query = o.query ?? verb; // `crew search <kw>` 或 `crew search --query <kw>`
    if (!query) { io.err("用法: crew search <关键词> [--channel <id>] [--limit <n>]"); return EXIT.USAGE; }
    const r = await client.searchMessages(query, {
      ...(o.channel ? { channel: o.channel } : {}),
      ...(o.limit != null ? { limit: Number(o.limit) } : {}),
    });
    return handle(io, r, (data) => {
      const rows = (data as Array<Record<string, unknown>>) ?? [];
      if (o.json) io.out(JSON.stringify(rows));
      else if (rows.length === 0) io.out("(无匹配)");
      else for (const m of rows) io.out(`#${m.seq} (msg=${String(m.id).slice(0, 8)}) ${(m.sender as { id?: string })?.id ?? "?"}: ${m.content}`);
      return EXIT.OK;
    });
  }

  if (group === "resolve") {
    const target = verb;
    if (!target) { io.err("用法: crew resolve <msgId|短码>"); return EXIT.USAGE; }
    return handle(io, await client.resolveMessage(target), (d) => {
      io.out(JSON.stringify(d));
      return EXIT.OK;
    });
  }

  // ---- channel members / join / leave ----
  if (group === "channel") {
    const cid = arg3 ?? o.channel ?? process.env.CREW_CHANNEL;
    if (!cid) { io.err(`用法: crew channel ${verb ?? "<members|join|leave>"} <channelId>`); return EXIT.USAGE; }
    if (verb === "members") {
      return handle(io, await client.channelMembers(cid), (data) => {
        const rows = (data as Array<Record<string, unknown>>) ?? [];
        if (o.json) io.out(JSON.stringify(rows));
        else if (rows.length === 0) io.out("(无成员)");
        else for (const m of rows) io.out(`${m.memberType}:${m.memberId} (${m.role})`);
        return EXIT.OK;
      });
    }
    if (verb === "join") return handle(io, await client.joinChannel(cid), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    if (verb === "leave") return handle(io, await client.leaveChannel(cid), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    io.err(`未知 channel 子命令: ${verb ?? "(空)"}`);
    return EXIT.USAGE;
  }

  // ---- integration list / login / logout / env ----
  if (group === "integration") {
    if (verb === "env") {
      // 报告 daemon 为本 agent 隔离的凭证目录(各三方 CLI 把 token 存这里,互不串号)
      const e = process.env;
      const paths = {
        XDG_CONFIG_HOME: e.XDG_CONFIG_HOME ?? "(未隔离)",
        XDG_DATA_HOME: e.XDG_DATA_HOME ?? "(未隔离)",
        GH_CONFIG_DIR: e.GH_CONFIG_DIR ?? "(未隔离)",
        CLOUDSDK_CONFIG: e.CLOUDSDK_CONFIG ?? "(未隔离)",
      };
      if (o.json) io.out(JSON.stringify(paths));
      else for (const [k, v] of Object.entries(paths)) io.out(`${k}=${v}`);
      return EXIT.OK;
    }
    if (verb === "list") {
      return handle(io, await client.listIntegrations(), (data) => {
        const rows = (data as Array<{ integration: string }>) ?? [];
        if (o.json) io.out(JSON.stringify(rows));
        else if (rows.length === 0) io.out("(未登录任何集成)");
        else for (const r of rows) io.out(`✓ ${r.integration}`);
        return EXIT.OK;
      });
    }
    if (verb === "login") {
      if (!arg3) { io.err("用法: crew integration login <name>(在隔离环境里自行跑该工具的登录,如 gh auth login)"); return EXIT.USAGE; }
      return handle(io, await client.loginIntegration(arg3), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    }
    if (verb === "logout") {
      if (!arg3) { io.err("用法: crew integration logout <name>"); return EXIT.USAGE; }
      return handle(io, await client.logoutIntegration(arg3), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    }
    io.err(`未知 integration 子命令: ${verb ?? "(空)"}`);
    return EXIT.USAGE;
  }

  // ---- action prepare ----(payload 以 JSON 从 stdin 读)
  if (group === "action") {
    if (verb === "prepare") {
      const kind = arg3;
      if (!kind) { io.err("用法: crew action prepare <channel:create|agent:create>  (payload JSON 从 stdin)"); return EXIT.USAGE; }
      const raw = deps.readStdin ? (await deps.readStdin()).trim() : "";
      let payload: unknown;
      try { payload = raw ? JSON.parse(raw) : {}; }
      catch { io.err("payload 不是合法 JSON"); return EXIT.USAGE; }
      return handle(io, await client.prepareAction(kind, payload, o.channel), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    }
    io.err(`未知 action 子命令: ${verb ?? "(空)"}`);
    return EXIT.USAGE;
  }

  // ---- thread unfollow / follow ----
  if (group === "thread") {
    const tid = arg3;
    if (!tid) { io.err("用法: crew thread <unfollow|follow> <thread短码|msgId>"); return EXIT.USAGE; }
    if (verb === "unfollow") return handle(io, await client.unfollowThread(tid), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    if (verb === "follow") return handle(io, await client.followThread(tid), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    io.err(`未知 thread 子命令: ${verb ?? "(空)"}`);
    return EXIT.USAGE;
  }

  // ---- attachment get(下载附件落盘,图片让 agent 用 Read 工具查看 → 送达底层模型)----
  if (group === "attachment") {
    if (verb === "get") {
      const id = arg3;
      if (!id) { io.err("用法: crew attachment get <附件id> [--out <路径>]"); return EXIT.USAGE; }
      const r = await client.downloadAttachment(id);
      if (!r.ok) { io.err(`错误 [${r.status}] 下载附件失败: ${r.error}`); return exitForError(r.status); }
      const safe = r.filename.replace(/[^\w.\-]+/g, "_") || id.slice(0, 8);
      const out = o.out ?? join(tmpdir(), `crew-att-${id.slice(0, 8)}-${safe}`);
      await (deps.writeFile ?? fsWriteFile)(out, r.bytes);
      io.out(`已下载 ${r.filename} (${r.mime}, ${r.bytes.length}B) → ${out}`);
      if (r.mime.startsWith("image/")) io.out(`这是一张图片,用 Read 工具查看该文件即可:${out}`);
      return EXIT.OK;
    }
    io.err(`未知 attachment 子命令: ${verb ?? "(空)"}`);
    return EXIT.USAGE;
  }

  // ---- server info ----
  if (group === "server" && verb === "info") {
    return handle(io, await client.serverInfo(), (d) => {
      io.out(JSON.stringify(d, null, 2));
      return EXIT.OK;
    });
  }

  // ---- reminders ----
  if (group === "reminder") {
    if (verb === "schedule") {
      if (!o.title) { io.err("用法: crew reminder schedule --title <t> (--in <dur> | --at <ISO> | --cron <expr>) [--channel <id>]"); return EXIT.USAGE; }
      return handle(io, await client.scheduleReminder({
        title: o.title,
        ...(o.in ? { in: o.in } : {}),
        ...(o.at ? { at: o.at } : {}),
        ...(o.cron ? { cron: o.cron } : {}),
        ...(o.channel ? { channel: o.channel } : {}),
      }), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    }
    if (verb === "list") {
      return handle(io, await client.listReminders(), (data) => {
        const rows = (data as Array<Record<string, unknown>>) ?? [];
        if (o.json) io.out(JSON.stringify(rows));
        else if (rows.length === 0) io.out("(无提醒)");
        else for (const r of rows) io.out(`[${r.status}] ${r.title}  next=${r.nextFireAt ?? "-"}  (id=${r.id})`);
        return EXIT.OK;
      });
    }
    if (verb === "snooze") {
      if (!arg3 || !o.in) { io.err("用法: crew reminder snooze <id> --in <dur>"); return EXIT.USAGE; }
      return handle(io, await client.snoozeReminder(arg3, o.in), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    }
    if (verb === "update") {
      if (!arg3) { io.err("用法: crew reminder update <id> [--title][--in][--at][--cron]"); return EXIT.USAGE; }
      return handle(io, await client.updateReminder(arg3, {
        ...(o.title ? { title: o.title } : {}),
        ...(o.in ? { in: o.in } : {}),
        ...(o.at ? { at: o.at } : {}),
        ...(o.cron ? { cron: o.cron } : {}),
      }), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    }
    if (verb === "cancel") {
      if (!arg3) { io.err("用法: crew reminder cancel <id>"); return EXIT.USAGE; }
      return handle(io, await client.cancelReminder(arg3), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    }
    if (verb === "log") {
      if (!arg3) { io.err("用法: crew reminder log <id>"); return EXIT.USAGE; }
      return handle(io, await client.reminderLog(arg3), (d) => { io.out(JSON.stringify(d)); return EXIT.OK; });
    }
    io.err(`未知 reminder 子命令: ${verb ?? "(空)"}`);
    return EXIT.USAGE;
  }

  // ---- task ----
  if (group === "task") {
    if (verb === "claim") {
      if (!arg3) { io.err("用法: crew task claim <taskId>"); return EXIT.USAGE; }
      return handle(io, await client.claim(arg3), (d) => {
        io.out(JSON.stringify(d));
        return EXIT.OK;
      });
    }

    if (verb === "list") {
      const channel = needChannel();
      if (!channel) return EXIT.USAGE;
      const r = await client.listTasks(channel, {
        ...(o.status ? { status: o.status } : {}),
        ...(o.mine ? { mine: true } : {}),
      });
      return handle(io, r, (data) => {
        const rows = (data as Array<Record<string, unknown>>) ?? [];
        if (o.json) {
          io.out(JSON.stringify(rows));
        } else if (rows.length === 0) {
          io.out("(无任务)");
        } else {
          for (const t of rows) {
            const who = t.assignee ? `→ ${(t.assignee as { id: string }).id}` : "未认领";
            io.out(`#${t.number} [${t.status}] ${t.title}  ${who}  (id=${t.id})`);
          }
        }
        return EXIT.OK;
      });
    }

    if (verb === "create") {
      const channel = needChannel();
      if (!channel) return EXIT.USAGE;
      let title = o.title ?? o.content;
      if (title == null && deps.readStdin) title = (await deps.readStdin()).trim();
      if (!title) { io.err("缺少任务标题 (--title 或 stdin)"); return EXIT.USAGE; }
      return handle(io, await client.createTask(channel, title), (d) => {
        io.out(JSON.stringify(d));
        return EXIT.OK;
      });
    }

    if (verb === "batch") {
      const channel = needChannel();
      if (!channel) return EXIT.USAGE;
      const raw = deps.readStdin ? await deps.readStdin() : "";
      const titles = raw.split("\n").map((s) => s.trim()).filter(Boolean);
      if (titles.length === 0) { io.err("批量任务标题从 stdin 逐行读入,每行一个"); return EXIT.USAGE; }
      return handle(io, await client.createTasksBatch(channel, titles, o.parent), (d) => {
        io.out(JSON.stringify(d));
        return EXIT.OK;
      });
    }

    if (verb === "unclaim") {
      if (!arg3) { io.err("用法: crew task unclaim <taskId>"); return EXIT.USAGE; }
      return handle(io, await client.unclaim(arg3), (d) => {
        io.out(JSON.stringify(d));
        return EXIT.OK;
      });
    }

    if (verb === "update" || verb === "status") {
      if (!arg3 || !o.status) {
        io.err("用法: crew task update <taskId> --status <todo|in_progress|in_review|done>");
        return EXIT.USAGE;
      }
      return handle(io, await client.updateTaskStatus(arg3, o.status), (d) => {
        io.out(JSON.stringify(d));
        return EXIT.OK;
      });
    }

    if (verb === "assign") {
      if (!arg3 || !o.to) {
        io.err("用法: crew task assign <taskId> --to <handle>");
        return EXIT.USAGE;
      }
      return handle(io, await client.assign(arg3, o.to), (d) => {
        io.out(JSON.stringify(d));
        return EXIT.OK;
      });
    }

    io.err(`未知 task 子命令: ${verb ?? "(空)"}`);
    return EXIT.USAGE;
  }

  io.err(`未知命令: ${group}`);
  io.out(USAGE);
  return EXIT.USAGE;
}
