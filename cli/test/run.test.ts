import { describe, it, expect, beforeEach } from "vitest";
import { run, type Io } from "../src/run.js";
import { EXIT } from "../src/exit.js";
import type { CrewClient, HttpResult } from "../src/client.js";

const okEnv = (data: unknown): HttpResult => ({ status: 200, ok: true, body: { success: true, data } });
const created = (data: unknown): HttpResult => ({ status: 201, ok: true, body: { success: true, data } });
const accepted = (data: unknown): HttpResult => ({ status: 202, ok: true, body: { success: true, data } });
const errEnv = (status: number, code: string, message = "x"): HttpResult => ({
  status, ok: false, body: { success: false, error: { code, message } },
});

/** 记录调用的假 client。 */
function fakeClient(overrides: Partial<Record<keyof CrewClient, (...a: never[]) => Promise<HttpResult>>> = {}) {
  const calls: Array<{ m: string; args: unknown[] }> = [];
  const rec = (m: string, def: HttpResult) =>
    async (...args: unknown[]) => {
      calls.push({ m, args });
      const o = (overrides as Record<string, (...a: unknown[]) => Promise<HttpResult>>)[m];
      return o ? o(...args) : def;
    };
  const client = {
    whoami: rec("whoami", okEnv({ tier: "agent", actor: { id: "cindy" } })),
    listMessages: rec("listMessages", okEnv([{ seq: 1, type: "human", sender: { type: "human", id: "alice" }, content: "hi" }])),
    markRead: rec("markRead", okEnv({ lastReadSeq: 1 })),
    sendMessage: rec("sendMessage", created({ kind: "sent", message: { seq: 2 } })),
    unread: rec("unread", okEnv({ unread: 3 })),
    claim: rec("claim", okEnv({ taskId: "t1", status: "in_progress" })),
    listTasks: rec("listTasks", okEnv([{ id: "t1", number: 1, status: "todo", title: "fix", assignee: null }])),
    createTask: rec("createTask", okEnv({ task: { id: "t1", number: 1 } })),
    unclaim: rec("unclaim", okEnv({ id: "t1", assignee: null, status: "todo" })),
    updateTaskStatus: rec("updateTaskStatus", okEnv({ id: "t1", status: "in_review" })),
    serverInfo: rec("serverInfo", okEnv({ channels: [], agents: [], humans: [] })),
    searchMessages: rec("searchMessages", okEnv([{ seq: 3, id: "abcdef1234", sender: { id: "alice" }, content: "hit" }])),
    resolveMessage: rec("resolveMessage", okEnv({ id: "abcdef12", seq: 3 })),
    scheduleReminder: rec("scheduleReminder", okEnv({ id: "r1", status: "scheduled" })),
    listReminders: rec("listReminders", okEnv([{ id: "r1", status: "scheduled", title: "ci", nextFireAt: "x" }])),
    snoozeReminder: rec("snoozeReminder", okEnv({ id: "r1", status: "snoozed" })),
    updateReminder: rec("updateReminder", okEnv({ id: "r1" })),
    cancelReminder: rec("cancelReminder", okEnv({ id: "r1", status: "cancelled" })),
    reminderLog: rec("reminderLog", okEnv([{ kind: "scheduled" }])),
    createTasksBatch: rec("createTasksBatch", created([{ id: "t1", number: 1 }, { id: "t2", number: 2 }])),
    prepareAction: rec("prepareAction", created({ id: "ac1", kind: "channel:create", status: "pending" })),
    listIntegrations: rec("listIntegrations", okEnv([{ integration: "gh" }, { integration: "gcloud" }])),
    loginIntegration: rec("loginIntegration", created({ integration: "gh", loggedIn: true })),
    logoutIntegration: rec("logoutIntegration", okEnv({ integration: "gh", loggedIn: false })),
    channelMembers: rec("channelMembers", okEnv([{ memberType: "agent", memberId: "cindy", role: "owner" }])),
    joinChannel: rec("joinChannel", okEnv({ id: "c1", slug: "build", joined: true })),
    leaveChannel: rec("leaveChannel", okEnv({ id: "c1", slug: "build", joined: false })),
    unfollowThread: rec("unfollowThread", okEnv({ unfollowed: true, threadId: "p1" })),
    followThread: rec("followThread", okEnv({ unfollowed: false, threadId: "p1" })),
  } as unknown as CrewClient;
  return { client, calls };
}

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (s) => out.push(s), err: (s) => err.push(s) };
  return { io, out, err };
}

describe("crew CLI dispatch", () => {
  let io: ReturnType<typeof makeIo>;
  beforeEach(() => { io = makeIo(); });

  it("whoami → 打印身份,退出 0", async () => {
    const { client } = fakeClient();
    const code = await run(["whoami"], { client, io: io.io });
    expect(code).toBe(EXIT.OK);
    expect(io.out.join("")).toContain("cindy");
  });

  it("task batch → stdin 逐行作为标题批量创建", async () => {
    const { client, calls } = fakeClient();
    const readStdin = async () => "子任务1\n子任务2\n\n子任务3\n";
    const code = await run(["task", "batch", "--channel", "c1", "--parent", "p1"], { client, io: io.io, readStdin });
    expect(code).toBe(EXIT.OK);
    const call = calls.find((c) => c.m === "createTasksBatch");
    expect(call?.args[0]).toBe("c1");
    expect(call?.args[1]).toEqual(["子任务1", "子任务2", "子任务3"]);
    expect(call?.args[2]).toBe("p1");
  });

  it("integration list/login → 调用接口", async () => {
    const { client, calls } = fakeClient();
    expect(await run(["integration", "list"], { client, io: io.io })).toBe(EXIT.OK);
    expect(io.out.join("")).toContain("gh");
    expect(await run(["integration", "login", "gh"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.some((c) => c.m === "loginIntegration" && c.args[0] === "gh")).toBe(true);
  });

  it("integration env → 打印隔离的凭证目录(读自身 env,不调服务端)", async () => {
    const { client } = fakeClient();
    const saved = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/agents/cindy/.home/.config";
    try {
      const code = await run(["integration", "env"], { client, io: io.io });
      expect(code).toBe(EXIT.OK);
      expect(io.out.join("\n")).toContain("XDG_CONFIG_HOME=/agents/cindy/.home/.config");
    } finally {
      if (saved === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = saved;
    }
  });

  it("action prepare → 解析 stdin JSON payload 传给接口", async () => {
    const { client, calls } = fakeClient();
    const readStdin = async () => '{"name":"new-chan"}';
    const code = await run(["action", "prepare", "channel:create", "--channel", "c1"], { client, io: io.io, readStdin });
    expect(code).toBe(EXIT.OK);
    const call = calls.find((c) => c.m === "prepareAction");
    expect(call?.args[0]).toBe("channel:create");
    expect(call?.args[1]).toEqual({ name: "new-chan" });
    expect(call?.args[2]).toBe("c1");
  });

  it("action prepare:非法 JSON → USAGE", async () => {
    const { client } = fakeClient();
    expect(await run(["action", "prepare", "channel:create"], { client, io: io.io, readStdin: async () => "{bad" })).toBe(EXIT.USAGE);
  });

  it("channel members → 列成员", async () => {
    const { client, calls } = fakeClient();
    const code = await run(["channel", "members", "c1"], { client, io: io.io });
    expect(code).toBe(EXIT.OK);
    expect(calls.find((c) => c.m === "channelMembers")?.args[0]).toBe("c1");
    expect(io.out.join("")).toContain("agent:cindy");
  });

  it("channel join / leave → 调用对应接口", async () => {
    const { client, calls } = fakeClient();
    expect(await run(["channel", "join", "c1"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.some((c) => c.m === "joinChannel" && c.args[0] === "c1")).toBe(true);
    expect(await run(["channel", "leave", "c1"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.some((c) => c.m === "leaveChannel" && c.args[0] === "c1")).toBe(true);
  });

  it("channel 缺 channelId → USAGE", async () => {
    const { client } = fakeClient();
    expect(await run(["channel", "members"], { client, io: io.io })).toBe(EXIT.USAGE);
  });

  it("thread unfollow / follow → 调用对应接口", async () => {
    const { client, calls } = fakeClient();
    expect(await run(["thread", "unfollow", "abcd1234"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.some((c) => c.m === "unfollowThread" && c.args[0] === "abcd1234")).toBe(true);
    expect(await run(["thread", "follow", "abcd1234"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.some((c) => c.m === "followThread")).toBe(true);
  });

  it("无参数 → 打印用法,退出 USAGE", async () => {
    const { client } = fakeClient();
    expect(await run([], { client, io: io.io })).toBe(EXIT.USAGE);
    expect(io.out.join("\n")).toContain("用法");
  });

  it("message read 渲染消息,并自动推进 freshness 游标 (markRead 到最大 seq)", async () => {
    const { client, calls } = fakeClient({
      listMessages: async () => okEnv([
        { seq: 4, id: "aaaa1111", type: "human", sender: { type: "human", id: "alice" }, content: "a" },
        { seq: 5, id: "bbbb2222", type: "agent", sender: { type: "agent", id: "cindy" }, content: "b" },
      ]),
    });
    const code = await run(["message", "read", "--channel", "c1"], { client, io: io.io });
    expect(code).toBe(EXIT.OK);
    expect(io.out.join("\n")).toContain("#5 (msg=bbbb2222) [agent] cindy: b");
    const mark = calls.find((c) => c.m === "markRead");
    expect(mark?.args).toEqual(["c1", 5]); // 推进到最大 seq
  });

  it("message read --no-advance 不推进游标", async () => {
    const { client, calls } = fakeClient();
    await run(["message", "read", "--channel", "c1", "--no-advance"], { client, io: io.io });
    expect(calls.some((c) => c.m === "markRead")).toBe(false);
  });

  it("message read --json 输出原始 JSON", async () => {
    const { client } = fakeClient();
    await run(["message", "read", "-c", "c1", "--json"], { client, io: io.io });
    expect(() => JSON.parse(io.out[0]!)).not.toThrow();
  });

  it("message read 缺 --channel → USAGE", async () => {
    const { client } = fakeClient();
    expect(await run(["message", "read"], { client, io: io.io })).toBe(EXIT.USAGE);
  });

  it("message send --content → sent,退出 0", async () => {
    const { client, calls } = fakeClient();
    const code = await run(["message", "send", "-c", "c1", "--content", "hi"], { client, io: io.io });
    expect(code).toBe(EXIT.OK);
    expect(calls.find((c) => c.m === "sendMessage")?.args[1]).toMatchObject({ content: "hi", force: false });
  });

  it("message send 从 stdin 读正文", async () => {
    const { client, calls } = fakeClient();
    await run(["message", "send", "-c", "c1"], { client, io: io.io, readStdin: async () => "  来自stdin  " });
    expect(calls.find((c) => c.m === "sendMessage")?.args[1]).toMatchObject({ content: "来自stdin" });
  });

  it("message send --send-draft 传 force=true", async () => {
    const { client, calls } = fakeClient();
    await run(["message", "send", "-c", "c1", "-m", "x", "--send-draft"], { client, io: io.io });
    expect(calls.find((c) => c.m === "sendMessage")?.args[1]).toMatchObject({ force: true });
  });

  it("message send 被 freshness hold (202 held) → 退出 0 并提示 draft", async () => {
    const { client } = fakeClient({ sendMessage: async () => accepted({ kind: "held", draftId: "d1", unseenCount: 2 }) });
    const code = await run(["message", "send", "-c", "c1", "-m", "x"], { client, io: io.io });
    expect(code).toBe(EXIT.OK);
    expect(io.out.join("")).toContain("held");
    expect(io.err.join("")).toContain("draft");
  });

  it("message send 缺正文 → USAGE", async () => {
    const { client } = fakeClient();
    expect(await run(["message", "send", "-c", "c1"], { client, io: io.io })).toBe(EXIT.USAGE);
  });

  it("message check → 打印未读数", async () => {
    const { client } = fakeClient();
    await run(["message", "check", "-c", "c1"], { client, io: io.io });
    expect(io.out.join("")).toContain("\"unread\":3");
  });

  it("task claim → claimed,退出 0", async () => {
    const { client, calls } = fakeClient();
    const code = await run(["task", "claim", "t1"], { client, io: io.io });
    expect(code).toBe(EXIT.OK);
    expect(calls.find((c) => c.m === "claim")?.args).toEqual(["t1"]);
  });

  it("task claim 缺 id → USAGE", async () => {
    const { client } = fakeClient();
    expect(await run(["task", "claim"], { client, io: io.io })).toBe(EXIT.USAGE);
  });

  it("task list 渲染任务板", async () => {
    const { client, calls } = fakeClient();
    const code = await run(["task", "list", "-c", "c1", "--status", "todo", "--mine"], { client, io: io.io });
    expect(code).toBe(EXIT.OK);
    expect(io.out.join("\n")).toContain("#1 [todo] fix");
    expect(calls.find((c) => c.m === "listTasks")?.args).toEqual(["c1", { status: "todo", mine: true }]);
  });

  it("task create 用 --title", async () => {
    const { client, calls } = fakeClient();
    expect(await run(["task", "create", "-c", "c1", "--title", "修登录"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.find((c) => c.m === "createTask")?.args).toEqual(["c1", "修登录"]);
  });

  it("task create 从 stdin 取标题", async () => {
    const { client, calls } = fakeClient();
    await run(["task", "create", "-c", "c1"], { client, io: io.io, readStdin: async () => " 标题 " });
    expect(calls.find((c) => c.m === "createTask")?.args).toEqual(["c1", "标题"]);
  });

  it("task create 缺标题 → USAGE", async () => {
    const { client } = fakeClient();
    expect(await run(["task", "create", "-c", "c1"], { client, io: io.io })).toBe(EXIT.USAGE);
  });

  it("task unclaim", async () => {
    const { client, calls } = fakeClient();
    expect(await run(["task", "unclaim", "t1"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.find((c) => c.m === "unclaim")?.args).toEqual(["t1"]);
  });

  it("task update --status", async () => {
    const { client, calls } = fakeClient();
    expect(await run(["task", "update", "t1", "--status", "in_review"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.find((c) => c.m === "updateTaskStatus")?.args).toEqual(["t1", "in_review"]);
  });

  it("task update 缺 status → USAGE", async () => {
    const { client } = fakeClient();
    expect(await run(["task", "update", "t1"], { client, io: io.io })).toBe(EXIT.USAGE);
  });

  // ---- P3/P5 命令 ----
  it("server info", async () => {
    const { client } = fakeClient();
    expect(await run(["server", "info"], { client, io: io.io })).toBe(EXIT.OK);
  });

  it("search <kw> 渲染命中 (含 msg 短码)", async () => {
    const { client, calls } = fakeClient();
    await run(["search", "超时", "--limit", "5"], { client, io: io.io });
    expect(calls.find((c) => c.m === "searchMessages")?.args).toEqual(["超时", { limit: 5 }]);
    expect(io.out.join("\n")).toContain("msg=abcdef12");
  });

  it("resolve <id>", async () => {
    const { client, calls } = fakeClient();
    expect(await run(["resolve", "abcdef12"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.find((c) => c.m === "resolveMessage")?.args).toEqual(["abcdef12"]);
  });

  it("reminder schedule --in", async () => {
    const { client, calls } = fakeClient();
    expect(await run(["reminder", "schedule", "--title", "看CI", "--in", "5m", "--channel", "c1"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.find((c) => c.m === "scheduleReminder")?.args[0]).toMatchObject({ title: "看CI", in: "5m", channel: "c1" });
  });

  it("reminder schedule 缺 title → USAGE", async () => {
    const { client } = fakeClient();
    expect(await run(["reminder", "schedule", "--in", "5m"], { client, io: io.io })).toBe(EXIT.USAGE);
  });

  it("reminder list / snooze / cancel / log", async () => {
    const { client, calls } = fakeClient();
    expect(await run(["reminder", "list"], { client, io: io.io })).toBe(EXIT.OK);
    expect(await run(["reminder", "snooze", "r1", "--in", "1h"], { client, io: io.io })).toBe(EXIT.OK);
    expect(await run(["reminder", "cancel", "r1"], { client, io: io.io })).toBe(EXIT.OK);
    expect(await run(["reminder", "log", "r1"], { client, io: io.io })).toBe(EXIT.OK);
    expect(calls.find((c) => c.m === "snoozeReminder")?.args).toEqual(["r1", "1h"]);
  });

  it("reminder snooze 缺 --in → USAGE", async () => {
    const { client } = fakeClient();
    expect(await run(["reminder", "snooze", "r1"], { client, io: io.io })).toBe(EXIT.USAGE);
  });

  it("attachment get → 下载落盘到 --out,图片提示用 Read 查看", async () => {
    const writes: Array<{ path: string; len: number }> = [];
    const client = {
      downloadAttachment: async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3, 4]), mime: "image/png", filename: "shot.png" }),
    } as unknown as CrewClient;
    const writeFile = async (path: string, data: Uint8Array) => { writes.push({ path, len: data.length }); };
    const code = await run(["attachment", "get", "att123", "--out", "/tmp/x.png"], { client, io: io.io, writeFile });
    expect(code).toBe(EXIT.OK);
    expect(writes[0]).toEqual({ path: "/tmp/x.png", len: 4 });
    expect(io.out.join("\n")).toContain("Read");
  });

  it("attachment get 缺 id → USAGE", async () => {
    const client = {} as unknown as CrewClient;
    expect(await run(["attachment", "get"], { client, io: io.io })).toBe(EXIT.USAGE);
  });

  it("message read 列出图片附件 + crew attachment get 提示", async () => {
    const { client } = fakeClient({
      listMessages: async () => okEnv([
        { seq: 1, id: "m1abc", type: "human", sender: { id: "alice" }, content: "看图",
          attachments: [{ id: "att9", filename: "shot.png", mime: "image/png", size: 1234 }] },
      ]),
    });
    expect(await run(["message", "read", "-c", "c1"], { client, io: io.io })).toBe(EXIT.OK);
    const out = io.out.join("\n");
    expect(out).toContain("shot.png");
    expect(out).toContain("crew attachment get att9");
  });
});

describe("crew CLI 错误 → 退出码映射", () => {
  let io: ReturnType<typeof makeIo>;
  beforeEach(() => { io = makeIo(); });

  it("claim 冲突 → CONFLICT(4),agent 应停手", async () => {
    const { client } = fakeClient({ claim: async () => errEnv(409, "CLAIM_CONFLICT") });
    expect(await run(["task", "claim", "t1"], { client, io: io.io })).toBe(EXIT.CONFLICT);
  });

  it("claim 被 freshness hold → FRESHNESS(6),应先重读", async () => {
    const { client } = fakeClient({ claim: async () => errEnv(409, "FRESHNESS_HOLD") });
    expect(await run(["task", "claim", "t1"], { client, io: io.io })).toBe(EXIT.FRESHNESS);
  });

  it("claim system 任务 → CONFLICT(4)", async () => {
    const { client } = fakeClient({ claim: async () => errEnv(422, "NOT_CLAIMABLE") });
    expect(await run(["task", "claim", "t1"], { client, io: io.io })).toBe(EXIT.CONFLICT);
  });

  it("claim 不存在 → NOT_FOUND(5)", async () => {
    const { client } = fakeClient({ claim: async () => errEnv(404, "NOT_FOUND") });
    expect(await run(["task", "claim", "t1"], { client, io: io.io })).toBe(EXIT.NOT_FOUND);
  });

  it("鉴权失败 → AUTH(3)", async () => {
    const { client } = fakeClient({ whoami: async () => errEnv(401, "UNAUTHENTICATED") });
    expect(await run(["whoami"], { client, io: io.io })).toBe(EXIT.AUTH);
  });
});
