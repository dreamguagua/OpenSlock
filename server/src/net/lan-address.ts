/**
 * 本机 LAN 地址探测。
 *
 * 用途:生成"在别的电脑上执行的连接命令"时,若没有显式 CREW_PUBLIC_URL、
 * 也拿不到可用的请求 Host,就退化到本机在局域网里的 IPv4——这样同一网段的
 * 其它机器才连得回来(127.0.0.1 只在被添加的那台机器上指它自己,绝不能嵌进命令)。
 */

import { networkInterfaces } from "node:os";

/** 私网网段优先:RFC1918 的 192.168/10/172.16-31 比其它非环回地址更可能是 LAN 网卡。 */
const isPrivateV4 = (ip: string): boolean =>
  /^10\./.test(ip) ||
  /^192\.168\./.test(ip) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

/**
 * 探测本机对局域网可达的 IPv4。
 * 跳过环回与内部接口;优先返回私网地址,否则返回任一非环回 IPv4;都没有则 null。
 */
export function detectLanIp(): string | null {
  const candidates: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      candidates.push(a.address);
    }
  }
  return candidates.find(isPrivateV4) ?? candidates[0] ?? null;
}

/** 拼出基于 LAN IP 的 server base URL;探测不到返回 null。 */
export function lanServerUrl(port: number): string | null {
  const ip = detectLanIp();
  return ip ? `http://${ip}:${port}` : null;
}
