/**
 * 一次性:为现有 demo workspace 补发一个 sk_machine_* 机器令牌(不动任何数据)。
 *   pnpm tsx scripts/mint-machine.ts
 * 用于在不 reseed 的前提下启动 daemon 连控制面。
 */

import { eq } from "drizzle-orm";
import { getDb, closeDb } from "../src/db/client.js";
import * as s from "../src/db/schema.js";
import { mintCredential } from "../src/auth/service.js";

async function main() {
  const db = getDb();
  const [ws] = await db.select().from(s.workspace).where(eq(s.workspace.slug, "demo"));
  if (!ws) {
    console.error("找不到 slug=demo 的 workspace,请先 pnpm seed");
    process.exit(1);
  }
  const token = await mintCredential(ws.id, "machine", { type: "system", id: "machine-1" });
  console.log(`WS=${ws.id}`);
  console.log(`CREW_MACHINE_TOKEN=${token}`);
  await closeDb();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
