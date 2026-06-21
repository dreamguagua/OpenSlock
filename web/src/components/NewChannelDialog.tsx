/** Create-channel dialog: name / description / visibility / initial members (agents + humans).
 *  Creator becomes owner; selected members are added. */

import { useMemo, useState } from "react";
import { Search, Check, Hash, Lock } from "lucide-react";
import { Avatar } from "./Avatar.js";
import type { Member } from "../types.js";

type Picked = { type: "agent" | "human"; id: string };

export function NewChannelDialog(props: {
  agents: Member[];
  humans: Member[];
  onCreate: (input: { name: string; description?: string; isPrivate?: boolean; members?: Picked[] }) => Promise<string>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tag = (m: Member, kind: "agent" | "human") => ({ kind, handle: m.handle, displayName: m.displayName, avatarUrl: m.avatarUrl });
    const all = [...props.agents.map((a) => tag(a, "agent")), ...props.humans.map((h) => tag(h, "human"))];
    return q ? all.filter((m) => m.displayName.toLowerCase().includes(q) || m.handle.toLowerCase().includes(q)) : all;
  }, [props.agents, props.humans, query]);

  const isPicked = (kind: "agent" | "human", id: string) => picked.some((p) => p.type === kind && p.id === id);
  const toggle = (kind: "agent" | "human", id: string) =>
    setPicked((prev) => (isPicked(kind, id) ? prev.filter((p) => !(p.type === kind && p.id === id)) : [...prev, { type: kind, id }]));

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await props.onCreate({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        isPrivate,
        ...(picked.length ? { members: picked } : {}),
      });
      props.onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" data-testid="new-channel-dialog" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">Create Channel</div>
        <div className="modal-body">
          <label>Name <span className="req">*</span></label>
          <input
            data-testid="channel-name-input" placeholder="e.g. ai-research" autoFocus
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />

          <label>Description <span className="hint">(optional)</span></label>
          <textarea
            className="modal-textarea" data-testid="channel-desc-input" rows={4} maxLength={2000}
            placeholder="What is this channel about?"
            value={description} onChange={(e) => setDescription(e.target.value)}
          />

          <label>Visibility</label>
          <div className="seg" data-testid="channel-visibility">
            <button type="button" className={`seg-btn ${!isPrivate ? "active" : ""}`} data-testid="vis-public" onClick={() => setIsPrivate(false)}>
              <Hash size={14} /> Public
            </button>
            <button type="button" className={`seg-btn ${isPrivate ? "active" : ""}`} data-testid="vis-private" onClick={() => setIsPrivate(true)}>
              <Lock size={13} /> Private
            </button>
          </div>

          <label>Members <span className="hint">(optional)</span></label>
          <div className="member-search">
            <Search size={14} />
            <input
              data-testid="member-search" placeholder="Search members by name"
              value={query} onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="member-picklist" data-testid="member-picklist">
            {candidates.length === 0 && <div className="fake" style={{ padding: "8px 10px" }}>No matches</div>}
            {candidates.map((m) => {
              const on = isPicked(m.kind, m.handle);
              return (
                <button
                  key={`${m.kind}:${m.handle}`} type="button"
                  className={`member-pick ${on ? "on" : ""}`} data-testid="member-pick"
                  onClick={() => toggle(m.kind, m.handle)}
                >
                  <Avatar type={m.kind} id={m.handle} size={24} url={m.avatarUrl} />
                  <span className="mp-name">{m.displayName}</span>
                  <span className="mp-kind">{m.kind}</span>
                  {on && <Check size={15} className="mp-check" />}
                </button>
              );
            })}
          </div>
          {picked.length > 0 && <div className="field-hint" data-testid="member-count">{picked.length} member{picked.length === 1 ? "" : "s"} selected (you'll be the owner)</div>}

          {error && <div className="gate-error" data-testid="new-channel-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="nb-btn" onClick={props.onClose} disabled={busy}>Cancel</button>
          <button className="nb-btn primary" data-testid="channel-create-submit" onClick={submit} disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create Channel"}
          </button>
        </div>
      </div>
    </div>
  );
}
