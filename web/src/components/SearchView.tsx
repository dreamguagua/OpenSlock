/** 全局搜索:输入关键词 → 后端 message search(pg_trgm 子串)→ 结果可点跳到频道。 */

import { useState } from "react";
import type { AgentStatusInfo, Channel, Message } from "../types.js";
import { Avatar } from "./Avatar.js";

export function SearchView(props: {
  channels: Channel[];
  agentStatus: Record<string, AgentStatusInfo>;
  onSearch: (q: string) => Promise<Message[]>;
  onJump: (channelId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const t = q.trim();
    if (!t) return;
    setBusy(true);
    try { setResults(await props.onSearch(t)); } finally { setBusy(false); }
  };
  const chanName = (id: string) => {
    const c = props.channels.find((x) => x.id === id);
    return c ? (c.name ?? c.slug) : id.slice(0, 8);
  };

  return (
    <div className="chat" data-testid="search-view">
      <div className="task-toolbar">
        <input
          className="nb-btn" style={{ fontWeight: 400, flex: 1 }}
          data-testid="search-input" autoFocus placeholder="Search messages…"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()}
        />
        <button className="nb-btn primary" data-testid="search-btn" disabled={busy || !q.trim()} onClick={run}>Search</button>
      </div>
      <div className="msgs">
        {results === null && <div className="placeholder"><div className="fake">Type a keyword to search messages visible in this workspace</div></div>}
        {results !== null && results.length === 0 && <div className="placeholder"><div>No matches</div></div>}
        {results?.map((m) => (
          <div key={m.id} className={`msg ${m.type}`} data-testid="search-result" onClick={() => props.onJump(m.channelId)} style={{ cursor: "pointer" }}>
            <Avatar type={m.type} id={m.sender.id} status={m.type === "agent" ? props.agentStatus[m.sender.id]?.kind : undefined} />
            <div className="body">
              <div className="line1">
                <span className="who">{m.sender.id}</span>
                <span className="meta mono">#{chanName(m.channelId)} · #{m.seq}</span>
              </div>
              <div className="content">{m.content}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
