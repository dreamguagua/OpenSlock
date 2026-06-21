/** Activity timeline: @mentions of me / replies to my messages / my task updates.
 *  Read-only aggregation from GET /api/activity; click an item to jump to its channel. */

import { useEffect, useState, useCallback } from "react";
import { AtSign, MessageSquare, CheckSquare, RefreshCw } from "lucide-react";
import { Avatar } from "./Avatar.js";
import { api } from "../api.js";
import type { ActivityFeedItem, Channel, Member } from "../types.js";

const KIND_ICON = { mention: AtSign, reply: MessageSquare, task: CheckSquare } as const;
const KIND_LABEL = { mention: "mentioned you", reply: "replied to you", task: "task" } as const;

export function ActivityView(props: {
  channels: Channel[];
  agents: Member[];
  humans: Member[];
  onJump: (channelId: string) => void;
}) {
  const [items, setItems] = useState<ActivityFeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.activity().then(setItems).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const chanName = (id: string) => {
    const c = props.channels.find((x) => x.id === id);
    return c ? (c.kind === "dm" ? `@${c.name ?? c.slug}` : `#${c.name ?? c.slug}`) : "channel";
  };
  const actorName = (t: string, id: string) =>
    t === "agent" ? (props.agents.find((a) => a.handle === id)?.displayName ?? id)
    : t === "human" ? (props.humans.find((h) => h.handle === id)?.displayName ?? id)
    : id;
  const when = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-US"); };

  return (
    <div className="activity-view" data-testid="activity-view">
      <div className="act-toolbar" style={{ padding: "8px 16px" }}>
        <span className="profile-sect" style={{ margin: 0 }}>ACTIVITY</span>
        <span className="grow" />
        <button className="nb-btn" data-testid="activity-view-refresh" onClick={load}><RefreshCw size={13} /></button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {items === null && !error && <div className="placeholder"><div className="fake">Loading…</div></div>}
      {items?.length === 0 && <div className="placeholder"><div className="big">No activity</div><div className="fake">@mentions, replies to you, and your task updates show up here.</div></div>}
      <div className="act-feed">
        {items?.map((it) => {
          const Icon = KIND_ICON[it.kind];
          return (
            <div key={`${it.kind}:${it.id}`} className="act-item" data-testid="activity-item" onClick={() => props.onJump(it.channelId)}>
              <span className="act-ic"><Icon size={16} /></span>
              {it.kind !== "task" && <Avatar type={it.actorType as "agent" | "human"} id={it.actorId} size={26} />}
              <div className="act-main">
                <div className="act-line1">
                  <b>{it.kind === "task" ? `#${it.text}` : actorName(it.actorType, it.actorId)}</b>
                  <span className="act-kindtag">{KIND_LABEL[it.kind]}{it.meta ? ` · ${it.meta.replace("_", " ")}` : ""}</span>
                  <span className="act-where">{chanName(it.channelId)}</span>
                  <span className="grow" />
                  <span className="act-when">{when(it.at)}</span>
                </div>
                {it.kind !== "task" && <div className="act-text">{it.text}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
