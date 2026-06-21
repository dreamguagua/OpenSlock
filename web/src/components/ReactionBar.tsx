/** 消息下方的反应 pill 列表(只展示已有反应)。
 *  点已有 pill 切换自己的反应;"加反应"触发器已移到消息右上角(见 ReactionAdd)。 */

import type { ReactionSummary } from "../types.js";

export function ReactionBar(props: {
  reactions: ReactionSummary[];
  onToggle: (emoji: string, mine: boolean) => void;
}) {
  if (props.reactions.length === 0) return null;
  return (
    <div className="reactions" data-testid="reactions">
      {props.reactions.map((r) => (
        <button
          key={r.emoji}
          className={`reaction-pill ${r.mine ? "mine" : ""}`}
          data-testid="reaction-pill"
          title={r.mine ? "Click to remove your reaction" : "Click to react"}
          onClick={() => props.onToggle(r.emoji, r.mine)}
        >
          <span className="re">{r.emoji}</span>
          <span className="rc">{r.count}</span>
        </button>
      ))}
    </div>
  );
}
