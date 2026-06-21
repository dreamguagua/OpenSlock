/**
 * 环境配置 —— 在系统边界用 zod 校验,缺失即 fail-fast。绝不硬编码密钥。
 */

import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgres"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`环境变量校验失败:\n${issues}\n请参考 .env.example 配置。`);
  }
  cached = parsed.data;
  return cached;
}
