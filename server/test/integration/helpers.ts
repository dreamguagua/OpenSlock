/**
 * 集成测试辅助 —— 针对真实 PostgreSQL。
 * 仅当设置了 DATABASE_URL 才运行 (否则 describe.skipIf 跳过,保证离线单测不受影响)。
 */

import { eq } from "drizzle-orm";
import { getDb, withTenant } from "../../src/db/client.js";
import * as s from "../../src/db/schema.js";

export const HAS_DB = !!process.env.DATABASE_URL;

let seq = 0;
/** 生成进程内唯一 slug (避免并发/重跑撞唯一约束)。 */
export function uniqueSlug(prefix: string): string {
  seq += 1;
  return `${prefix}-${process.pid}-${seq}`;
}

export interface Fixture {
  workspaceId: string;
  channelId: string;
}

/** 建一个隔离的 workspace + 一个频道,返回其 id。 */
export async function makeWorkspace(prefix = "it"): Promise<Fixture> {
  const db = getDb();
  const [ws] = await db
    .insert(s.workspace)
    .values({ name: prefix, slug: uniqueSlug(prefix) })
    .returning();
  const workspaceId = ws!.id;
  const channelId = await withTenant(workspaceId, async (tx) => {
    const [ch] = await tx
      .insert(s.channel)
      .values({ workspaceId, slug: "build", kind: "channel" })
      .returning();
    return ch!.id;
  });
  return { workspaceId, channelId };
}

/** 删除 workspace (级联清理子表)。 */
export async function dropWorkspace(workspaceId: string): Promise<void> {
  await getDb().delete(s.workspace).where(eq(s.workspace.id, workspaceId));
}
