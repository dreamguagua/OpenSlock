import { describe, it, expect, afterAll } from "vitest";
import { createPgRepos } from "../../src/repo/pg/repos.js";
import { getDb, withTenant, closeDb } from "../../src/db/client.js";
import * as s from "../../src/db/schema.js";
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

describe.skipIf(!HAS_DB)("PG 并发:seq 单调分配", () => {
  it("N 个并发 append 到同一频道 → seq 恰好 1..N,无重复无空洞", async () => {
    const N = 40;
    const { workspaceId, channelId } = await fixture("seq");
    const human: Actor = { type: "human", id: "u" };

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        repos.messages.append(workspaceId, {
          channelId,
          type: "human",
          sender: human,
          content: `m${i}`,
        }),
      ),
    );

    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(seqs).size).toBe(N); // 无重复
    expect(await repos.messages.latestSeq(workspaceId, channelId)).toBe(N);
  });

  it("两个频道并发互不干扰,各自从 1 起", async () => {
    const { workspaceId, channelId: chA } = await fixture("seq2");
    const chB = await withTenant(workspaceId, async (tx) => {
      const [ch] = await tx
        .insert(s.channel)
        .values({ workspaceId, slug: "other", kind: "channel" })
        .returning();
      return ch!.id;
    });
    const human: Actor = { type: "human", id: "u" };

    await Promise.all([
      ...Array.from({ length: 10 }, () =>
        repos.messages.append(workspaceId, { channelId: chA, type: "human", sender: human, content: "a" }),
      ),
      ...Array.from({ length: 10 }, () =>
        repos.messages.append(workspaceId, { channelId: chB, type: "human", sender: human, content: "b" }),
      ),
    ]);

    expect(await repos.messages.latestSeq(workspaceId, chA)).toBe(10);
    expect(await repos.messages.latestSeq(workspaceId, chB)).toBe(10);
  });
});

describe.skipIf(!HAS_DB)("PG 并发:claim 原子抢占", () => {
  it("N 个 agent 并发 claim 同一任务 → 恰好 1 个 claimed,其余 conflict", async () => {
    const N = 25;
    const { workspaceId, channelId } = await fixture("claim");
    const human: Actor = { type: "human", id: "u" };
    const m = await repos.messages.append(workspaceId, {
      channelId, type: "human", sender: human, content: "task anchor",
    });
    const [task] = await withTenant(workspaceId, async (tx) =>
      tx.insert(s.task).values({
        workspaceId, channelId, number: 1, title: "race",
        messageId: m.id, status: "todo", anchoredOnSystemMessage: false,
      }).returning(),
    );

    const outcomes = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        repos.tasks.claim(workspaceId, task!.id, { type: "agent", id: `a${i}` }),
      ),
    );

    const claimed = outcomes.filter((o) => o.kind === "claimed");
    const conflict = outcomes.filter((o) => o.kind === "conflict");
    expect(claimed).toHaveLength(1);
    expect(conflict).toHaveLength(N - 1);

    // DB 里该任务恰好被一个 agent 持有,状态 in_progress
    const persisted = await repos.tasks.get(workspaceId, task!.id);
    expect(persisted?.assignee?.type).toBe("agent");
    expect(persisted?.status).toBe("in_progress");
  });

  it("同一 agent 并发重复 claim → 不报冲突 (claimed 或 already_mine)", async () => {
    const { workspaceId, channelId } = await fixture("claim2");
    const human: Actor = { type: "human", id: "u" };
    const m = await repos.messages.append(workspaceId, {
      channelId, type: "human", sender: human, content: "anchor",
    });
    const [task] = await withTenant(workspaceId, async (tx) =>
      tx.insert(s.task).values({
        workspaceId, channelId, number: 1, title: "idem",
        messageId: m.id, status: "todo", anchoredOnSystemMessage: false,
      }).returning(),
    );
    const me: Actor = { type: "agent", id: "solo" };

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => repos.tasks.claim(workspaceId, task!.id, me)),
    );
    expect(outcomes.every((o) => o.kind === "claimed" || o.kind === "already_mine")).toBe(true);
    expect(outcomes.some((o) => o.kind === "claimed")).toBe(true);
  });
});

describe.skipIf(!HAS_DB)("PG:task 全套(P2)", () => {
  it("N 个并发 create → task number 恰好 1..N,无重复", async () => {
    const N = 20;
    const { workspaceId, channelId } = await fixture("tasknum");
    const human: Actor = { type: "human", id: "u" };
    const results = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const m = await repos.messages.append(workspaceId, {
          channelId, type: "human", sender: human, content: `task ${i}`,
        });
        return repos.tasks.create(workspaceId, {
          channelId, title: `task ${i}`, messageId: m.id, createdBy: human,
        });
      }),
    );
    const nums = results.map((t) => t.number).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(nums).size).toBe(N);
  });

  it("真实生命周期:create→claim→in_review→done(原子约束生效)", async () => {
    const { workspaceId, channelId } = await fixture("tasklife");
    const human: Actor = { type: "human", id: "u" };
    const a: Actor = { type: "agent", id: "a" };
    const b: Actor = { type: "agent", id: "b" };
    const m = await repos.messages.append(workspaceId, { channelId, type: "human", sender: human, content: "fix" });
    const task = await repos.tasks.create(workspaceId, { channelId, title: "fix", messageId: m.id, createdBy: human });

    expect((await repos.tasks.claim(workspaceId, task.id, a)).kind).toBe("claimed");
    // 期望 assignee 传 b,但实际 assignee 是 a → 乐观并发 CAS 不匹配 → conflict
    expect((await repos.tasks.updateStatus(workspaceId, task.id, b, "done")).kind).toBe("conflict");
    expect((await repos.tasks.updateStatus(workspaceId, task.id, a, "in_review")).kind).toBe("ok");
    const done = await repos.tasks.updateStatus(workspaceId, task.id, a, "done");
    expect(done.kind).toBe("ok");

    // list 过滤
    const todo = await repos.tasks.list(workspaceId, { status: "todo" });
    expect(todo).toHaveLength(0);
    const mine = await repos.tasks.list(workspaceId, { assignee: a });
    expect(mine).toHaveLength(1);
  });

  it("unclaim 原子:仅 assignee 可释放", async () => {
    const { workspaceId, channelId } = await fixture("taskunclaim");
    const human: Actor = { type: "human", id: "u" };
    const a: Actor = { type: "agent", id: "a" };
    const b: Actor = { type: "agent", id: "b" };
    const m = await repos.messages.append(workspaceId, { channelId, type: "human", sender: human, content: "x" });
    const task = await repos.tasks.create(workspaceId, { channelId, title: "x", messageId: m.id, createdBy: human });
    await repos.tasks.claim(workspaceId, task.id, a);
    expect((await repos.tasks.unclaim(workspaceId, task.id, b, "todo")).kind).toBe("conflict"); // 非本人
    expect((await repos.tasks.unclaim(workspaceId, task.id, a, "todo")).kind).toBe("ok");
  });
});

describe.skipIf(!HAS_DB)("PG 并发:游标单调", () => {
  it("并发 advance seen 游标 → 最终为最大值", async () => {
    const { workspaceId, channelId } = await fixture("seen");
    await Promise.all(
      [3, 9, 1, 7, 5].map((v) => repos.seen.advance(workspaceId, "a", channelId, v)),
    );
    expect(await repos.seen.get(workspaceId, "a", channelId)).toBe(9);
  });
});

void getDb; // 保留显式依赖,确保连接初始化在 helpers 内完成
