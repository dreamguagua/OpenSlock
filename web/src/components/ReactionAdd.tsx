/** "Add reaction" 触发器 + emoji 弹层。放在消息右上角操作区(Reply 图标右边),
 *  与 Reply/Save 同为 icon-only 的 hover 操作,不再占消息下方一行(避免 hover 时行高跳动)。 */

import { useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import type { ReactionSummary } from "../types.js";

const PALETTE = ["👍", "❤️", "🎉", "😄", "🙏", "👀", "🚀", "✅"] as const;

// emoji 弹层(4 列 2 行)大致高度(含内边距/外边距),用于判断下方空间是否够。
const PICKER_HEIGHT = 90;

export function ReactionAdd(props: {
  reactions: ReactionSummary[];
  onToggle: (emoji: string, mine: boolean) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dir, setDir] = useState<"up" | "down">("down");
  const addRef = useRef<HTMLButtonElement>(null);
  const has = (emoji: string) => props.reactions.find((r) => r.emoji === emoji);

  // 触发器在消息顶部,默认向下弹;仅当下方空间不足(靠近视口底部)时才向上弹。
  const togglePicker = () => {
    setPickerOpen((open) => {
      if (!open) {
        const rect = addRef.current?.getBoundingClientRect();
        const below = rect ? window.innerHeight - rect.bottom : Infinity;
        setDir(below < PICKER_HEIGHT ? "up" : "down");
      }
      return !open;
    });
  };

  return (
    <div className="reaction-add-wrap">
      <button
        ref={addRef}
        className="msg-act" data-testid="reaction-add" title="Add reaction"
        onClick={togglePicker}
      >
        <SmilePlus size={14} />
      </button>
      {pickerOpen && (
        <>
          <div className="menu-backdrop" onClick={() => setPickerOpen(false)} />
          <div className={`emoji-picker ${dir}`} data-testid="emoji-picker">
            {PALETTE.map((e) => (
              <button
                key={e}
                className={`emoji-opt ${has(e)?.mine ? "active" : ""}`}
                onClick={() => { setPickerOpen(false); props.onToggle(e, Boolean(has(e)?.mine)); }}
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
