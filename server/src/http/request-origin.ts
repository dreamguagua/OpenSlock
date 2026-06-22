/**
 * 从 HTTP 请求头推断"客户端访问 server 用的 base URL"。
 *
 * 这是生成连接命令时的关键来源:管理员用 http://192.168.1.20:3000 打开 Web UI,
 * 那么这个 host 对客户端就是可达的。反代场景(nginx/Caddy)走 X-Forwarded-* 头。
 * 拿不到 host 头则返回 undefined,交由上层退化到 LAN 探测/环回。
 */

/** 头可能是 string | string[] | undefined;取首值并去空白。 */
const first = (v: string | string[] | undefined): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
};

type Headers = Record<string, string | string[] | undefined>;

/**
 * 解析请求来源 base URL,如 `https://crew.example.com` 或 `http://192.168.1.20:3000`。
 * 优先级:X-Forwarded-Host/Proto(反代) → Host 头。两者都没有 → undefined。
 */
export function resolveRequestOrigin(headers: Headers): string | undefined {
  const host = first(headers["x-forwarded-host"]) ?? first(headers["host"]);
  if (!host) return undefined;
  const proto = first(headers["x-forwarded-proto"]) ?? "http";
  // X-Forwarded-* 可能是逗号分隔列表,只取最外层(第一个)。
  const cleanHost = host.split(",")[0]!.trim();
  const cleanProto = proto.split(",")[0]!.trim();
  return `${cleanProto}://${cleanHost}`;
}
