import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // 纯领域逻辑要求高覆盖;DB repo 由集成测试覆盖
      exclude: [
        "src/db/**",
        "src/repo/pg/**",
        "src/http/**", // 由 http inject 测试覆盖,不纳入单元覆盖门禁
        "src/realtime/**", // 由 ws 测试覆盖
        "src/auth/**", // 由 http 测试覆盖
        "src/server.ts",
        "src/config/**",
        "src/repo/types.ts", // 纯类型,无运行时代码
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
