/** 带 @mention 自动补全的 textarea(复用于主输入框与线程输入框)。
 *  打 @ 后弹出本频道 agent/human 列表:↑↓ 选择、Enter/Tab 确认、Esc 关闭、鼠标点选;
 *  菜单关闭时 Enter 走正常发送(onEnter)。仅做交互,数据与发送逻辑由父组件提供。 */

import { useRef, useState } from "react";
import type { Member } from "../types.js";
import { Avatar } from "./Avatar.js";
import { applyMention, filterMembers, findMentionQuery, type MentionQuery } from "../mentions.js";

const MAX_ITEMS = 8;

export function MentionTextarea(props: {
  value: string;
  onChange: (v: string) => void;
  members: Member[];
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  onEnter: () => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);

  const matches = menu ? filterMembers(props.members, menu.query).slice(0, MAX_ITEMS) : [];
  const open = menu !== null && matches.length > 0;

  // 依据 textarea 当前内容与光标重算菜单状态
  const sync = (el: HTMLTextAreaElement) => {
    const q = findMentionQuery(el.value, el.selectionStart ?? el.value.length);
    setMenu(q);
    setActive(0);
  };

  const choose = (m: Member) => {
    if (!menu) return;
    const el = ref.current;
    const cursor = el?.selectionStart ?? props.value.length;
    const { text, cursor: next } = applyMention(props.value, menu.start, cursor, m.handle);
    props.onChange(text);
    setMenu(null);
    // 等 React 应用新 value 后,把光标移到插入串之后
    requestAnimationFrame(() => {
      if (el) { el.focus(); el.setSelectionRange(next, next); }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const m = matches[active]; if (m) choose(m); return; }
      if (e.key === "Escape") { e.preventDefault(); setMenu(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); props.onEnter(); }
  };

  return (
    <div className="mention-wrap">
      {open && (
        <div className="mention-menu" data-testid="mention-menu">
          {matches.map((m, i) => (
            <button
              type="button"
              key={`${m.kind}:${m.handle}`}
              className={`mention-item ${i === active ? "active" : ""}`}
              data-testid="mention-item"
              // mousedown + preventDefault:点击不让 textarea 失焦,确保插入后光标可恢复
              onMouseDown={(e) => { e.preventDefault(); choose(m); }}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar type={m.kind} id={m.handle} size={20} url={m.avatarUrl} />
              <span className="mention-handle">@{m.handle}</span>
              {m.displayName && m.displayName !== m.handle && (
                <span className="mention-name">{m.displayName}</span>
              )}
              <span className={`mention-kind ${m.kind}`}>{m.kind}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        data-testid={props.testId}
        placeholder={props.placeholder}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => { props.onChange(e.target.value); sync(e.target); }}
        onKeyUp={(e) => sync(e.currentTarget)}
        onClick={(e) => sync(e.currentTarget)}
        onBlur={() => setMenu(null)}
        onPaste={props.onPaste}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
