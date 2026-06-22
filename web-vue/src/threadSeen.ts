/**
 * 线程已读游标(客户端 / localStorage):记录每个线程「已看到的最大回复 seq」,
 * 用于在消息流显示「💬 N replies · X new」的未读回复数。键 = `${channelId}:${parentId}`。
 *
 * 说明:后端只有频道级已读(last_read_seq),无线程级已读;这里是客户端近似——
 * 按浏览器记忆,非跨设备。首次见到某线程时以当前最大回复 seq 作基线(避免「全部 new」)。
 */

const KEY = "crew:threadSeen";
type SeenMap = Record<string, number>;

function load(): SeenMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as SeenMap;
  } catch {
    return {};
  }
}
function save(m: SeenMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* 配额超限 / 隐私模式:忽略,功能降级但不报错 */
  }
}
const key = (channelId: string, parentId: string) => `${channelId}:${parentId}`;

/** 取某频道下所有线程的已读游标(parentId → lastSeenReplySeq)。 */
export function getChannelSeen(channelId: string): Record<string, number> {
  const all = load();
  const prefix = `${channelId}:`;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

/** 标记某线程已读到 seq(只增不减),并持久化。 */
export function markThreadSeen(channelId: string, parentId: string, seq: number): void {
  const all = load();
  const k = key(channelId, parentId);
  if ((all[k] ?? -1) < seq) {
    all[k] = seq;
    save(all);
  }
}
