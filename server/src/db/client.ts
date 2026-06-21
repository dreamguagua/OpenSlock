/**
 * 数据库连接与租户事务包装。
 *
 * `withTenant(ws, fn)` 在一个事务内先 `set_config('app.current_workspace', ws, true)`
 * (true = 仅本事务内生效),再执行 fn。PG 的 RLS 策略据此过滤,即使应用层漏写
 * `WHERE workspace_id=`,DB 也强制隔离 —— 这是 Node 多租户的 DB 级兜底。
 */

import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";
import { loadEnv } from "../config/env.js";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let pool: Pool | null = null;
let db: Db | null = null;

export function getDb(): Db {
  if (!db) {
    pool = new Pool({ connectionString: loadEnv().DATABASE_URL });
    db = drizzle(pool, { schema });
  }
  return db;
}

/** 在绑定了租户 RLS 的事务内执行。所有租户数据读写都应经此入口。 */
export async function withTenant<T>(
  workspaceId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!workspaceId) throw new Error("withTenant requires a workspaceId");
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_workspace', ${workspaceId}, true)`,
    );
    return fn(tx);
  });
}

/** 关闭连接池 (进程退出 / 测试 teardown)。 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
