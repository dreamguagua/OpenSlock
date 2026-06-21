import { describe, it, expect, afterAll } from "vitest";
import { getDb, withTenant, closeDb } from "../../src/db/client.js";
import * as s from "../../src/db/schema.js";
import { createPgRepos } from "../../src/repo/pg/repos.js";
import { HAS_DB, makeWorkspace, dropWorkspace, type Fixture } from "./helpers.js";
import type { Actor } from "../../src/domain/actor.js";

const repos = createPgRepos();
const created: string[] = [];

afterAll(async () => {
  for (const ws of created) await dropWorkspace(ws);
  await closeDb();
});

async function fixture(prefix: string): Promise<Fixture> {
  const f = await makeWorkspace(prefix);
  created.push(f.workspaceId);
  return f;
}

const human: Actor = { type: "human", id: "u" };

describe.skipIf(!HAS_DB)("PG 行级安全 (RLS):多租户 DB 级隔离", () => {
  it("每个租户只能看到自己 workspace 的消息", async () => {
    const a = await fixture("rls-a");
    const b = await fixture("rls-b");
    await repos.messages.append(a.workspaceId, { channelId: a.channelId, type: "human", sender: human, content: "A 的消息" });
    await repos.messages.append(b.workspaceId, { channelId: b.channelId, type: "human", sender: human, content: "B 的消息" });

    // 在 A 的租户事务里查全表 message —— RLS 只放行 A 的行
    const seenInA = await withTenant(a.workspaceId, async (tx) => tx.select().from(s.message));
    expect(seenInA.every((m) => m.workspaceId === a.workspaceId)).toBe(true);
    expect(seenInA.some((m) => m.content === "A 的消息")).toBe(true);
    expect(seenInA.some((m) => m.content === "B 的消息")).toBe(false);
  });

  it("未设置租户上下文时,RLS 拒绝返回任何行 (fail-safe:漏过滤=查不到,而非泄露)", async () => {
    const a = await fixture("rls-c");
    await repos.messages.append(a.workspaceId, { channelId: a.channelId, type: "human", sender: human, content: "x" });

    // 不经 withTenant、直接用全局连接查 —— current_setting 为空 → 0 行
    const leaked = await getDb().select().from(s.message);
    expect(leaked).toHaveLength(0);
  });

  it("跨租户读对方任务返回 null (claim 前的 get 受 RLS 约束)", async () => {
    const a = await fixture("rls-d");
    const m = await repos.messages.append(a.workspaceId, { channelId: a.channelId, type: "human", sender: human, content: "anchor" });
    const [task] = await withTenant(a.workspaceId, async (tx) =>
      tx.insert(s.task).values({
        workspaceId: a.workspaceId, channelId: a.channelId, number: 1, title: "t",
        messageId: m.id, status: "todo", anchoredOnSystemMessage: false,
      }).returning(),
    );
    const b = await fixture("rls-e");
    // 用 B 的租户上下文去 get A 的任务 → RLS 过滤 → null
    expect(await repos.tasks.get(b.workspaceId, task!.id)).toBeNull();
  });
});
