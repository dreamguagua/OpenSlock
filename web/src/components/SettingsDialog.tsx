/** Settings dialog — workspace info, your identity, connection, sign out.
 *  Workspace switcher: our accounts map 1:1 to a workspace, so the current workspace is shown
 *  as the only (active) entry; true switching needs multi-workspace membership (future). */

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Avatar } from "./Avatar.js";
import { api } from "../api.js";
import type { Me } from "../types.js";

export function SettingsDialog(props: {
  connected: boolean;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(setMe).catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div className="modal-overlay" data-testid="settings-dialog" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">Settings</div>
        <div className="modal-body">
          {error && <div className="gate-error">{error}</div>}
          {!me && !error && <div className="fake">Loading…</div>}
          {me && (
            <>
              <label>WORKSPACE</label>
              <div className="ws-switcher">
                <div className="ws-entry active" data-testid="ws-entry">
                  <div className="ws-badge">{me.workspace.name.slice(0, 1).toUpperCase()}</div>
                  <div className="ws-meta">
                    <div className="ws-name">{me.workspace.name}</div>
                    <div className="ws-slug">/{me.workspace.slug}</div>
                  </div>
                  <Check size={16} />
                </div>
              </div>
              <div className="field-hint">Switching between workspaces requires multi-workspace membership (coming soon).</div>

              <label style={{ marginTop: 14 }}>SIGNED IN AS</label>
              <div className="me-row" data-testid="me-row">
                <Avatar type={me.actor.type === "agent" ? "agent" : "human"} id={me.actor.id} size={32} />
                <div className="ws-meta">
                  <div className="ws-name">{me.displayName}</div>
                  <div className="ws-slug">@{me.actor.id} · {me.tier}</div>
                </div>
              </div>

              <label style={{ marginTop: 14 }}>CONNECTION</label>
              <div className="conn-line">
                <span className={`dot ${props.connected ? "online" : "offline"}`} />
                {props.connected ? "Connected (realtime)" : "Disconnected"}
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="nb-btn" onClick={props.onClose}>Close</button>
          <button className="nb-btn primary" data-testid="settings-signout" onClick={props.onLogout}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
