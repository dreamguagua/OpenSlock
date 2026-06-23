// 一键 onboard:起 Docker Postgres → 等健康 → 建表/角色/RLS/FTS → seed 演示数据 → 打印登录。
// 用法:  pnpm onboard         （默认端口 5432）
//        CREW_DB_PORT=5433 pnpm onboard   （本机已占 5432 时换端口）
//
// 只依赖 Docker;不需要本机装 PostgreSQL。已有本地 PG 的人可跳过本脚本,走 README 的手动路径。

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.CREW_DB_PORT || "5432";
const ADMIN_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/crew_dev`;
const APP_URL = `postgres://crew_app:crew_app_pw@127.0.0.1:${PORT}/crew_dev`;

const c = { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m` };
const step = (s) => console.log(`\n${c.cyan("▶")} ${s}`);
const die = (msg) => { console.error(`\n${c.red("✗")} ${msg}`); process.exit(1); };

// 在 ROOT 下执行命令,输出直通终端;失败即抛错。
function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: true, env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) die(`命令失败:${cmd} ${args.join(" ")}`);
}
// 静默执行,返回 {ok, out}。
function tryRun(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: true, env: { ...process.env, ...extraEnv } });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// 1) 前置检查:docker + docker compose
step("检查 Docker");
if (!tryRun("docker", ["--version"]).ok) {
  die("未找到 docker。请先安装 Docker Desktop(https://docker.com),或按 README「手动 / 已有 Postgres」一节走本地 PG 路径。");
}
if (!tryRun("docker", ["info"]).ok) {
  die("Docker 已安装但守护进程没运行。请先启动 Docker Desktop 再重试。");
}
if (!tryRun("docker", ["compose", "version"]).ok) {
  die("当前 docker 不支持 `docker compose`(需要 Compose v2 / 较新的 Docker Desktop)。");
}

// 2) 起数据库
step(`启动 Postgres 容器(host 端口 ${PORT})`);
run("docker", ["compose", "up", "-d", "db"], { CREW_DB_PORT: PORT });

// 3) 等容器健康(pg_isready)
step("等待数据库就绪");
let ready = false;
for (let i = 0; i < 60; i++) {
  if (tryRun("docker", ["compose", "exec", "-T", "db", "pg_isready", "-U", "postgres", "-d", "crew_dev"], { CREW_DB_PORT: PORT }).ok) {
    ready = true;
    break;
  }
  spawnSync(process.platform === "win32" ? "timeout" : "sleep", [process.platform === "win32" ? "1" : "1"], { shell: true });
}
if (!ready) die("数据库 60s 内未就绪。`docker compose logs db` 看日志,或确认端口 " + PORT + " 没被占用。");
console.log(c.green("  ✓ 数据库已就绪"));

// 4) 确保 server/.env 存在且端口正确(缺失则按所选端口生成)
step("准备 server/.env");
const envPath = join(ROOT, "server", ".env");
if (!existsSync(envPath)) {
  writeFileSync(envPath, `# 由 pnpm onboard 生成。应用以非超级用户 crew_app 连接(RLS 生效)。\nDATABASE_URL=${APP_URL}\n`);
  console.log(c.green(`  ✓ 已生成 server/.env (端口 ${PORT})`));
} else {
  const cur = readFileSync(envPath, "utf8");
  if (!cur.includes(`:${PORT}/crew_dev`)) {
    console.log(c.dim(`  server/.env 已存在,但端口似乎不是 ${PORT}。如连接失败,请把其中 DATABASE_URL 改为:\n    ${APP_URL}`));
  } else {
    console.log(c.dim("  server/.env 已存在,跳过"));
  }
}

// 5) 建表 / 角色 / RLS / FTS(以容器超级用户身份做一次性 setup)
step("初始化数据库(migrate + 角色 + RLS + 全文检索)");
run("pnpm", ["--filter", "@nowcrew/server", "db:setup"], { ADMIN_URL, DATABASE_URL: APP_URL });

// 6) 灌入演示数据并打印登录
step("写入演示数据");
run("pnpm", ["--filter", "@nowcrew/server", "seed"], { DATABASE_URL: APP_URL });

// 7) 收尾
console.log(`\n${c.green("✓ onboard 完成!")}`);
console.log(`\n下一步:`);
console.log(`  ${c.cyan("pnpm dev")}                      # 同时起后端(:3000)+ 前端(:5173)`);
console.log(`  打开 ${c.cyan("http://localhost:5173")}    # 用上面打印的 demo@crew.dev / crew1234 登录`);
console.log(c.dim(`\n停库:pnpm db:down   重置库(清数据重来):pnpm db:reset:docker`));
