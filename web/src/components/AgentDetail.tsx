/** Agent detail (main pane): header + Profile / Workspace / Activity tabs.
 *  Profile is editable (display name / description / runtime / model / computer) and the
 *  agent can be deleted. Full profile is fetched by handle; Activity reuses the live stream. */

import { useEffect, useState, useCallback } from "react";
import { IdCard, FolderOpen, Activity as ActivityIcon, MessageSquare, Pencil, Trash2, RefreshCw } from "lucide-react";
import { Avatar } from "./Avatar.js";
import { ModelPicker } from "./ModelPicker.js";
import { RuntimeConfigFields, type RtConfig } from "./RuntimeConfigFields.js";
import { WorkspaceTab } from "./WorkspaceView.js";
import { api } from "../api.js";
import type { AgentPatch, AgentProfile, AgentActivity, AgentActivityItem, AgentStatusInfo, Machine, SkillInfo } from "../types.js";

type DetailTab = "profile" | "workspace" | "activity";

const RUNTIMES: ReadonlyArray<readonly [string, string]> = [
  ["claude", "Claude Code"],
  ["codex", "Codex CLI"],
  ["cursor", "Cursor CLI"],
  ["gemini", "Gemini CLI"],
  ["opencode", "OpenCode"],
];

export function AgentDetail(props: {
  handle: string;
  machines: Machine[];
  activity?: AgentActivity | undefined;
  status?: AgentStatusInfo | undefined;
  onSave: (handle: string, patch: AgentPatch) => Promise<AgentProfile>;
  onDelete: (handle: string) => Promise<void>;
  onDeleted: () => void;
  onMessage: (handle: string) => void;
}) {
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("profile");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    setAgent(null); setError(null); setTab("profile"); setEditing(false);
    api.agent(props.handle)
      .then((a) => { if (alive) setAgent(a); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [props.handle]);

  if (error) return <div className="error-banner" data-testid="agent-detail-error">{error}</div>;
  if (!agent) return <div className="empty">Loading agent…</div>;

  const status: AgentStatusInfo = props.status ?? { kind: "offline", label: "Offline" };

  return (
    <div className="agent-detail" data-testid="agent-detail">
      <div className="ch-head">
        <Avatar type="agent" id={agent.handle} size={34} status={status.kind} url={agent.avatarUrl} />
        <div className="head-meta">
          <div className="nm">{agent.displayName}</div>
          <div className="desc">{agent.description || <span className="fake">No description</span>}</div>
        </div>
        <div className="right">
          <button className="nb-btn" data-testid="agent-message" title="Open DM" onClick={() => props.onMessage(agent.handle)}>
            <MessageSquare size={14} /> Message
          </button>
          {tab === "profile" && !editing && (
            <button className="nb-btn" data-testid="agent-edit" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === "profile" ? "active" : ""}`} data-testid="agent-tab-profile" onClick={() => { setTab("profile"); }}>
          <span className="ti"><IdCard size={14} /></span> Profile
        </div>
        <div className={`tab ${tab === "workspace" ? "active" : ""}`} data-testid="agent-tab-workspace" onClick={() => { setTab("workspace"); setEditing(false); }}>
          <span className="ti"><FolderOpen size={14} /></span> Workspace
        </div>
        <div className={`tab ${tab === "activity" ? "active" : ""}`} data-testid="agent-tab-activity" onClick={() => { setTab("activity"); setEditing(false); }}>
          <span className="ti"><ActivityIcon size={14} /></span> Activity
        </div>
      </div>

      <div className="agent-pane">
        {tab === "profile" && (
          editing
            ? <ProfileEdit
                agent={agent} machines={props.machines}
                onCancel={() => setEditing(false)}
                onSave={async (patch) => { const next = await props.onSave(agent.handle, patch); setAgent(next); setEditing(false); }}
                onDelete={async () => { await props.onDelete(agent.handle); props.onDeleted(); }}
              />
            : <ProfileTab agent={agent} status={status} machines={props.machines} />
        )}
        {tab === "workspace" && <WorkspaceTab handle={agent.handle} />}
        {tab === "activity" && <ActivityTab handle={agent.handle} activity={props.activity} />}
      </div>
    </div>
  );
}

function machineName(machines: Machine[], id: string | null): string | null {
  if (!id) return null;
  return machines.find((m) => m.id === id)?.name ?? id;
}

function ProfileTab(props: { agent: AgentProfile; status: AgentStatusInfo; machines: Machine[] }) {
  const a = props.agent;
  const created = new Date(a.createdAt);
  const createdStr = Number.isNaN(created.getTime())
    ? a.createdAt
    : created.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const comp = machineName(props.machines, a.machineId);
  return (
    <div className="profile" data-testid="agent-profile">
      <div className="profile-hero">
        <Avatar type="agent" id={a.handle} size={64} status={props.status.kind} url={a.avatarUrl} />
        <div>
          <div className="hero-name">{a.displayName} <span className={`dot ${props.status.kind}`} /> <span className="hero-status">{props.status.label}</span></div>
          <div className="hero-handle">@{a.handle}</div>
        </div>
      </div>

      <Field label="DISPLAY NAME">{a.displayName}</Field>
      <Field label="DESCRIPTION">{a.description || <span className="fake">No description</span>}</Field>

      <div className="profile-sect">INFO</div>
      <div className="kv">
        <div className="k">Computer</div>
        <div className="v">{comp ?? <span className="fake">Unassigned</span>}</div>
        <div className="k">Created</div>
        <div className="v">{createdStr}</div>
      </div>

      <div className="profile-sect">RUNTIME CONFIG</div>
      <div className="badges">
        <span className="rt-badge runtime">{a.runtime}</span>
        <span className="rt-badge model">{a.model ?? "Default model"}</span>
        <span className="rt-badge">Provider: {a.provider === "custom" ? "Custom (BYOC)" : "Default"}</span>
        <span className="rt-badge">Reasoning: {a.reasoning}</span>
        {a.fastMode && <span className="rt-badge">Fast mode</span>}
      </div>

      <SkillsSection handle={a.handle} />
    </div>
  );
}

function SkillsSection(props: { handle: string }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSkills(null); setError(null);
    api.agentSkills(props.handle)
      .then((s) => { if (alive) setSkills(s); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [props.handle]);

  const ws = skills?.filter((s) => s.scope === "workspace") ?? [];
  const global = skills?.filter((s) => s.scope === "global") ?? [];

  return (
    <>
      <div className="profile-sect">SKILLS {skills ? `(${skills.length})` : ""}</div>
      {error && <div className="fake" data-testid="skills-note">{error}</div>}
      {!error && skills === null && <div className="fake">Loading…</div>}
      {!error && skills && skills.length === 0 && <div className="fake">No skills detected</div>}
      <SkillGroup label="Workspace" items={ws} />
      <SkillGroup label="Global" items={global} />
    </>
  );
}

function SkillGroup(props: { label: string; items: SkillInfo[] }) {
  if (props.items.length === 0) return null;
  return (
    <div className="skill-group" data-testid={`skills-${props.label.toLowerCase()}`}>
      <div className="skill-group-head">{props.label} <span className="count">({props.items.length})</span></div>
      <div className="skill-cards">
        {props.items.map((s) => (
          <div className="skill-card" key={`${s.scope}:${s.name}`} data-testid="skill-card">
            <div className="skill-name">{s.name}</div>
            {s.description && <div className="skill-desc">{s.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileEdit(props: {
  agent: AgentProfile;
  machines: Machine[];
  onSave: (patch: AgentPatch) => Promise<void>;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const a = props.agent;
  const [displayName, setDisplayName] = useState(a.displayName);
  const [description, setDescription] = useState(a.description);
  const [avatarUrl, setAvatarUrl] = useState(a.avatarUrl ?? "");
  const [runtime, setRuntime] = useState(a.runtime);
  const [model, setModel] = useState(a.model ?? "");
  const [machineId, setMachineId] = useState(a.machineId ?? "");
  const [rt, setRt] = useState<RtConfig>({
    provider: a.provider, providerBaseUrl: a.providerBaseUrl ?? "", providerApiKey: a.providerApiKey ?? "",
    reasoning: a.reasoning, fastMode: a.fastMode,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const save = async () => {
    if (!displayName.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await props.onSave({
        displayName: displayName.trim(),
        description: description.trim(),
        avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null,
        runtime,
        model: model.trim() ? model.trim() : null,
        machineId: machineId || null,
        provider: rt.provider, reasoning: rt.reasoning, fastMode: rt.fastMode,
        providerBaseUrl: rt.provider === "custom" ? (rt.providerBaseUrl.trim() || null) : null,
        providerApiKey: rt.provider === "custom" ? (rt.providerApiKey.trim() || null) : null,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true); setError(null);
    try { await props.onDelete(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <div className="profile" data-testid="agent-profile-edit">
      <div className="profile-hero">
        <Avatar type="agent" id={a.handle} size={64} url={avatarUrl} />
        <div><div className="hero-handle">@{a.handle} <span className="fake">(handle is fixed)</span></div></div>
      </div>

      <label className="edit-label">DISPLAY NAME</label>
      <input className="edit-input" data-testid="edit-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />

      <label className="edit-label">AVATAR URL <span className="fake">(optional)</span></label>
      <input className="edit-input" data-testid="edit-avatar" placeholder="https://…/avatar.png" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />

      <label className="edit-label">DESCRIPTION</label>
      <textarea
        className="edit-input edit-textarea" data-testid="edit-desc" rows={4} maxLength={3000}
        placeholder="Leave blank for a general-purpose agent, or describe a role…"
        value={description} onChange={(e) => setDescription(e.target.value)}
      />
      <div className="char-count">{description.length}/3000</div>

      <label className="edit-label">COMPUTER</label>
      <select className="edit-input" data-testid="edit-machine" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
        <option value="">Unassigned</option>
        {props.machines.map((m) => (
          <option key={m.id} value={m.id}>{m.name}{m.status === "online" ? " ● online" : " ○ offline"}</option>
        ))}
      </select>

      <label className="edit-label">RUNTIME</label>
      <select className="edit-input" data-testid="edit-runtime" value={runtime} onChange={(e) => setRuntime(e.target.value)}>
        {RUNTIMES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        {!RUNTIMES.some(([v]) => v === runtime) && <option value={runtime}>{runtime}</option>}
      </select>

      <label className="edit-label">MODEL <span className="hint">(optional)</span></label>
      <ModelPicker value={model} onChange={setModel} controlClass="edit-input" testid="edit-model" />

      <RuntimeConfigFields value={rt} onChange={setRt} controlClass="edit-input" />

      {error && <div className="gate-error" data-testid="agent-edit-error">{error}</div>}

      <div className="edit-actions">
        <button className="nb-btn primary" data-testid="agent-save" disabled={busy || !displayName.trim()} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="nb-btn" onClick={props.onCancel} disabled={busy}>Cancel</button>
        <span className="grow" />
        {confirmDel ? (
          <>
            <span className="del-confirm">Delete @{a.handle}?</span>
            <button className="nb-btn danger" data-testid="agent-delete-confirm" disabled={busy} onClick={del}>Delete</button>
            <button className="nb-btn" disabled={busy} onClick={() => setConfirmDel(false)}>Keep</button>
          </>
        ) : (
          <button className="nb-btn danger" data-testid="agent-delete" disabled={busy} onClick={() => setConfirmDel(true)}>
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

function ActivityTab(props: { handle: string; activity?: AgentActivity | undefined }) {
  const [history, setHistory] = useState<AgentActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.agentActivity(props.handle).then(setHistory).catch((e) => setError((e as Error).message));
  }, [props.handle]);

  // 初次加载 + 实时活动到来时刷新历史(落库是异步的,延后再拉)
  useEffect(() => { setHistory(null); load(); }, [load]);
  useEffect(() => {
    if (!props.activity) return;
    const t = setTimeout(load, 800);
    return () => clearTimeout(t);
  }, [props.activity, load]);

  const ts = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-US"); };

  return (
    <div className="activity-log" data-testid="agent-activity">
      <div className="act-toolbar">
        <span className="profile-sect" style={{ margin: 0 }}>ACTIVITY</span>
        <span className="grow" />
        <button className="nb-btn" data-testid="activity-refresh" onClick={load}><RefreshCw size={13} /></button>
      </div>

      {props.activity && (
        <div className="act-row live" data-testid="activity-live">
          <span className="dot on" />
          <span className="act-kind">{props.activity.activity}</span>
          <span className="act-detail">{props.activity.detail}</span>
          <span className="act-time">live</span>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      {history === null && !error && <div className="fake" style={{ padding: 8 }}>Loading…</div>}
      {history?.length === 0 && !props.activity && (
        <div className="activity-empty"><ActivityIcon size={28} /><div>No activity yet</div>
          <div className="fake">Activity is recorded when this agent works in a channel.</div>
        </div>
      )}
      {history?.map((h) => (
        <div className="act-row" key={h.id} data-testid="activity-row">
          <span className="dot idle" />
          <span className="act-kind">{h.activity}</span>
          <span className="act-detail">{h.detail}</span>
          <span className="act-time">{ts(h.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="field-block">
      <div className="field-label">{props.label}</div>
      <div className="field-value">{props.children}</div>
    </div>
  );
}
