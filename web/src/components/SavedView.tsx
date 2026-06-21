/** Saved messages: a read-only list of the viewer's bookmarked messages.
 *  Fetched from GET /api/saved; click an item to jump to its channel. */

import { useEffect, useState, useCallback } from "react";
import { Bookmark, RefreshCw } from "lucide-react";
import { Avatar } from "./Avatar.js";
import { api } from "../api.js";
import type { Channel, Message } from "../types.js";

export function SavedView(props: {
  channels: Channel[];
  onJump: (channelId: string) => void;
}) {
  const [items, setItems] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.savedMessages().then(setItems).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const chanName = (id: string) => {
    const c = props.channels.find((x) => x.id === id);
    return c ? (c.kind === "dm" ? `@${c.name ?? c.slug}` : `#${c.name ?? c.slug}`) : "channel";
  };

  return (
    <div className="activity-view" data-testid="saved-view">
      <div className="act-toolbar" style={{ padding: "8px 16px" }}>
        <span className="profile-sect" style={{ margin: 0 }}>SAVED</span>
        <span className="grow" />
        <button className="nb-btn" data-testid="saved-refresh" onClick={load}><RefreshCw size={13} /></button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {items === null && !error && <div className="placeholder"><div className="fake">Loading…</div></div>}
      {items?.length === 0 && <div className="placeholder"><div className="big">No saved messages</div><div className="fake">Click the bookmark icon on any message to save it here.</div></div>}
      <div className="act-feed">
        {items?.map((m) => (
          <div key={m.id} className="act-item" data-testid="saved-item" onClick={() => props.onJump(m.channelId)}>
            <span className="act-ic"><Bookmark size={16} /></span>
            <Avatar type={m.type as "agent" | "human"} id={m.sender.id} size={26} />
            <div className="act-main">
              <div className="act-line1">
                <b>{m.sender.id}</b>
                <span className="act-where">{chanName(m.channelId)}</span>
              </div>
              <div className="act-text">{m.content}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
