import { defineConfig } from "drizzle-kit";

// drizzle-kit 用独立加载器,无法解析项目内 .js→.ts 导入,故此处自包含读取 env。
// 迁移需以 owner/superuser 执行 → 优先 ADMIN_URL;否则回退 DATABASE_URL。
const url = process.env.ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("需设置 ADMIN_URL 或 DATABASE_URL (参考 .env.example)");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
