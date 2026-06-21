/** Create Agent dialog — aligned with raft: a single NAME field (the handle used for
 *  @mentions is derived from it automatically), plus Computer / Description / Runtime / Model.
 *  English UI (product targets overseas users). Backend remains the source of truth
 *  (duplicate handle → 409, invalid → 400). */

import { useState } from "react";
import { ModelPicker } from "./ModelPicker.js";
import { RuntimeConfigFields, DEFAULT_RT, type RtConfig } from "./RuntimeConfigFields.js";
import type { Machine, NewAgentInput, AgentProfile } from "../types.js";

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;

const RUNTIMES: ReadonlyArray<readonly [string, string]> = [
  ["claude", "Claude Code"],
  ["codex", "Codex CLI"],
  ["cursor", "Cursor CLI"],
  ["gemini", "Gemini CLI"],
  ["opencode", "OpenCode"],
];

/** Derive an @mention handle from the display name (lowercase ascii slug). */
function deriveHandle(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 31);
}

export function NewAgentDialog(props: {
  machines: Machine[];
  onCreate: (input: NewAgentInput) => Promise<AgentProfile>;
  onClose: () => void;
  onCreated: (handle: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [runtime, setRuntime] = useState("claude");
  const [model, setModel] = useState("");
  const [machineId, setMachineId] = useState("");
  const [rt, setRt] = useState<RtConfig>(DEFAULT_RT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = deriveHandle(name);
  const valid = HANDLE_RE.test(handle);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const created = await props.onCreate({
        handle,
        displayName: name.trim(),
        runtime,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(avatarUrl.trim() ? { avatarUrl: avatarUrl.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(machineId ? { machineId } : {}),
        provider: rt.provider, reasoning: rt.reasoning, fastMode: rt.fastMode,
        ...(rt.provider === "custom" ? { providerBaseUrl: rt.providerBaseUrl.trim() || null, providerApiKey: rt.providerApiKey.trim() || null } : {}),
      });
      props.onCreated(created.handle);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" data-testid="new-agent-dialog" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">Create Agent</div>
        <div className="modal-body">
          <label>Computer <span className="hint">(which machine runs it; blank = unassigned)</span></label>
          <select data-testid="agent-machine-select" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">Unassigned (assign later)</option>
            {props.machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.status === "online" ? " ● online" : " ○ offline"}
              </option>
            ))}
          </select>
          {props.machines.length === 0 && (
            <div className="field-warn">No computers yet — add one in the Computers panel first.</div>
          )}

          <label>Name</label>
          <input
            data-testid="agent-name-input" placeholder="e.g. Alice" autoFocus
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          {name.trim() && (
            valid
              ? <div className="field-hint" data-testid="derived-handle">Mentioned as <code>@{handle}</code></div>
              : <div className="field-warn">Use latin letters/numbers so it can be @mentioned</div>
          )}

          <label>Description <span className="hint">(optional)</span></label>
          <textarea
            className="modal-textarea" data-testid="agent-desc-input" rows={4} maxLength={3000}
            placeholder="Leave blank for a general-purpose agent, or describe a role…"
            value={description} onChange={(e) => setDescription(e.target.value)}
          />
          <div className="char-count">{description.length}/3000</div>

          <label>Avatar URL <span className="hint">(optional)</span></label>
          <input
            data-testid="agent-avatar-input" placeholder="https://…/avatar.png"
            value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)}
          />

          <label>Runtime</label>
          <select data-testid="agent-runtime-select" value={runtime} onChange={(e) => setRuntime(e.target.value)}>
            {RUNTIMES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>

          <label>Model <span className="hint">(optional, defaults to daemon)</span></label>
          <ModelPicker value={model} onChange={setModel} testid="agent-model-input" />

          <RuntimeConfigFields value={rt} onChange={setRt} />
          {error && <div className="gate-error" data-testid="new-agent-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="nb-btn" onClick={props.onClose} disabled={busy}>Cancel</button>
          <button className="nb-btn primary" data-testid="agent-create-submit" onClick={submit} disabled={!valid || busy}>
            {busy ? "Creating…" : "Create Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
