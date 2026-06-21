/** Action inbox: pending action cards an agent prepared for a human to execute.
 *  Executing runs the action AS the human (e.g. create a channel/agent). */

import { useEffect, useState, useCallback } from "react";
import { Zap, RefreshCw, Check, X } from "lucide-react";
import { Avatar } from "./Avatar.js";
import { api } from "../api.js";
import type { ActionCard } from "../types.js";

const KIND_LABEL: Record<string, string> = {
  "channel:create": "Create channel",
  "agent:create": "Create agent",
};

function summarize(c: ActionCard): string {
  const p = c.payload;
  if (c.kind === "channel:create") return `#${String(p.name ?? "?")}${p.isPrivate ? " (private)" : ""}`;
  if (c.kind === "agent:create") return `@${String(p.handle ?? "?")} — ${String(p.displayName ?? "")}`;
  return JSON.stringify(p);
}

export function ActionsView(props: { reloadKey?: number; onChanged?: () => void }) {
  const [items, setItems] = useState<ActionCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.actions().then(setItems).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load, props.reloadKey]);

  const act = async (id: string, kind: "execute" | "dismiss") => {
    setBusy(id); setError(null);
    try {
      await (kind === "execute" ? api.executeAction(id) : api.dismissAction(id));
      load();
      props.onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <div className="activity-view" data-testid="actions-view">
      <div className="act-toolbar" style={{ padding: "8px 16px" }}>
        <span className="profile-sect" style={{ margin: 0 }}>ACTIONS</span>
        <span className="grow" />
        <button className="nb-btn" data-testid="actions-refresh" onClick={load}><RefreshCw size={13} /></button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {items === null && !error && <div className="placeholder"><div className="fake">Loading…</div></div>}
      {items?.length === 0 && <div className="placeholder"><div className="big">No pending actions</div><div className="fake">Agents can prepare actions (e.g. create a channel) for you to approve here.</div></div>}
      <div className="act-feed">
        {items?.map((c) => (
          <div key={c.id} className="act-item" data-testid="action-item" style={{ cursor: "default" }}>
            <span className="act-ic"><Zap size={16} /></span>
            <Avatar type={c.preparedBy.type === "agent" ? "agent" : "human"} id={c.preparedBy.id} size={26} />
            <div className="act-main">
              <div className="act-line1">
                <b>{KIND_LABEL[c.kind] ?? c.kind}</b>
                <span className="act-kindtag">prepared by @{c.preparedBy.id}</span>
              </div>
              <div className="act-text">{summarize(c)}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="nb-btn primary" data-testid="action-execute" disabled={busy === c.id} onClick={() => act(c.id, "execute")}><Check size={13} /> Execute</button>
              <button className="nb-btn" data-testid="action-dismiss" disabled={busy === c.id} onClick={() => act(c.id, "dismiss")}><X size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
