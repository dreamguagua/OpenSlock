/** 把消息正文里的 @handle / #channel / #N(任务) 渲染成可点链接(数据校验过的才链)。
 *  @handle:匹配到的成员高亮(成员资料/ DM 后期补充);#频道:跳频道;#数字:跳任务看板。 */

import type { Channel } from "../types.js";

export function MessageText(props: {
  content: string;
  channels: Channel[];
  memberHandles: Set<string>;
  onChannel: (id: string) => void;
  onTask: () => void;
}) {
  const chanByName = new Map<string, string>();
  for (const c of props.channels) {
    chanByName.set(c.slug, c.id);
    if (c.name) chanByName.set(c.name, c.id);
  }

  // 拆成 普通文字 / @token / #token
  const parts = props.content.split(/(@[A-Za-z0-9_一-龥-]+|#[A-Za-z0-9_一-龥-]+)/g);

  return (
    <span>
      {parts.map((p, i) => {
        if (p.startsWith("@") && p.length > 1) {
          const handle = p.slice(1);
          if (props.memberHandles.has(handle)) {
            return <span key={i} className="tok mention" title="Member profile / DM (coming soon)">{p}</span>;
          }
          return <span key={i}>{p}</span>;
        }
        if (p.startsWith("#") && p.length > 1) {
          const rest = p.slice(1);
          if (/^\d+$/.test(rest)) {
            return <span key={i} className="tok task" title="Jump to task board" onClick={props.onTask}>{p}</span>;
          }
          const chId = chanByName.get(rest);
          if (chId) {
            return <span key={i} className="tok channel" title="Jump to channel" onClick={() => props.onChannel(chId)}>{p}</span>;
          }
          return <span key={i}>{p}</span>;
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}
