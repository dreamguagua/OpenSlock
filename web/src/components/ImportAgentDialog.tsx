/** Import raft agent dialog — point at an existing raft agent workspace ON the selected
 *  computer; Name/Description are read straight from the workspace's MEMORY.md (auto-filled
 *  when you enter the path). The fields stay editable in case you want to override. */

import { useState, useCallback } from "react";
import { Check } from "lucide-react";
import { api } from "../api.js";
import type { Machine, ImportRaftInput, AgentProfile } from "../types.js";

export function ImportAgentDialog(props: {
  machines: Machine[];
  onImport: (input: ImportRaftInput) => Promise<AgentProfile>;
  onClose: () => void;
  onImported: (handle: string) => void;
}) {
  const [machineId, setMachineId] = useState(props.machines[0]?.id ?? "");
  const [raftPath, setRaftPath] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [edited, setEdited] = useState(false); // 用户是否手改过 → 不再被自动反填覆盖
  const [inspecting, setInspecting] = useState(false);
  const [inspectedFiles, setInspectedFiles] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = Boolean(machineId) && raftPath.trim().length > 0;

  // 输入路径后自动读取工作区 MEMORY.md 反填 Name/Description(不建 agent)
  const inspect = useCallback(async () => {
    if (!machineId || raftPath.trim().length === 0 || busy) return;
    setInspecting(true); setError(null); setInspectedFiles(null);
    try {
      const r = await api.inspectRaftAgent({ machineId, raftPath: raftPath.trim() });
      setInspectedFiles(r.fileCount);
      if (!edited) { setName(r.name); setDescription(r.description); } // 未手改才覆盖
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInspecting(false);
    }
  }, [machineId, raftPath, edited, busy]);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const created = await props.onImport({
        machineId,
        raftPath: raftPath.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      props.onImported(created.handle);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" data-testid="import-agent-dialog" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">Import raft agent</div>
        <div className="modal-body">
          <label>Computer <span className="hint">(where the raft workspace lives)</span></label>
          <select data-testid="import-machine-select" value={machineId} onChange={(e) => { setMachineId(e.target.value); setInspectedFiles(null); }}>
            <option value="">Select a computer…</option>
            {props.machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.status === "online" ? " ● online" : " ○ offline"}
              </option>
            ))}
          </select>
          {props.machines.length === 0 && (
            <div className="field-warn">No computers yet — add one in the Computers panel first.</div>
          )}

          <label>Raft agent workspace path</label>
          <input
            data-testid="import-path-input" autoFocus
            placeholder="e.g. ~/.slock/agents/<agent-id>"
            value={raftPath}
            onChange={(e) => { setRaftPath(e.target.value); setInspectedFiles(null); }}
            onBlur={() => void inspect()}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void inspect(); } }}
          />
          <div className="field-hint">
            Absolute path on the selected computer. <code>MEMORY.md</code>, notes, artifacts and files are copied; raft internals (<code>.git</code>, <code>.slock</code>) are skipped.
          </div>
          {inspecting && <div className="field-hint" data-testid="inspect-status">Reading workspace…</div>}
          {inspectedFiles !== null && !inspecting && (
            <div className="field-hint" data-testid="inspect-ok" style={{ color: "var(--good, #1a7f37)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Check size={13} /> Read from MEMORY.md · {inspectedFiles} item{inspectedFiles === 1 ? "" : "s"} will be copied
            </div>
          )}

          <label>Name <span className="hint">(from MEMORY.md — edit to override)</span></label>
          <input
            data-testid="import-name-input" placeholder="Auto-filled from the workspace"
            value={name} onChange={(e) => { setName(e.target.value); setEdited(true); }}
          />

          <label>Description <span className="hint">(from MEMORY.md — edit to override)</span></label>
          <textarea
            className="modal-textarea" data-testid="import-desc-input" rows={4} maxLength={3000}
            placeholder="Auto-filled from the workspace's Role section"
            value={description} onChange={(e) => { setDescription(e.target.value); setEdited(true); }}
          />

          {error && <div className="gate-error" data-testid="import-agent-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="nb-btn" onClick={props.onClose} disabled={busy}>Cancel</button>
          <button className="nb-btn primary" data-testid="import-submit" onClick={submit} disabled={!valid || busy}>
            {busy ? "Importing…" : "Import agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
