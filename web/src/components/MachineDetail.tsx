/** 电脑详情(主面板):头部 + NAME(可改名)+ INFO(OS/daemon 版本/runtimes/创建时间)
 *  + AGENTS ON THIS COMPUTER(跑在这台机器上的 agent)。computer 详情页。 */

import { useEffect, useState } from "react";
import { Monitor, Pencil, Check, RefreshCw, Copy } from "lucide-react";
import { Avatar } from "./Avatar.js";
import { api } from "../api.js";
import type { AgentProfile, AgentStatusInfo, Machine } from "../types.js";

export function MachineDetail(props: {
  machine: Machine;
  agentStatus: Record<string, AgentStatusInfo>;
  onRename: (id: string, name: string) => Promise<Machine>;
}) {
  const m = props.machine;
  const online = m.status === "online";
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);
  const [command, setCommand] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setName(m.name); setEditing(false); setCommand(null);
    api.agents().then((all) => { if (alive) setAgents(all.filter((a) => a.machineId === m.id)); }).catch(() => {});
    return () => { alive = false; };
  }, [m.id, m.name]);

  const generate = async () => {
    if (genBusy) return;
    setGenBusy(true);
    try { setCommand((await api.connectCommand(m.id)).connectCommand); }
    catch { /* 忽略 */ }
    finally { setGenBusy(false); }
  };
  const copyCmd = () => { if (command) void navigator.clipboard?.writeText(command).catch(() => {}); };

  const created = new Date(m.createdAt);
  const createdStr = Number.isNaN(created.getTime())
    ? m.createdAt
    : created.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

  const saveName = async () => {
    const next = name.trim();
    if (next && next !== m.name) await props.onRename(m.id, next);
    setEditing(false);
  };

  return (
    <div className="agent-detail" data-testid="machine-detail">
      <div className="ch-head">
        <span className="mono-icon big"><Monitor size={22} /></span>
        <div>
          <div className="nm">{m.name}</div>
          <div className="desc">
            <span className={`dot ${online ? "on" : "idle"}`} /> {online ? "Connected" : "Offline"}
            {m.hostname ? ` · ${m.hostname}` : ""}
          </div>
        </div>
      </div>

      <div className="agent-pane">
        <div className="profile" style={{ maxWidth: 720 }}>
          <div className="field-block">
            <div className="field-label">NAME</div>
            {editing ? (
              <div className="inline-edit">
                <input data-testid="machine-name-input" value={name} autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveName()} />
                <button className="nb-btn" data-testid="machine-name-save" onClick={saveName}><Check size={14} /></button>
              </div>
            ) : (
              <div className="field-value">
                {m.name}
                <button className="icon-btn" data-testid="machine-rename" title="Rename" onClick={() => setEditing(true)}>
                  <Pencil size={13} />
                </button>
              </div>
            )}
          </div>

          <div className="profile-sect">INFO</div>
          <div className="kv">
            <div className="k">OS</div>
            <div className="v">{m.os ?? <span className="fake">Not reported</span>}</div>
            <div className="k">Daemon Version</div>
            <div className="v">{m.daemonVersion ?? <span className="fake">Not connected</span>}</div>
            <div className="k">Created</div>
            <div className="v">{createdStr}</div>
            <div className="k">Token</div>
            <div className="v"><code>{m.tokenPrefix ?? "—"}…</code></div>
          </div>

          <div className="profile-sect">DETECTED RUNTIMES</div>
          <div className="badges">
            {m.runtimes.length === 0 && <span className="fake">Not reported (detected once the daemon connects)</span>}
            {m.runtimes.map((r) => <span key={r} className="rt-badge runtime">{r}</span>)}
          </div>

          <div className="profile-sect">CONNECTION</div>
          {!online && !command && (
            <button className="nb-btn primary" data-testid="generate-command" onClick={generate} disabled={genBusy}>
              <RefreshCw size={14} /> {genBusy ? "Generating…" : "Generate Connect Command"}
            </button>
          )}
          {online && !command && (
            <div className="fake">This computer is connected; to reconnect elsewhere, regenerate the command below.
              <div style={{ marginTop: 8 }}>
                <button className="nb-btn" data-testid="generate-command" onClick={generate} disabled={genBusy}>
                  <RefreshCw size={13} /> {genBusy ? "Generating…" : "Regenerate Connect Command"}
                </button>
              </div>
            </div>
          )}
          {command && (
            <>
              <div className="connect-hint">Run this command in the terminal of that computer to connect:</div>
              <div className="cmd-box">
                <code data-testid="machine-connect-command">{command}</code>
                <button className="nb-btn" title="Copy" onClick={copyCmd}><Copy size={13} /></button>
              </div>
              <div className="fake" style={{ marginTop: 6 }}>Once run, this computer comes online and reports its OS / runtimes. Regenerating invalidates the old command.</div>
            </>
          )}

          <div className="profile-sect">AGENTS ON THIS COMPUTER {agents.length}</div>
          {agents.length === 0 && <div className="fake">No agents are running on this computer yet</div>}
          {agents.map((a) => (
            <div key={a.handle} className="member-row" data-testid="machine-agent-row" style={{ cursor: "default" }}>
              <Avatar type="agent" id={a.handle} size={26} status={props.agentStatus[a.handle]?.kind} />
              <span className="nm">{a.displayName}</span>
              <span className="member-sub">{a.runtime}{a.model ? ` · ${a.model}` : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
