/** 频道栏:Chat 头 + Activity/Saved 导航 + PINNED + CHANNELS 列表。
 *  Activity/Saved/PINNED 暂为假数据(标注);CHANNELS 为真实频道。 */

import { Plus, Search, Activity, Bookmark, Zap, Pin, Hash, User, Lock } from "lucide-react";
import type { Channel } from "../types.js";

export function ChannelColumn(props: {
  channels: Channel[];
  selectedChannelId: string | null;
  onSelect: (id: string) => void;
  onNav: (view: "activity" | "saved" | "search" | "actions") => void;
  onNewChannel: () => void;
  view: string;
}) {
  return (
    <div className="col">
      <div className="col-head">Chat</div>
      <div className="col-scroll">
        <div className="nav-item" data-testid="nav-search" onClick={() => props.onNav("search")}>
          <Search size={16} /><span className="grow">Search</span>
        </div>
        <div className={`nav-item ${props.view === "activity" ? "" : ""}`} onClick={() => props.onNav("activity")}>
          <Activity size={16} /><span className="grow">Activity</span>
          <span className="badge" title="placeholder">99+</span>
        </div>
        <div className="nav-item" onClick={() => props.onNav("saved")}>
          <Bookmark size={16} /><span className="grow">Saved</span>
          <span className="badge" title="placeholder">2</span>
        </div>
        <div className="nav-item" data-testid="nav-actions" onClick={() => props.onNav("actions")}>
          <Zap size={16} /><span className="grow">Actions</span>
        </div>

        <div className="sect"><Pin size={12} /><span>PINNED</span><span className="grow" /><span className="count">(placeholder)</span></div>
        <div className="chan"><span className="h">#</span><span className="nm" style={{ color: "#999" }}>No pinned channels yet</span></div>

        {(() => {
          const regular = props.channels.filter((c) => c.kind !== "dm");
          const dms = props.channels.filter((c) => c.kind === "dm");
          const row = (c: Channel) => (
            <div
              key={c.id}
              data-testid="channel-item"
              className={`chan ${c.id === props.selectedChannelId && props.view === "channel" ? "active" : ""}`}
              onClick={() => props.onSelect(c.id)}
            >
              <span className="h">{c.kind === "dm" ? <User size={15} /> : <Hash size={15} />}</span>
              <span className="nm">{c.name ?? c.slug}</span>
              {c.isPrivate && c.kind !== "dm" && <Lock size={13} aria-label="Private" />}
              {c.unread > 0 && c.id !== props.selectedChannelId && (
                <span className="badge" data-testid="unread-badge">{c.unread > 99 ? "99+" : c.unread}</span>
              )}
            </div>
          );
          return (
            <>
              <div className="sect">
                <span>CHANNELS</span><span className="count">{regular.length}</span><span className="grow" />
                <button className="sect-add" data-testid="new-channel-btn" title="New channel" onClick={props.onNewChannel}>
                  <Plus size={15} />
                </button>
              </div>
              {regular.length === 0 && <div className="chan"><span className="nm" style={{ color: "#999" }}>No channels</span></div>}
              {regular.map(row)}

              <div className="sect">
                <span>DIRECT MESSAGES</span><span className="grow" /><span className="count">{dms.length}</span>
              </div>
              {dms.length === 0 && <div className="chan"><span className="nm" style={{ color: "#999" }}>No DMs yet</span></div>}
              {dms.map(row)}
            </>
          );
        })()}
      </div>
    </div>
  );
}
