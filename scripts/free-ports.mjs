/**
 * 启动前清理:释放本项目约定的开发端口(server / web)。
 *
 * 规范要点:
 *  - 只针对固定端口,绝不 `pkill node`(避免误杀其它项目进程)
 *  - 跨平台(darwin/linux 用 lsof,win32 用 netstat)
 *  - 端口空闲时静默通过,绝不让 dev 因此中断
 *  - 杀掉谁会打印出来,可见可控
 *
 * 用法:node scripts/free-ports.mjs [port...]
 *   不传参数时使用默认端口(读取 PORT 环境变量作为 server 端口)。
 */
import { execFileSync } from "node:child_process";

const SERVER_PORT = Number(process.env.PORT ?? 3000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);

const ports = process.argv.slice(2).map(Number).filter(Boolean);
const targets = ports.length > 0 ? ports : [SERVER_PORT, WEB_PORT];

/** 返回监听指定端口的进程 PID 列表(跨平台)。 */
function pidsOnPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid && pid !== "0") pids.add(pid);
        }
      }
      return [...pids];
    }
    // darwin / linux
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
    return out.split(/\s+/).filter(Boolean);
  } catch {
    // lsof/netstat 在端口空闲时返回非零退出码 —— 视为「没有进程」,不报错。
    return [];
  }
}

for (const port of targets) {
  const pids = pidsOnPort(port);
  if (pids.length === 0) continue;
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
      console.log(`[free-ports] 端口 ${port} 被 PID ${pid} 占用,已发送 SIGTERM 释放`);
    } catch (e) {
      console.warn(`[free-ports] 释放端口 ${port}(PID ${pid})失败:${e.message}`);
    }
  }
}
