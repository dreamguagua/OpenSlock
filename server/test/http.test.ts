import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { createMemoryRepos, type MemoryRepos } from "../src/repo/memory/store.js";
import { RealtimeBus } from "../src/realtime/bus.js";
import { DaemonHub, type FsRequestMessage, type FsResult } from "../src/realtime/daemon-hub.js";
import { MemoryBlobStore } from "../src/storage/blob-store.js";
import type { Principal } from "../src/auth/service.js";

// 假 token 解析器 (不连库),覆盖三层凭证与跨租户
const PRINCIPALS: Record<string, Principal> = {
  "agent-tok": { workspaceId: "ws1", tier: "agent", actor: { type: "agent", id: "cindy" } },
  "agent2-tok": { workspaceId: "ws1", tier: "agent", actor: { type: "agent", id: "dave" } },
  "user-tok": { workspaceId: "ws1", tier: "user", actor: { type: "human", id: "alice" } },
  "agentB-tok": { workspaceId: "ws2", tier: "agent", actor: { type: "agent", id: "zoe" } },
};
const resolveToken = async (t: string) => PRINCIPALS[t] ?? null;

const auth = (tok: string) => ({ authorization: `Bearer ${tok}` });

describe("HTTP API (fastify.inject, 内存仓储)", () => {
  let app: FastifyInstance;
  let repos: MemoryRepos;

  beforeEach(async () => {
    repos = createMemoryRepos();
    let mintN = 0;
    const mint = async () => `sk_machine_${"deadbeef".repeat(8)}_${++mintN}`;
    app = await buildApp({ repos, resolveToken, bus: new RealtimeBus(), mint, store: new MemoryBlobStore() });
  });

  // ---- 健康 & 鉴权 ----
  it("GET /health → 200", async () => {
    const r = await app.inject({ method: "GET", url: "/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ success: true, data: { status: "ok" } });
  });

  it("缺少 token → 401", async () => {
    const r = await app.inject({ method: "GET", url: "/agent/whoami" });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("无效 token → 401", async () => {
    const r = await app.inject({ method: "GET", url: "/agent/whoami", headers: auth("bogus") });
    expect(r.statusCode).toBe(401);
  });

  it("用 user token 访问 agent 路由 → 403 (层级不符)", async () => {
    const r = await app.inject({ method: "GET", url: "/agent/whoami", headers: auth("user-tok") });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("FORBIDDEN");
  });

  it("agent whoami 返回身份", async () => {
    const r = await app.inject({ method: "GET", url: "/agent/whoami", headers: auth("agent-tok") });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ workspaceId: "ws1", tier: "agent", actor: { id: "cindy" } });
  });

  // ---- web 发消息 + agent 读 ----
  it("web 人类发消息 → 201,agent 可读到", async () => {
    const send = await app.inject({
      method: "POST", url: "/api/channels/c1/messages",
      headers: auth("user-tok"), payload: { content: "hello" },
    });
    expect(send.statusCode).toBe(201);
    expect(send.json().data.seq).toBe(1);

    const list = await app.inject({
      method: "GET", url: "/agent/channels/c1/messages", headers: auth("agent-tok"),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
  });

  // ---- 消息表情反应 ----
  it("表情反应:加 → 消息带聚合(count+mine);再加同 emoji 幂等", async () => {
    const send = await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "react me" } });
    const mid = send.json().data.id;

    const add = await app.inject({ method: "POST", url: `/api/channels/c1/messages/${mid}/reactions`, headers: auth("user-tok"), payload: { emoji: "👍" } });
    expect(add.statusCode).toBe(201);
    // 同一人重复加 → 幂等(不报错、不翻倍)
    await app.inject({ method: "POST", url: `/api/channels/c1/messages/${mid}/reactions`, headers: auth("user-tok"), payload: { emoji: "👍" } });

    const list = await app.inject({ method: "GET", url: "/api/channels/c1/messages", headers: auth("user-tok") });
    const msg = list.json().data.find((m: { id: string }) => m.id === mid);
    expect(msg.reactions).toEqual([{ emoji: "👍", count: 1, mine: true }]);
  });

  it("表情反应:不同 actor 同 emoji → count 累加,viewer 视角 mine 各异", async () => {
    const send = await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "x" } });
    const mid = send.json().data.id;
    await app.inject({ method: "POST", url: `/api/channels/c1/messages/${mid}/reactions`, headers: auth("user-tok"), payload: { emoji: "🎉" } });
    await app.inject({ method: "POST", url: `/agent/channels/c1/messages/${mid}/reactions`, headers: auth("agent-tok"), payload: { emoji: "🎉" } });

    // human 视角:count=2, mine=true
    const asHuman = await app.inject({ method: "GET", url: "/api/channels/c1/messages", headers: auth("user-tok") });
    expect(asHuman.json().data.find((m: { id: string }) => m.id === mid).reactions).toEqual([{ emoji: "🎉", count: 2, mine: true }]);
    // agent 视角:count=2, mine=true(agent 也反应过)
    const asAgent = await app.inject({ method: "GET", url: "/agent/channels/c1/messages", headers: auth("agent-tok") });
    const am = asAgent.json().data.find((m: { id: string }) => m.id === mid);
    if (am?.reactions) expect(am.reactions).toEqual([{ emoji: "🎉", count: 2, mine: true }]);
  });

  it("表情反应:移除 → 聚合里消失", async () => {
    const send = await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "y" } });
    const mid = send.json().data.id;
    await app.inject({ method: "POST", url: `/api/channels/c1/messages/${mid}/reactions`, headers: auth("user-tok"), payload: { emoji: "❤️" } });
    const del = await app.inject({ method: "DELETE", url: `/api/channels/c1/messages/${mid}/reactions/${encodeURIComponent("❤️")}`, headers: auth("user-tok") });
    expect(del.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/channels/c1/messages", headers: auth("user-tok") });
    expect(list.json().data.find((m: { id: string }) => m.id === mid).reactions).toEqual([]);
  });

  // ---- 附件上传/下载 ----
  const multipart = (filename: string, mime: string, content: string) => {
    const boundary = "----crewtestboundary";
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--\r\n`;
    return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body };
  };

  it("附件:上传 → 消息带 attachments;下载取回原字节", async () => {
    const send = await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "with file" } });
    const mid = send.json().data.id;

    const mp = multipart("note.txt", "text/plain", "hello world");
    const up = await app.inject({
      method: "POST", url: `/api/channels/c1/messages/${mid}/attachments`,
      headers: { ...auth("user-tok"), ...mp.headers }, payload: mp.payload,
    });
    expect(up.statusCode).toBe(201);
    const att = up.json().data;
    expect(att).toMatchObject({ filename: "note.txt", mime: "text/plain", size: 11 });
    expect(att.url).toBe(`/api/attachments/${att.id}/download`);

    // 消息 GET 合并 attachments
    const list = await app.inject({ method: "GET", url: "/api/channels/c1/messages", headers: auth("user-tok") });
    const msg = list.json().data.find((m: { id: string }) => m.id === mid);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe("note.txt");

    // 下载取回原字节
    const dl = await app.inject({ method: "GET", url: `/api/attachments/${att.id}/download`, headers: auth("user-tok") });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe("hello world");
    expect(dl.headers["content-type"]).toContain("text/plain");
  });

  it("附件:跨租户下载隔离 → 404", async () => {
    const send = await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "x" } });
    const mid = send.json().data.id;
    const mp = multipart("secret.txt", "text/plain", "ws1 only");
    const up = await app.inject({ method: "POST", url: `/api/channels/c1/messages/${mid}/attachments`, headers: { ...auth("user-tok"), ...mp.headers }, payload: mp.payload });
    const id = up.json().data.id;
    // ws2 的 agent 拿 ws1 的附件 id → 404 (RLS/租户隔离)
    const dl = await app.inject({ method: "GET", url: `/agent/attachments/${id}/download`, headers: auth("agentB-tok") });
    expect(dl.statusCode).toBe(404);
  });

  it("附件:下载不存在 → 404", async () => {
    const dl = await app.inject({ method: "GET", url: "/api/attachments/00000000-0000-4000-8000-000000000999/download", headers: auth("user-tok") });
    expect(dl.statusCode).toBe(404);
  });

  // ---- integration list / login / logout ----
  it("integration:登录记录 → list 出现 → logout 消失(幂等)", async () => {
    expect((await app.inject({ method: "POST", url: "/agent/integrations/gh/login", headers: auth("agent-tok") })).statusCode).toBe(201);
    await app.inject({ method: "POST", url: "/agent/integrations/gh/login", headers: auth("agent-tok") }); // 幂等
    await app.inject({ method: "POST", url: "/agent/integrations/gcloud/login", headers: auth("agent-tok") });
    const list = await app.inject({ method: "GET", url: "/agent/integrations", headers: auth("agent-tok") });
    expect(list.json().data.map((r: { integration: string }) => r.integration).sort()).toEqual(["gcloud", "gh"]);
    // per-agent 隔离:另一个 agent 看不到
    expect((await app.inject({ method: "GET", url: "/agent/integrations", headers: auth("agent2-tok") })).json().data).toEqual([]);
    // logout
    await app.inject({ method: "POST", url: "/agent/integrations/gh/logout", headers: auth("agent-tok") });
    expect((await app.inject({ method: "GET", url: "/agent/integrations", headers: auth("agent-tok") })).json().data.map((r: { integration: string }) => r.integration)).toEqual(["gcloud"]);
  });

  // ---- OAuth 路由(注入 fake provider)----
  it("OAuth:providers 列表 + start 返回授权 URL", async () => {
    const fake = {
      name: "fake",
      authorizeUrl: (state: string, redirectUri: string) => `https://fake/auth?state=${state}&redirect_uri=${redirectUri}`,
      exchangeCode: async () => ({ email: "u@e.com" }),
    };
    const app2 = await buildApp({ repos: createMemoryRepos(), resolveToken, bus: new RealtimeBus(), oauthProviders: { fake } });
    const provs = await app2.inject({ method: "GET", url: "/api/auth/oauth/providers" });
    expect(provs.json().data.providers).toEqual(["fake"]);
    const start = await app2.inject({ method: "GET", url: "/api/auth/oauth/fake/start?redirectUri=https%3A%2F%2Fapp%2Fcb" });
    expect(start.statusCode).toBe(200);
    expect(start.json().data.url).toContain("https://fake/auth");
    // 未知 provider → 404
    expect((await app2.inject({ method: "GET", url: "/api/auth/oauth/nope/start?redirectUri=https%3A%2F%2Fapp%2Fcb" })).statusCode).toBe(404);
  });

  it("OAuth:未配置 provider → providers 空", async () => {
    const app2 = await buildApp({ repos: createMemoryRepos(), resolveToken, bus: new RealtimeBus() });
    const provs = await app2.inject({ method: "GET", url: "/api/auth/oauth/providers" });
    expect(provs.json().data.providers).toEqual([]);
  });

  // ---- action prepare(操作卡)----
  it("action:agent 备卡 → 人类列出 → 执行(建频道,以人类身份)→ 标记 executed", async () => {
    const prep = await app.inject({
      method: "POST", url: "/agent/actions", headers: auth("agent-tok"),
      payload: { kind: "channel:create", payload: { name: "from-action" } },
    });
    expect(prep.statusCode).toBe(201);
    const id = prep.json().data.id;

    const list = await app.inject({ method: "GET", url: "/api/actions", headers: auth("user-tok") });
    expect(list.json().data.some((c: { id: string }) => c.id === id)).toBe(true);

    const exec = await app.inject({ method: "POST", url: `/api/actions/${id}/execute`, headers: auth("user-tok") });
    expect(exec.statusCode).toBe(200);
    expect(exec.json().data).toMatchObject({ status: "executed", resultRef: "from-action" });

    // 频道真的建出来了(出现在 server-info)
    const info = await app.inject({ method: "GET", url: "/api/server-info", headers: auth("user-tok") });
    expect(info.json().data.channels.some((c: { slug: string }) => c.slug === "from-action")).toBe(true);

    // 不再 pending
    const list2 = await app.inject({ method: "GET", url: "/api/actions", headers: auth("user-tok") });
    expect(list2.json().data.some((c: { id: string }) => c.id === id)).toBe(false);
  });

  it("action:重复执行 → 409(幂等防重复)", async () => {
    const id = (await app.inject({ method: "POST", url: "/agent/actions", headers: auth("agent-tok"), payload: { kind: "channel:create", payload: { name: "once-only" } } })).json().data.id;
    expect((await app.inject({ method: "POST", url: `/api/actions/${id}/execute`, headers: auth("user-tok") })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/actions/${id}/execute`, headers: auth("user-tok") })).statusCode).toBe(409);
  });

  it("action:dismiss → 从待办消失;未知 kind / 非法 payload → 400", async () => {
    const id = (await app.inject({ method: "POST", url: "/agent/actions", headers: auth("agent-tok"), payload: { kind: "agent:create", payload: { handle: "newbot", displayName: "NewBot" } } })).json().data.id;
    expect((await app.inject({ method: "POST", url: `/api/actions/${id}/dismiss`, headers: auth("user-tok") })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/actions", headers: auth("user-tok") })).json().data.length).toBe(0);
    expect((await app.inject({ method: "POST", url: "/agent/actions", headers: auth("agent-tok"), payload: { kind: "nuke:everything", payload: {} } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/agent/actions", headers: auth("agent-tok"), payload: { kind: "channel:create", payload: {} } })).statusCode).toBe(400);
  });

  // ---- task 批量创建 / 拆分子任务 ----
  it("task batch:一次建多个任务,编号递增", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/channels/c1/tasks/batch", headers: auth("user-tok"),
      payload: { titles: ["子任务A", "子任务B", "子任务C"] },
    });
    expect(r.statusCode).toBe(201);
    const tasks = r.json().data;
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t: { title: string }) => t.title)).toEqual(["子任务A", "子任务B", "子任务C"]);
    // 编号唯一递增
    const nums = tasks.map((t: { number: number }) => t.number);
    expect(new Set(nums).size).toBe(3);
  });

  it("task batch:挂到父任务下(parentTaskId)", async () => {
    const parent = (await app.inject({ method: "POST", url: "/api/channels/c1/tasks", headers: auth("user-tok"), payload: { title: "大任务" } })).json().data.task;
    const r = await app.inject({
      method: "POST", url: "/api/channels/c1/tasks/batch", headers: auth("user-tok"),
      payload: { titles: ["拆1", "拆2"], parentTaskId: parent.id },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.every((t: { parentTaskId: string }) => t.parentTaskId === parent.id)).toBe(true);
  });

  it("task batch:父任务不存在 → 404;空 titles → 400", async () => {
    expect((await app.inject({ method: "POST", url: "/api/channels/c1/tasks/batch", headers: auth("user-tok"), payload: { titles: ["x"], parentTaskId: "00000000-0000-4000-8000-0000000000aa" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/channels/c1/tasks/batch", headers: auth("user-tok"), payload: { titles: [] } })).statusCode).toBe(400);
  });

  // ---- agent channel members / join / leave ----
  it("channel:agent 列成员 / 加入 / 退出公开频道", async () => {
    repos.store.seedAgent({ workspaceId: "ws1", handle: "cindy", displayName: "Cindy" });
    repos.store.seedChannel({ id: "pub1", workspaceId: "ws1", slug: "pub", name: "Pub", description: null, kind: "channel", isPrivate: false, archived: false });

    const join = await app.inject({ method: "POST", url: "/agent/channels/pub1/join", headers: auth("agent-tok") });
    expect(join.statusCode).toBe(200);
    const members = await app.inject({ method: "GET", url: "/agent/channels/pub1/members", headers: auth("agent-tok") });
    expect(members.statusCode).toBe(200);
    expect(members.json().data.some((m: { memberId: string }) => m.memberId === "cindy")).toBe(true);
    const leave = await app.inject({ method: "POST", url: "/agent/channels/pub1/leave", headers: auth("agent-tok") });
    expect(leave.statusCode).toBe(200);
  });

  it("channel:agent 加入私密频道 → 403;不存在 → 404", async () => {
    repos.store.seedAgent({ workspaceId: "ws1", handle: "cindy", displayName: "Cindy" });
    repos.store.seedChannel({ id: "priv1", workspaceId: "ws1", slug: "priv", name: "Priv", description: null, kind: "channel", isPrivate: true, archived: false });
    expect((await app.inject({ method: "POST", url: "/agent/channels/priv1/join", headers: auth("agent-tok") })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/agent/channels/00000000-0000-4000-8000-0000000000ff/join", headers: auth("agent-tok") })).statusCode).toBe(404);
  });

  // ---- 编辑频道成员:把任意 agent/human 加入 / 移除 ----
  it("channel:成员可添加别的 agent/human,并能移除;serverInfo.memberCount 同步", async () => {
    repos.store.seedAgent({ workspaceId: "ws1", handle: "dave", displayName: "Dave" });
    repos.store.seedChannel({ id: "edit1", workspaceId: "ws1", slug: "edit", name: "Edit", description: null, kind: "channel", isPrivate: false, archived: false });
    repos.store.seedMember("ws1", "edit1", { type: "human", id: "alice" }); // alice 是成员→有权编辑

    const add = await app.inject({ method: "POST", url: "/api/channels/edit1/members", headers: auth("user-tok"), payload: { type: "agent", id: "dave" } });
    expect(add.statusCode).toBe(200);
    expect(add.json().data.some((m: { memberId: string }) => m.memberId === "dave")).toBe(true);

    // 头部人数来源:serverInfo.channels[].memberCount = 2 (alice + dave)
    const info = await app.inject({ method: "GET", url: "/api/server-info", headers: auth("user-tok") });
    expect(info.json().data.channels.find((c: { id: string }) => c.id === "edit1").memberCount).toBe(2);

    const del = await app.inject({ method: "DELETE", url: "/api/channels/edit1/members/agent/dave", headers: auth("user-tok") });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.some((m: { memberId: string }) => m.memberId === "dave")).toBe(false);
  });

  it("channel:非成员不能编辑成员(403);加不存在的 agent → 400", async () => {
    repos.store.seedChannel({ id: "edit2", workspaceId: "ws1", slug: "edit2", name: "Edit2", description: null, kind: "channel", isPrivate: false, archived: false });
    // alice 不是 edit2 成员 → 403
    expect((await app.inject({ method: "POST", url: "/api/channels/edit2/members", headers: auth("user-tok"), payload: { type: "agent", id: "dave" } })).statusCode).toBe(403);
    // alice 是成员后:加不存在的 agent → 400
    repos.store.seedMember("ws1", "edit2", { type: "human", id: "alice" });
    expect((await app.inject({ method: "POST", url: "/api/channels/edit2/members", headers: auth("user-tok"), payload: { type: "agent", id: "ghost" } })).statusCode).toBe(400);
  });

  // ---- thread unfollow / follow ----
  it("thread:agent 退订线程(按短码 resolve)→ 之后该线程内 @ 不再唤醒", async () => {
    repos.store.seedAgent({ workspaceId: "ws1", handle: "cindy", displayName: "Cindy" });
    const parent = (await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "thread root" } })).json().data;
    const code = parent.id.slice(0, 8);

    const un = await app.inject({ method: "POST", url: `/agent/threads/${code}/unfollow`, headers: auth("agent-tok") });
    expect(un.statusCode).toBe(200);
    expect(un.json().data).toMatchObject({ unfollowed: true, threadId: parent.id });

    // 退订集合里有 cindy
    expect((await repos.threadAttention.unfollowedHandles("ws1", parent.id)).has("cindy")).toBe(true);

    // re-follow → 移除
    const re = await app.inject({ method: "POST", url: `/agent/threads/${code}/follow`, headers: auth("agent-tok") });
    expect(re.statusCode).toBe(200);
    expect((await repos.threadAttention.unfollowedHandles("ws1", parent.id)).has("cindy")).toBe(false);
  });

  it("thread:退订不存在的线程短码 → 404", async () => {
    const r = await app.inject({ method: "POST", url: "/agent/threads/deadbeef/unfollow", headers: auth("agent-tok") });
    expect(r.statusCode).toBe(404);
  });

  // ---- agent profile show / update ----
  it("profile:agent 查看并更新自己的资料卡(含 avatar)", async () => {
    repos.store.seedAgent({ workspaceId: "ws1", handle: "cindy", displayName: "Cindy" });
    const show = await app.inject({ method: "GET", url: "/agent/profile", headers: auth("agent-tok") });
    expect(show.statusCode).toBe(200);
    expect(show.json().data).toMatchObject({ handle: "cindy", avatarUrl: null });

    const upd = await app.inject({
      method: "PATCH", url: "/agent/profile", headers: auth("agent-tok"),
      payload: { displayName: "Cindy 🤖", avatarUrl: "https://example.com/a.png" },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().data).toMatchObject({ displayName: "Cindy 🤖", avatarUrl: "https://example.com/a.png" });

    const again = await app.inject({ method: "GET", url: "/agent/profile", headers: auth("agent-tok") });
    expect(again.json().data.avatarUrl).toBe("https://example.com/a.png");
  });

  it("profile:非法 avatar url → 400", async () => {
    repos.store.seedAgent({ workspaceId: "ws1", handle: "cindy", displayName: "Cindy" });
    const r = await app.inject({ method: "PATCH", url: "/agent/profile", headers: auth("agent-tok"), payload: { avatarUrl: "not-a-url" } });
    expect(r.statusCode).toBe(400);
  });

  it("profile:web 建 agent 可带 avatarUrl", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/agents", headers: auth("user-tok"),
      payload: { handle: "nova", displayName: "Nova", avatarUrl: "https://example.com/n.png" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.avatarUrl).toBe("https://example.com/n.png");
  });

  // ---- 频道归档(归档后拒写)----
  it("归档:archive → 人类/agent 发消息均 409;unarchive → 恢复", async () => {
    repos.store.seedChannel({ id: "arch1", workspaceId: "ws1", slug: "arch", name: "Arch", description: null, kind: "channel", isPrivate: false, archived: false });
    // 归档前可发
    expect((await app.inject({ method: "POST", url: "/api/channels/arch1/messages", headers: auth("user-tok"), payload: { content: "before" } })).statusCode).toBe(201);

    const arch = await app.inject({ method: "POST", url: "/api/channels/arch1/archive", headers: auth("user-tok") });
    expect(arch.statusCode).toBe(200);

    // 归档后:人类发 → 409
    const h = await app.inject({ method: "POST", url: "/api/channels/arch1/messages", headers: auth("user-tok"), payload: { content: "nope" } });
    expect(h.statusCode).toBe(409);
    // agent 发 → 409
    const a = await app.inject({ method: "POST", url: "/agent/channels/arch1/messages", headers: auth("agent-tok"), payload: { content: "nope" } });
    expect(a.statusCode).toBe(409);

    // serverInfo 标 archived
    const info = await app.inject({ method: "GET", url: "/api/server-info", headers: auth("user-tok") });
    expect(info.json().data.channels.find((c: { id: string }) => c.id === "arch1").archived).toBe(true);

    // 取消归档 → 可发
    await app.inject({ method: "POST", url: "/api/channels/arch1/unarchive", headers: auth("user-tok") });
    expect((await app.inject({ method: "POST", url: "/api/channels/arch1/messages", headers: auth("user-tok"), payload: { content: "again" } })).statusCode).toBe(201);
  });

  it("归档:不存在的频道 → 404", async () => {
    const r = await app.inject({ method: "POST", url: "/api/channels/00000000-0000-4000-8000-000000000abc/archive", headers: auth("user-tok") });
    expect(r.statusCode).toBe(404);
  });

  // ---- /api/me (Settings) ----
  it("GET /api/me 返回身份 + 工作区信息", async () => {
    repos.store.seedWorkspace("ws1", "Acme Crew", "acme");
    const r = await app.inject({ method: "GET", url: "/api/me", headers: auth("user-tok") });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({
      tier: "user",
      actor: { type: "human", id: "alice" },
      workspace: { id: "ws1", name: "Acme Crew", slug: "acme" },
    });
  });

  it("/api/me 未鉴权 → 401", async () => {
    const r = await app.inject({ method: "GET", url: "/api/me" });
    expect(r.statusCode).toBe(401);
  });

  // ---- Files tab (频道附件汇总) ----
  it("Files:频道内附件汇总(含上传者+时间),倒序", async () => {
    const m1 = (await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "a" } })).json().data.id;
    const m2 = (await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "b" } })).json().data.id;
    const f1 = multipart("first.txt", "text/plain", "one");
    const f2 = multipart("second.txt", "text/plain", "two");
    await app.inject({ method: "POST", url: `/api/channels/c1/messages/${m1}/attachments`, headers: { ...auth("user-tok"), ...f1.headers }, payload: f1.payload });
    await app.inject({ method: "POST", url: `/api/channels/c1/messages/${m2}/attachments`, headers: { ...auth("user-tok"), ...f2.headers }, payload: f2.payload });

    const files = await app.inject({ method: "GET", url: "/api/channels/c1/files", headers: auth("user-tok") });
    expect(files.statusCode).toBe(200);
    const names = files.json().data.map((f: { filename: string }) => f.filename);
    expect(names).toContain("first.txt");
    expect(names).toContain("second.txt");
    expect(files.json().data[0]).toHaveProperty("uploader");
    expect(files.json().data[0]).toHaveProperty("url");
  });

  it("Files:无附件的频道 → 空数组", async () => {
    await app.inject({ method: "POST", url: "/api/channels/c-empty/messages", headers: auth("user-tok"), payload: { content: "no files" } });
    const files = await app.inject({ method: "GET", url: "/api/channels/c-empty/files", headers: auth("user-tok") });
    expect(files.json().data).toEqual([]);
  });

  // ---- 收藏消息 (Saved) ----
  it("收藏:save → 消息 saved=true 且出现在 /api/saved;unsave → 消失", async () => {
    const send = await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "bookmark me" } });
    const mid = send.json().data.id;

    const save = await app.inject({ method: "POST", url: `/api/messages/${mid}/save`, headers: auth("user-tok") });
    expect(save.statusCode).toBe(201);
    // 幂等
    await app.inject({ method: "POST", url: `/api/messages/${mid}/save`, headers: auth("user-tok") });

    // 消息 GET 标 saved
    const list = await app.inject({ method: "GET", url: "/api/channels/c1/messages", headers: auth("user-tok") });
    expect(list.json().data.find((m: { id: string }) => m.id === mid).saved).toBe(true);
    // /api/saved 列出
    const saved = await app.inject({ method: "GET", url: "/api/saved", headers: auth("user-tok") });
    expect(saved.json().data).toHaveLength(1);
    expect(saved.json().data[0].id).toBe(mid);

    // unsave
    const del = await app.inject({ method: "DELETE", url: `/api/messages/${mid}/save`, headers: auth("user-tok") });
    expect(del.statusCode).toBe(200);
    const saved2 = await app.inject({ method: "GET", url: "/api/saved", headers: auth("user-tok") });
    expect(saved2.json().data).toHaveLength(0);
  });

  it("收藏:不存在的消息 → 404", async () => {
    const r = await app.inject({ method: "POST", url: "/api/messages/00000000-0000-4000-8000-000000000777/save", headers: auth("user-tok") });
    expect(r.statusCode).toBe(404);
  });

  it("收藏:私有 —— A 收藏不影响 B 的视图", async () => {
    const send = await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "shared msg" } });
    const mid = send.json().data.id;
    await app.inject({ method: "POST", url: `/api/messages/${mid}/save`, headers: auth("user-tok") });
    // 另一个工作区的成员看不到(跨租户),同工作区也仅本人可见 —— 这里验证 ws2 成员 /api/saved 为空
    const otherSaved = await app.inject({ method: "GET", url: "/api/saved", headers: auth("user-tok") });
    expect(otherSaved.json().data.length).toBe(1); // 本人能看到
  });

  it("空内容 → 400 校验失败", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/channels/c1/messages",
      headers: auth("user-tok"), payload: { content: "" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("线程短码过短(seq '5') → 400 而非把脏值塞库", async () => {
    const r = await app.inject({
      method: "POST", url: "/agent/channels/c1/messages",
      headers: auth("agent-tok"), payload: { content: "hi", thread: "5" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("VALIDATION");
  });

  it("线程回复:用真实消息短码 → 入线程", async () => {
    const parent = await app.inject({
      method: "POST", url: "/api/channels/c1/messages",
      headers: auth("user-tok"), payload: { content: "父消息" },
    });
    const parentId = parent.json().data.id as string;
    await repos.seen.advance("ws1", "cindy", "c1", 9); // agent 先追平
    const r = await app.inject({
      method: "POST", url: "/agent/channels/c1/messages",
      headers: auth("agent-tok"), payload: { content: "线程回复", thread: parentId },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.message.threadParentId).toBe(parentId);
  });

  // ---- agent 发消息 + freshness ----
  it("agent 在空频道发消息 → 201 sent", async () => {
    const r = await app.inject({
      method: "POST", url: "/agent/channels/c1/messages",
      headers: auth("agent-tok"), payload: { content: "hi" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.kind).toBe("sent");
  });

  it("频道有未读时 agent 发消息 → 202 held(draft)", async () => {
    await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "n1" } });
    const r = await app.inject({
      method: "POST", url: "/agent/channels/c1/messages",
      headers: auth("agent-tok"), payload: { content: "stale" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.kind).toBe("held");
  });

  it("agent 读后推进游标 → 再发 201", async () => {
    await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "n1" } });
    await app.inject({ method: "POST", url: "/agent/channels/c1/read", headers: auth("agent-tok"), payload: { upToSeq: 1 } });
    const r = await app.inject({
      method: "POST", url: "/agent/channels/c1/messages",
      headers: auth("agent-tok"), payload: { content: "informed" },
    });
    expect(r.statusCode).toBe(201);
  });

  // ---- task claim ----
  function seedTask(over: Partial<Parameters<typeof repos.store.seedTask>[0]> = {}) {
    repos.store.seedTask({
      id: "t1", workspaceId: "ws1", channelId: "cc", number: 1, title: "fix",
      messageId: "m1", parentTaskId: null, assignee: null, createdBy: null, status: "todo", anchoredOnSystemMessage: false, ...over,
    });
  }

  it("agent claim 任务 → 200 claimed;第二个 agent → 409 冲突", async () => {
    seedTask();
    const first = await app.inject({ method: "POST", url: "/agent/tasks/t1/claim", headers: auth("agent-tok") });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ status: "in_progress", idempotent: false });

    const second = await app.inject({ method: "POST", url: "/agent/tasks/t1/claim", headers: auth("agent2-tok") });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("CLAIM_CONFLICT");
  });

  it("claim system 锚定任务 → 422 NOT_CLAIMABLE", async () => {
    seedTask({ anchoredOnSystemMessage: true });
    const r = await app.inject({ method: "POST", url: "/agent/tasks/t1/claim", headers: auth("agent-tok") });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("NOT_CLAIMABLE");
  });

  it("claim 不存在的任务 → 404", async () => {
    const r = await app.inject({ method: "POST", url: "/agent/tasks/ghost/claim", headers: auth("agent-tok") });
    expect(r.statusCode).toBe(404);
  });

  // ---- 多租户隔离 (凭证携带 workspace) ----
  it("跨租户:ws2 的 agent 看不到 ws1 的消息,claim ws1 任务 → 404", async () => {
    await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "ws1 only" } });
    const list = await app.inject({ method: "GET", url: "/agent/channels/c1/messages", headers: auth("agentB-tok") });
    expect(list.json().data).toHaveLength(0); // ws2 看不到 ws1 频道消息

    seedTask();
    const claim = await app.inject({ method: "POST", url: "/agent/tasks/t1/claim", headers: auth("agentB-tok") });
    expect(claim.statusCode).toBe(404);
  });

  // ---- task 全套(P2) ----
  it("agent task create → 201,list 能看到,生命周期 claim→in_review→done", async () => {
    const created = await app.inject({
      method: "POST", url: "/agent/channels/cc/tasks",
      headers: auth("agent-tok"), payload: { title: "修登录" },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().data.task.id;
    expect(created.json().data.task.number).toBe(1);

    const list = await app.inject({ method: "GET", url: "/agent/channels/cc/tasks", headers: auth("agent-tok") });
    expect(list.json().data).toHaveLength(1);

    // 同一 agent 创建后已 seen,claim 不被 freshness 拦
    const claim = await app.inject({ method: "POST", url: `/agent/tasks/${taskId}/claim`, headers: auth("agent-tok") });
    expect(claim.statusCode).toBe(200);

    const rev = await app.inject({
      method: "POST", url: `/agent/tasks/${taskId}/status`,
      headers: auth("agent-tok"), payload: { status: "in_review" },
    });
    expect(rev.statusCode).toBe(200);
    expect(rev.json().data.status).toBe("in_review");

    const done = await app.inject({
      method: "POST", url: `/agent/tasks/${taskId}/status`,
      headers: auth("agent-tok"), payload: { status: "done" },
    });
    expect(done.json().data.status).toBe("done");
  });

  it("非 assignee 改状态 → 403", async () => {
    const created = await app.inject({
      method: "POST", url: "/agent/channels/cc/tasks",
      headers: auth("agent-tok"), payload: { title: "t" },
    });
    const taskId = created.json().data.task.id;
    await app.inject({ method: "POST", url: `/agent/tasks/${taskId}/claim`, headers: auth("agent-tok") });
    // dave 要先补课才不被 freshness 拦,再尝试改状态(非 assignee)
    const r = await app.inject({
      method: "POST", url: `/agent/tasks/${taskId}/status`,
      headers: auth("agent2-tok"), payload: { status: "done" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("非法状态 → 400", async () => {
    const created = await app.inject({
      method: "POST", url: "/agent/channels/cc/tasks",
      headers: auth("agent-tok"), payload: { title: "t" },
    });
    const taskId = created.json().data.task.id;
    await app.inject({ method: "POST", url: `/agent/tasks/${taskId}/claim`, headers: auth("agent-tok") });
    const r = await app.inject({
      method: "POST", url: `/agent/tasks/${taskId}/status`,
      headers: auth("agent-tok"), payload: { status: "shipping" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("unclaim 本人任务 → 释放", async () => {
    const created = await app.inject({
      method: "POST", url: "/agent/channels/cc/tasks",
      headers: auth("agent-tok"), payload: { title: "t" },
    });
    const taskId = created.json().data.task.id;
    await app.inject({ method: "POST", url: `/agent/tasks/${taskId}/claim`, headers: auth("agent-tok") });
    const r = await app.inject({ method: "POST", url: `/agent/tasks/${taskId}/unclaim`, headers: auth("agent-tok") });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.assignee).toBeNull();
  });

  it("web 人类建任务 → 201", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/channels/cc/tasks",
      headers: auth("user-tok"), payload: { title: "人类建的任务" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.task.number).toBe(1);
  });

  // ---- P3: server info / search / resolve ----
  it("server info 列频道+成员", async () => {
    repos.store.seedChannel({ id: "ch1", workspaceId: "ws1", slug: "build", name: "Build", description: "构建讨论", kind: "channel", isPrivate: false, archived: false });
    repos.store.seedAgent({ workspaceId: "ws1", handle: "cindy", displayName: "Cindy" });
    repos.store.seedUser({ workspaceId: "ws1", handle: "alice", displayName: "Alice" });
    repos.store.seedMember("ws1", "ch1", { type: "agent", id: "cindy" });
    const r = await app.inject({ method: "GET", url: "/agent/server-info", headers: auth("agent-tok") });
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.channels[0]).toMatchObject({ slug: "build", joined: true });
    expect(d.agents.map((a: { handle: string }) => a.handle)).toContain("cindy");
    expect(d.humans.map((h: { handle: string }) => h.handle)).toContain("alice");
  });

  it("server info 含 viewer 每频道未读数,读后清零", async () => {
    repos.store.seedChannel({ id: "uc", workspaceId: "ws1", slug: "unreadc", name: null, description: null, kind: "channel", isPrivate: false, archived: false });
    await repos.messages.append("ws1", { channelId: "uc", type: "human", sender: { type: "human", id: "alice" }, content: "m1" });
    await repos.messages.append("ws1", { channelId: "uc", type: "human", sender: { type: "human", id: "alice" }, content: "m2" });
    // viewer = user-tok(human:alice),未读 = 2
    let info = await app.inject({ method: "GET", url: "/api/server-info", headers: auth("user-tok") });
    let ch = info.json().data.channels.find((c: { id: string }) => c.id === "uc");
    expect(ch.unread).toBe(2);
    // 标记已读到 2 → 未读 0
    await app.inject({ method: "POST", url: "/api/channels/uc/read", headers: auth("user-tok"), payload: { upToSeq: 2 } });
    info = await app.inject({ method: "GET", url: "/api/server-info", headers: auth("user-tok") });
    ch = info.json().data.channels.find((c: { id: string }) => c.id === "uc");
    expect(ch.unread).toBe(0);
  });

  it("message search 命中子串", async () => {
    await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "登录超时问题" } });
    await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "无关消息" } });
    const r = await app.inject({ method: "GET", url: "/agent/messages/search?q=超时", headers: auth("agent-tok") });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
  });

  it("message search 中文乱序多关键词命中(FTS)", async () => {
    await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "他是牛招的产品专家" } });
    await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "无关的测试消息" } });
    // 查询词序与原文相反,子串匹配做不到,token 包含可以
    const r = await app.inject({ method: "GET", url: `/agent/messages/search?q=${encodeURIComponent("专家 牛招")}`, headers: auth("agent-tok") });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].content).toContain("产品专家");
  });

  it("message resolve:短码命中 / 不存在 404", async () => {
    const sent = await app.inject({ method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"), payload: { content: "x" } });
    const fullId = sent.json().data.id as string;
    const r = await app.inject({ method: "GET", url: `/agent/messages/${fullId.slice(0, 8)}/resolve`, headers: auth("agent-tok") });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(fullId);
    const miss = await app.inject({ method: "GET", url: "/agent/messages/deadbeef/resolve", headers: auth("agent-tok") });
    expect(miss.statusCode).toBe(404);
  });

  // ---- P5: reminders ----
  it("reminder schedule/list/cancel", async () => {
    const created = await app.inject({
      method: "POST", url: "/agent/reminders",
      headers: auth("agent-tok"), payload: { title: "看 CI", in: "5m", channel: "c1" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;

    const list = await app.inject({ method: "GET", url: "/agent/reminders", headers: auth("agent-tok") });
    expect(list.json().data).toHaveLength(1);

    const cancel = await app.inject({ method: "POST", url: `/agent/reminders/${id}/cancel`, headers: auth("agent-tok") });
    expect(cancel.json().data.status).toBe("cancelled");
  });

  it("reminder 调度方式非法(同时给 in 和 cron) → 400", async () => {
    const r = await app.inject({
      method: "POST", url: "/agent/reminders",
      headers: auth("agent-tok"), payload: { title: "x", in: "5m", cron: "* * * * *" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("未知路由 → 404 信封", async () => {
    const r = await app.inject({ method: "GET", url: "/nope" });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("NOT_FOUND");
  });

  // ---- agent 管理 (Members) ----
  it("web 新建 agent → 201,可在列表中读到", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/agents", headers: auth("user-tok"),
      payload: { handle: "Nova", displayName: "Nova", description: "测试 agent", model: "claude-opus-4-8" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      handle: "nova", displayName: "Nova", description: "测试 agent",
      runtime: "claude", model: "claude-opus-4-8", status: "idle",
    });

    const list = await app.inject({ method: "GET", url: "/api/agents", headers: auth("user-tok") });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((a: { handle: string }) => a.handle)).toContain("nova");
  });

  it("新建重名 agent → 409", async () => {
    const body = { handle: "echo", displayName: "Echo" };
    await app.inject({ method: "POST", url: "/api/agents", headers: auth("user-tok"), payload: body });
    const dup = await app.inject({ method: "POST", url: "/api/agents", headers: auth("user-tok"), payload: body });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("CONFLICT");
  });

  it("非法 handle → 400", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/agents", headers: auth("user-tok"),
      payload: { handle: "a b!", displayName: "Bad" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("GET /api/agents/:handle → 详情 / 404", async () => {
    await app.inject({
      method: "POST", url: "/api/agents", headers: auth("user-tok"),
      payload: { handle: "iris", displayName: "Iris" },
    });
    const got = await app.inject({ method: "GET", url: "/api/agents/iris", headers: auth("user-tok") });
    expect(got.statusCode).toBe(200);
    expect(got.json().data).toMatchObject({ handle: "iris", displayName: "Iris" });

    const miss = await app.inject({ method: "GET", url: "/api/agents/ghost", headers: auth("user-tok") });
    expect(miss.statusCode).toBe(404);
  });

  it("agent 列表按 workspace 隔离", async () => {
    await app.inject({
      method: "POST", url: "/api/agents", headers: auth("user-tok"),
      payload: { handle: "only1", displayName: "Only1" },
    });
    // ws2 的 agent token 无法看到 ws1 的 agent (此路由要求 user 层,用 user-tok 验列表归属)
    const list = await app.inject({ method: "GET", url: "/api/agents", headers: auth("user-tok") });
    expect(list.json().data.every((a: { handle: string }) => a.handle !== "zoe")).toBe(true);
  });

  it("agent 路由要求 user 层 (agent token → 403)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/agents", headers: auth("agent-tok") });
    expect(r.statusCode).toBe(403);
  });

  // ---- 机器(电脑)管理 ----
  it("新建机器 → 201,返回 token + 连接命令,列表可见", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/machines", headers: auth("user-tok"),
      payload: { name: "我的电脑" },
    });
    expect(created.statusCode).toBe(201);
    const d = created.json().data;
    expect(d.machine).toMatchObject({ name: "我的电脑", status: "offline" });
    expect(d.token).toMatch(/^sk_machine_/);
    expect(d.connectCommand).toContain("CREW_MACHINE_TOKEN=");
    expect(d.connectCommand).toContain("daemon serve");
    expect(d.machine.tokenPrefix).toMatch(/^sk_machine_/);

    const list = await app.inject({ method: "GET", url: "/api/machines", headers: auth("user-tok") });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((m: { name: string }) => m.name)).toContain("我的电脑");
  });

  it("GET/PATCH 机器:改名 / 404", async () => {
    const created = await app.inject({ method: "POST", url: "/api/machines", headers: auth("user-tok"), payload: {} });
    const id = created.json().data.machine.id;
    const got = await app.inject({ method: "GET", url: `/api/machines/${id}`, headers: auth("user-tok") });
    expect(got.statusCode).toBe(200);
    const renamed = await app.inject({
      method: "PATCH", url: `/api/machines/${id}`, headers: auth("user-tok"), payload: { name: "打包机" },
    });
    expect(renamed.json().data.name).toBe("打包机");
    const miss = await app.inject({ method: "GET", url: "/api/machines/00000000-0000-0000-0000-000000000000", headers: auth("user-tok") });
    expect(miss.statusCode).toBe(404);
  });

  it("新建 agent 可绑定 machineId", async () => {
    const m = await app.inject({ method: "POST", url: "/api/machines", headers: auth("user-tok"), payload: { name: "box" } });
    const machineId = m.json().data.machine.id;
    const created = await app.inject({
      method: "POST", url: "/api/agents", headers: auth("user-tok"),
      payload: { handle: "boxer", displayName: "Boxer", machineId },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.machineId).toBe(machineId);
  });

  it("编辑 agent:改名/描述/runtime/model/machine", async () => {
    const m = await app.inject({ method: "POST", url: "/api/machines", headers: auth("user-tok"), payload: { name: "box" } });
    const machineId = m.json().data.machine.id;
    await app.inject({ method: "POST", url: "/api/agents", headers: auth("user-tok"), payload: { handle: "edith", displayName: "Edith" } });
    const patched = await app.inject({
      method: "PATCH", url: "/api/agents/edith", headers: auth("user-tok"),
      payload: { displayName: "Edith II", description: "QA bot", runtime: "codex", model: "gpt-5.5", machineId },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data).toMatchObject({
      handle: "edith", displayName: "Edith II", description: "QA bot", runtime: "codex", model: "gpt-5.5", machineId,
    });
  });

  it("编辑 agent:machineId/model 可置空", async () => {
    const m = await app.inject({ method: "POST", url: "/api/machines", headers: auth("user-tok"), payload: {} });
    const machineId = m.json().data.machine.id;
    await app.inject({ method: "POST", url: "/api/agents", headers: auth("user-tok"), payload: { handle: "nullable", displayName: "N", model: "x", machineId } });
    const cleared = await app.inject({ method: "PATCH", url: "/api/agents/nullable", headers: auth("user-tok"), payload: { model: null, machineId: null } });
    expect(cleared.json().data).toMatchObject({ model: null, machineId: null });
  });

  it("编辑/删除不存在的 agent → 404", async () => {
    const p = await app.inject({ method: "PATCH", url: "/api/agents/ghost", headers: auth("user-tok"), payload: { displayName: "X" } });
    expect(p.statusCode).toBe(404);
    const d = await app.inject({ method: "DELETE", url: "/api/agents/ghost", headers: auth("user-tok") });
    expect(d.statusCode).toBe(404);
  });

  it("删除 agent → 列表中消失", async () => {
    await app.inject({ method: "POST", url: "/api/agents", headers: auth("user-tok"), payload: { handle: "doomed", displayName: "Doomed" } });
    const del = await app.inject({ method: "DELETE", url: "/api/agents/doomed", headers: auth("user-tok") });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/agents", headers: auth("user-tok") });
    expect(list.json().data.map((a: { handle: string }) => a.handle)).not.toContain("doomed");
  });

  it("web 发消息 asTask:true → 该频道出现任务", async () => {
    const send = await app.inject({
      method: "POST", url: "/api/channels/tc/messages", headers: auth("user-tok"),
      payload: { content: "修一下登录", asTask: true },
    });
    expect(send.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/api/channels/tc/tasks", headers: auth("user-tok") });
    const tasks = list.json().data;
    expect(tasks.length).toBe(1);
    expect(tasks[0]).toMatchObject({ title: "修一下登录", status: "todo" });
    expect(tasks[0].messageId).toBeTruthy(); // 任务锚定到那条消息
  });

  it("asTask 自动指派:频道里 @某 agent → 任务指派给被 @ 的", async () => {
    repos.store.seedAgent({ workspaceId: "ws1", handle: "dave", displayName: "Dave" });
    const send = await app.inject({
      method: "POST", url: "/api/channels/c1/messages", headers: auth("user-tok"),
      payload: { content: "@dave 帮忙修一下登录", asTask: true },
    });
    expect(send.statusCode).toBe(201);
    const t = (await app.inject({ method: "GET", url: "/api/channels/c1/tasks", headers: auth("user-tok") })).json().data[0];
    expect(t.assignee).toEqual({ type: "agent", id: "dave" });
  });

  it("asTask 自动指派:DM 里发任务 → 指派给对端 agent", async () => {
    repos.store.seedAgent({ workspaceId: "ws1", handle: "cindy", displayName: "Cindy" });
    const dm = (await app.inject({ method: "POST", url: "/api/agents/cindy/dm", headers: auth("user-tok") })).json().data;
    await app.inject({ method: "POST", url: `/api/channels/${dm.id}/messages`, headers: auth("user-tok"), payload: { content: "看下这个 bug", asTask: true } });
    const t = (await app.inject({ method: "GET", url: `/api/channels/${dm.id}/tasks`, headers: auth("user-tok") })).json().data[0];
    expect(t.assignee).toEqual({ type: "agent", id: "cindy" });
  });

  it("web 任务卡:claim → status → 完成流转", async () => {
    const send = await app.inject({ method: "POST", url: "/api/channels/tc/messages", headers: auth("user-tok"), payload: { content: "flow task", asTask: true } });
    expect(send.statusCode).toBe(201);
    const taskId = (await app.inject({ method: "GET", url: "/api/channels/tc/tasks", headers: auth("user-tok") })).json().data[0].id;
    const claim = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/claim`, headers: auth("user-tok") });
    expect(claim.statusCode).toBe(200);
    const prog = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/status`, headers: auth("user-tok"), payload: { status: "in_progress" } });
    expect(prog.json().data).toMatchObject({ status: "in_progress", assignee: { type: "human", id: "alice" } });
    const review = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/status`, headers: auth("user-tok"), payload: { status: "in_review" } });
    expect(review.json().data.status).toBe("in_review");
  });

  it("web 任务卡:unclaim 释放", async () => {
    await app.inject({ method: "POST", url: "/api/channels/tc/messages", headers: auth("user-tok"), payload: { content: "drop me", asTask: true } });
    const taskId = (await app.inject({ method: "GET", url: "/api/channels/tc/tasks", headers: auth("user-tok") })).json().data[0].id;
    await app.inject({ method: "POST", url: `/api/tasks/${taskId}/claim`, headers: auth("user-tok") });
    const un = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/unclaim`, headers: auth("user-tok") });
    expect(un.statusCode).toBe(200);
    expect(un.json().data.assignee).toBeNull();
  });

  it("新建 agent 带 Provider/Reasoning/Fast mode → 持久化,可编辑", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/agents", headers: auth("user-tok"),
      payload: {
        handle: "rex", displayName: "Rex",
        provider: "custom", providerBaseUrl: "https://proxy/api", providerApiKey: "sk-xxx",
        reasoning: "high", fastMode: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      provider: "custom", providerBaseUrl: "https://proxy/api", reasoning: "high", fastMode: true,
    });
    // 编辑:切回 default + 关 fast
    const patched = await app.inject({
      method: "PATCH", url: "/api/agents/rex", headers: auth("user-tok"),
      payload: { provider: "default", providerBaseUrl: null, providerApiKey: null, reasoning: "low", fastMode: false },
    });
    expect(patched.json().data).toMatchObject({ provider: "default", reasoning: "low", fastMode: false, providerBaseUrl: null });
  });

  it("Activity:@提及精确匹配 —— @alice2 不算 @alice(胜过 ilike 子串)", async () => {
    await repos.messages.append("ws1", { channelId: "c1", type: "agent", sender: { type: "agent", id: "cindy" }, content: "@alice2 别人" });
    await repos.messages.append("ws1", { channelId: "c1", type: "agent", sender: { type: "agent", id: "cindy" }, content: "@alice 是你" });
    const r = await app.inject({ method: "GET", url: "/api/activity", headers: auth("user-tok") });
    const mentions = r.json().data.filter((x: { kind: string }) => x.kind === "mention");
    expect(mentions).toHaveLength(1);
    expect(mentions[0].text).toBe("@alice 是你");
  });

  it("Activity 时间线:@我 / 回复我 / 我的任务", async () => {
    await repos.messages.append("ws1", { channelId: "c1", type: "agent", sender: { type: "agent", id: "cindy" }, content: "@alice 看下这个" });
    const mine = await repos.messages.append("ws1", { channelId: "c1", type: "human", sender: { type: "human", id: "alice" }, content: "我的问题" });
    await repos.messages.append("ws1", { channelId: "c1", type: "agent", sender: { type: "agent", id: "cindy" }, content: "回复你", threadParentId: mine.id });
    repos.store.seedTask({ id: "ta", workspaceId: "ws1", channelId: "c1", number: 9, title: "my task", messageId: mine.id, parentTaskId: null, assignee: { type: "human", id: "alice" }, createdBy: null, status: "in_progress", anchoredOnSystemMessage: false });
    const r = await app.inject({ method: "GET", url: "/api/activity", headers: auth("user-tok") });
    expect(r.statusCode).toBe(200);
    const kinds = r.json().data.map((x: { kind: string }) => x.kind);
    expect(kinds).toContain("mention");
    expect(kinds).toContain("reply");
    expect(kinds).toContain("task");
    // 我自己发的消息不计入(回复里排除自己)
    expect(r.json().data.every((x: { text: string }) => x.text !== "我的问题")).toBe(true);
  });

  it("新建频道:201 + server-info 可见 + 创建者为 owner 成员", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/channels", headers: auth("user-tok"),
      payload: { name: "Roadmap", description: "planning" },
    });
    expect(created.statusCode).toBe(201);
    const ch = created.json().data;
    expect(ch).toMatchObject({ kind: "channel", joined: true, isPrivate: false });
    const info = await app.inject({ method: "GET", url: "/api/server-info", headers: auth("user-tok") });
    expect(info.json().data.channels.some((c: { id: string }) => c.id === ch.id)).toBe(true);
    const members = await app.inject({ method: "GET", url: `/api/channels/${ch.id}/members`, headers: auth("user-tok") });
    expect(members.json().data).toContainEqual({ memberType: "human", memberId: "alice", role: "owner" });
  });

  it("新建频道:带初始成员(agent + human)→ 都成 member,creator 仍 owner", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/channels", headers: auth("user-tok"),
      payload: { name: "launch", description: "x".repeat(400), members: [{ type: "agent", id: "cindy" }, { type: "human", id: "zuosong" }] },
    });
    expect(created.statusCode).toBe(201);
    const ch = created.json().data;
    const members = await app.inject({ method: "GET", url: `/api/channels/${ch.id}/members`, headers: auth("user-tok") });
    const ms = members.json().data;
    expect(ms).toContainEqual({ memberType: "human", memberId: "alice", role: "owner" });
    expect(ms).toContainEqual({ memberType: "agent", memberId: "cindy", role: "member" });
    expect(ms).toContainEqual({ memberType: "human", memberId: "zuosong", role: "member" });
  });

  it("新建频道:初始成员含 creator 自己 → 不降级为 member(仍 owner,不重复)", async () => {
    const ch = (await app.inject({ method: "POST", url: "/api/channels", headers: auth("user-tok"), payload: { name: "dup", members: [{ type: "human", id: "alice" }] } })).json().data;
    const ms = (await app.inject({ method: "GET", url: `/api/channels/${ch.id}/members`, headers: auth("user-tok") })).json().data;
    expect(ms.filter((m: { memberId: string }) => m.memberId === "alice")).toEqual([{ memberType: "human", memberId: "alice", role: "owner" }]);
  });

  it("公开频道 leave / join 幂等", async () => {
    const ch = (await app.inject({ method: "POST", url: "/api/channels", headers: auth("user-tok"), payload: { name: "general" } })).json().data;
    const left = await app.inject({ method: "POST", url: `/api/channels/${ch.id}/leave`, headers: auth("user-tok") });
    expect(left.json().data.joined).toBe(false);
    const joined = await app.inject({ method: "POST", url: `/api/channels/${ch.id}/join`, headers: auth("user-tok") });
    expect(joined.json().data.joined).toBe(true);
  });

  it("私密频道不可自助加入 → 403", async () => {
    repos.store.seedChannel({ id: "secret", workspaceId: "ws1", slug: "secret", name: "Secret", description: null, kind: "channel", isPrivate: true, archived: false });
    const r = await app.inject({ method: "POST", url: "/api/channels/secret/join", headers: auth("user-tok") });
    expect(r.statusCode).toBe(403);
  });

  it("打开 DM:返回 dm 频道,幂等,出现在 server-info", async () => {
    repos.store.seedAgent({ workspaceId: "ws1", handle: "cindy", displayName: "Cindy" });
    const open1 = await app.inject({ method: "POST", url: "/api/agents/cindy/dm", headers: auth("user-tok") });
    expect(open1.statusCode).toBe(201);
    const dm = open1.json().data;
    expect(dm).toMatchObject({ kind: "dm", joined: true });
    // 幂等:再开返回同一频道
    const open2 = await app.inject({ method: "POST", url: "/api/agents/cindy/dm", headers: auth("user-tok") });
    expect(open2.json().data.id).toBe(dm.id);
    // server-info 里能看到这个 dm 频道
    const info = await app.inject({ method: "GET", url: "/api/server-info", headers: auth("user-tok") });
    const ch = info.json().data.channels.find((c: { id: string }) => c.id === dm.id);
    expect(ch).toMatchObject({ kind: "dm", joined: true });
  });

  it("DM 不存在的 agent → 404", async () => {
    const r = await app.inject({ method: "POST", url: "/api/agents/ghost/dm", headers: auth("user-tok") });
    expect(r.statusCode).toBe(404);
  });

  it("agent 活动历史:落库后可查 (最新在前)", async () => {
    await repos.activities.append("ws1", { agentHandle: "cindy", channelId: null, activity: "thinking", detail: "first", seq: 0 });
    await repos.activities.append("ws1", { agentHandle: "cindy", channelId: null, activity: "sending", detail: "second", seq: 1 });
    await repos.activities.append("ws1", { agentHandle: "dave", channelId: null, activity: "working", detail: "other", seq: 0 });
    const r = await app.inject({ method: "GET", url: "/api/agents/cindy/activity", headers: auth("user-tok") });
    expect(r.statusCode).toBe(200);
    const rows = r.json().data;
    expect(rows.map((x: { detail: string }) => x.detail)).toEqual(["second", "first"]); // 最新在前,且按 agent 过滤
  });

  it("机器路由要求 user 层 (agent token → 403)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/machines", headers: auth("agent-tok") });
    expect(r.statusCode).toBe(403);
  });

  it("Generate Connect Command:为已有机器重发命令 / 404", async () => {
    const created = await app.inject({ method: "POST", url: "/api/machines", headers: auth("user-tok"), payload: { name: "reconn" } });
    const id = created.json().data.machine.id;
    const gen = await app.inject({ method: "POST", url: `/api/machines/${id}/connect-command`, headers: auth("user-tok") });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().data.token).toMatch(/^sk_machine_/);
    expect(gen.json().data.connectCommand).toContain("daemon serve");

    const miss = await app.inject({ method: "POST", url: "/api/machines/00000000-0000-0000-0000-000000000000/connect-command", headers: auth("user-tok") });
    expect(miss.statusCode).toBe(404);
  });
});

// ---- 导入 raft agent (POST /api/agents/import) ----
describe("Import raft agent", () => {
  // 假 hub:报机器在线,inspect 反填 name/description,import 记录调用
  function fakeHub(opts: { online: boolean; inspect?: FsResult; importResult?: FsResult }) {
    const hub = new DaemonHub();
    const calls: FsRequestMessage[] = [];
    (hub as unknown as { isMachineOnline: () => boolean }).isMachineOnline = () => opts.online;
    (hub as unknown as { request: (ws: string, m: string, r: Omit<FsRequestMessage, "reqId">) => Promise<FsResult> }).request =
      async (_ws, _m, r) => {
        calls.push({ ...r, reqId: "x" });
        if (r.type === "raft:inspect") return opts.inspect ?? { ok: true, data: { name: "", description: "", fileCount: 0 } };
        if (r.type === "raft:import") return opts.importResult ?? { ok: true, data: { copied: ["MEMORY.md"], dir: "/d" } };
        return { ok: false, error: "unexpected" };
      };
    return { hub, calls };
  }

  async function setup(hub: DaemonHub): Promise<{ app: FastifyInstance; machineId: string }> {
    const repos = createMemoryRepos();
    const mint = async () => "sk_machine_x";
    const app = await buildApp({ repos, resolveToken, bus: new RealtimeBus(), mint, daemonHub: hub });
    const machine = repos.store.createMachine("ws1", { name: "打包机" });
    return { app, machineId: machine.id };
  }

  it("反填 name/description + 派生 handle + 调用 inspect 与 import", async () => {
    const { hub, calls } = fakeHub({
      online: true,
      inspect: { ok: true, data: { name: "HR大脑线上Skill执行效果监测员", description: "You audit skill effects.", fileCount: 4 } },
    });
    const { app, machineId } = await setup(hub);

    const res = await app.inject({
      method: "POST", url: "/api/agents/import", headers: auth("user-tok"),
      payload: { machineId, raftPath: "~/.slock/agents/abc" },
    });
    expect(res.statusCode).toBe(201);
    const agent = res.json().data;
    expect(agent.displayName).toBe("HR大脑线上Skill执行效果监测员");
    expect(agent.handle).toBe("hr-skill"); // ascii slug from name
    expect(agent.description).toBe("You audit skill effects.");
    expect(agent.machineId).toBe(machineId);
    // 先 inspect 再 import,且 import 目标 handle = 派生出的 handle
    expect(calls.map((c) => c.type)).toEqual(["raft:inspect", "raft:import"]);
    expect(calls[1]!.handle).toBe("hr-skill");

    // 真实落进 agent 列表
    const list = await app.inject({ method: "GET", url: "/api/agents", headers: auth("user-tok") });
    expect(list.json().data.some((a: { handle: string }) => a.handle === "hr-skill")).toBe(true);
  });

  it("inspect 预览:返回工作区反填的 name/description(不建 agent)", async () => {
    const { hub } = fakeHub({
      online: true,
      inspect: { ok: true, data: { name: "RD-hr大脑工程修改专家", description: "I edit the engine.", fileCount: 12, entries: [] } },
    });
    const { app, machineId } = await setup(hub);
    const res = await app.inject({
      method: "POST", url: "/api/agents/import/inspect", headers: auth("user-tok"),
      payload: { machineId, raftPath: "~/.slock/agents/test1234" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ name: "RD-hr大脑工程修改专家", description: "I edit the engine.", fileCount: 12 });
    // 仅预览,未落 agent
    const list = await app.inject({ method: "GET", url: "/api/agents", headers: auth("user-tok") });
    expect(list.json().data.length).toBe(0);
  });

  it("inspect 机器离线 → 409", async () => {
    const { hub } = fakeHub({ online: false });
    const { app, machineId } = await setup(hub);
    const res = await app.inject({
      method: "POST", url: "/api/agents/import/inspect", headers: auth("user-tok"),
      payload: { machineId, raftPath: "~/x" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("机器离线 → 409,不建 agent", async () => {
    const { hub } = fakeHub({ online: false });
    const { app, machineId } = await setup(hub);
    const res = await app.inject({
      method: "POST", url: "/api/agents/import", headers: auth("user-tok"),
      payload: { machineId, raftPath: "~/.slock/agents/abc" },
    });
    expect(res.statusCode).toBe(409);
    const list = await app.inject({ method: "GET", url: "/api/agents", headers: auth("user-tok") });
    expect(list.json().data.length).toBe(0);
  });

  it("import 失败 → 回滚,不留空壳 agent", async () => {
    const { hub } = fakeHub({
      online: true,
      inspect: { ok: true, data: { name: "Bob", description: "helper", fileCount: 1 } },
      importResult: { ok: false, error: "disk full" },
    });
    const { app, machineId } = await setup(hub);
    const res = await app.inject({
      method: "POST", url: "/api/agents/import", headers: auth("user-tok"),
      payload: { machineId, raftPath: "~/x" },
    });
    expect(res.statusCode).toBe(400);
    const list = await app.inject({ method: "GET", url: "/api/agents", headers: auth("user-tok") });
    expect(list.json().data.some((a: { handle: string }) => a.handle === "bob")).toBe(false);
  });

  it("MEMORY.md 无 H1 且未填 name → 400", async () => {
    const { hub } = fakeHub({
      online: true,
      inspect: { ok: true, data: { name: "", description: "", fileCount: 0 } },
    });
    const { app, machineId } = await setup(hub);
    const res = await app.inject({
      method: "POST", url: "/api/agents/import", headers: auth("user-tok"),
      payload: { machineId, raftPath: "~/x" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---- 频道分发:人类普通消息 → 广播唤醒频道 agent 成员 ----
describe("Channel dispatch (broadcast wake)", () => {
  it("人类发普通消息(无 @)→ 频道 agent 成员收到 agent:start;非成员不收", async () => {
    const repos = createMemoryRepos();
    const hub = new DaemonHub();
    const got: Array<{ agentHandle: string; reason: string }> = [];
    hub.register("ws1", "conn1", "m1", (m) => {
      if ((m as { type: string }).type === "agent:start") got.push(m as unknown as { agentHandle: string; reason: string });
    });
    const app = await buildApp({ repos, resolveToken, bus: new RealtimeBus(), daemonHub: hub });
    repos.store.seedAgent({ workspaceId: "ws1", handle: "cindy", displayName: "Cindy" });
    repos.store.seedAgent({ workspaceId: "ws1", handle: "dave", displayName: "Dave" });
    // 建频道,初始成员只含 cindy(human alice 为 owner)
    const ch = (await app.inject({ method: "POST", url: "/api/channels", headers: auth("user-tok"), payload: { name: "ops", members: [{ type: "agent", id: "cindy" }] } })).json().data;

    await app.inject({ method: "POST", url: `/api/channels/${ch.id}/messages`, headers: auth("user-tok"), payload: { content: "有个线上问题谁看下" } });

    const starts = got.filter((m) => m.agentHandle);
    expect(starts.map((m) => m.agentHandle)).toContain("cindy"); // 成员被广播
    expect(starts.find((m) => m.agentHandle === "cindy")?.reason).toBe("channel");
    expect(starts.some((m) => m.agentHandle === "dave")).toBe(false); // 非成员不收
  });
});
