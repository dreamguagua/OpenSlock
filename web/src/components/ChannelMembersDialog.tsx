/** Channel members panel: lists members + role, add any agent/human, remove a member, or leave. */

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Avatar } from "./Avatar.js";
import { api } from "../api.js";
import type { ChannelMember, Member } from "../types.js";

export function ChannelMembersDialog(props: {
  channelId: string;
  channelName: string;
  joined: boolean;
  agents: Member[];
  humans: Member[];
  onLeave: (channelId: string) => Promise<void>;
  onAdd: (channelId: string, member: { type: "agent" | "human"; id: string }) => Promise<ChannelMember[]>;
  onRemove: (channelId: string, member: { type: "agent" | "human"; id: string }) => Promise<ChannelMember[]>;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<ChannelMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    api.channelMembers(props.channelId)
      .then((m) => { if (alive) setMembers(m); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [props.channelId]);

  const nameOf = (type: ChannelMember["memberType"], id: string): string => {
    if (type === "agent") return props.agents.find((a) => a.handle === id)?.displayName ?? id;
    if (type === "human") return props.humans.find((h) => h.handle === id)?.displayName ?? id;
    return id;
  };

  // 候选 = 工作区里尚未加入本频道的 agent / human
  const candidates = useMemo(() => {
    const present = new Set((members ?? []).map((m) => `${m.memberType}:${m.memberId}`));
    const agents = props.agents
      .filter((a) => !present.has(`agent:${a.handle}`))
      .map((a) => ({ type: "agent" as const, id: a.handle, name: a.displayName }));
    const humans = props.humans
      .filter((h) => !present.has(`human:${h.handle}`))
      .map((h) => ({ type: "human" as const, id: h.handle, name: h.displayName }));
    return [...agents, ...humans];
  }, [members, props.agents, props.humans]);

  const mutate = async (fn: () => Promise<ChannelMember[]>) => {
    setBusy(true); setError(null);
    try { setMembers(await fn()); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" data-testid="channel-members-dialog" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">Members — #{props.channelName}</div>
        <div className="modal-body">
          {error && <div className="gate-error">{error}</div>}
          {members === null && !error && <div className="fake">Loading…</div>}
          {members?.length === 0 && <div className="fake">No members</div>}
          {members?.map((m) => (
            <div className="member-row" key={`${m.memberType}:${m.memberId}`} style={{ cursor: "default" }} data-testid="channel-member">
              {m.memberType !== "system" && <Avatar type={m.memberType} id={m.memberId} size={26} />}
              <span className="nm">{nameOf(m.memberType, m.memberId)}</span>
              <span className="member-sub">{m.role}</span>
              <span className="grow" />
              {m.memberType !== "system" && m.role !== "owner" && (
                <button
                  className="hbtn icon" data-testid="member-remove" title="Remove from channel" disabled={busy}
                  onClick={() => void mutate(() => props.onRemove(props.channelId, { type: m.memberType as "agent" | "human", id: m.memberId }))}
                ><X size={14} /></button>
              )}
            </div>
          ))}

          {/* 添加成员 */}
          {members !== null && (
            adding ? (
              <div className="member-add" data-testid="member-add-list">
                <div className="member-sub" style={{ padding: "6px 2px" }}>Add agent or human</div>
                {candidates.length === 0 && <div className="fake">Everyone is already a member</div>}
                {candidates.map((cand) => (
                  <div className="member-row" key={`${cand.type}:${cand.id}`}>
                    <Avatar type={cand.type} id={cand.id} size={26} />
                    <span className="nm">{cand.name}</span>
                    <span className="member-sub">{cand.type}</span>
                    <span className="grow" />
                    <button
                      className="nb-btn" data-testid="member-add" disabled={busy}
                      onClick={() => void mutate(() => props.onAdd(props.channelId, { type: cand.type, id: cand.id }))}
                    >Add</button>
                  </div>
                ))}
                <button className="nb-btn" style={{ marginTop: 6 }} onClick={() => setAdding(false)}>Done</button>
              </div>
            ) : (
              <button className="nb-btn" data-testid="member-add-toggle" style={{ marginTop: 8 }} onClick={() => setAdding(true)}>
                <Plus size={14} /> Add member
              </button>
            )
          )}
        </div>
        <div className="modal-foot">
          {props.joined && (
            <button className="nb-btn danger" data-testid="channel-leave" disabled={busy}
              onClick={async () => { setBusy(true); try { await props.onLeave(props.channelId); props.onClose(); } finally { setBusy(false); } }}>
              Leave channel
            </button>
          )}
          <span className="grow" />
          <button className="nb-btn" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
