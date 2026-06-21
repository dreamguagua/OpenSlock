/** 添加电脑弹窗(两步):
 *  1) 选类型 —— YOUR COMPUTER(本机)/ CLOUD COMPUTER(占位 coming soon)→ Next
 *  2) 连接 —— 新建机器拿到「在该电脑终端执行的命令」,展示 + 复制;轮询直到该机器 online → Done
 *  ADD COMPUTER / CONNECT COMPUTER 流程。 */

import { useEffect, useRef, useState } from "react";
import { Monitor, Cloud, Copy, Terminal, CheckCircle2, Loader } from "lucide-react";
import { api } from "../api.js";
import type { CreateMachineResult } from "../types.js";

type Step = "choose" | "connect";

export function AddComputerDialog(props: {
  onCreate: (name?: string) => Promise<CreateMachineResult>;
  onConnected: (machineId: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("choose");
  const [name, setName] = useState("");
  const [result, setResult] = useState<CreateMachineResult | null>(null);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const next = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await props.onCreate(name.trim() || undefined);
      setResult(r);
      setStep("connect");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 进入 connect 步:轮询该机器在线状态
  useEffect(() => {
    if (step !== "connect" || !result) return;
    const id = result.machine.id;
    pollRef.current = setInterval(async () => {
      try {
        const m = await api.machine(id);
        if (m.status === "online") {
          setOnline(true);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch { /* 忽略 */ }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, result]);

  const copy = () => { if (result) void navigator.clipboard?.writeText(result.connectCommand).catch(() => {}); };

  return (
    <div className="modal-overlay" data-testid="add-computer-dialog" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">{step === "choose" ? "Add Computer" : "Connect Computer"}</div>

        {step === "choose" && (
          <>
            <div className="modal-body">
              <div className="choose-grid">
                <div className="choose-card selected" data-testid="choose-your-computer">
                  <Monitor size={20} />
                  <div className="cc-title">YOUR COMPUTER</div>
                  <div className="cc-sub">Run agents on your own computer</div>
                </div>
                <div className="choose-card disabled" title="Coming soon">
                  <Cloud size={20} />
                  <div className="cc-title">CLOUD COMPUTER</div>
                  <div className="cc-sub">Coming soon</div>
                </div>
              </div>
              <label style={{ marginTop: 14 }}>Computer name <span className="hint">(optional, defaults to hostname)</span></label>
              <input data-testid="computer-name-input" placeholder="My Computer"
                value={name} onChange={(e) => setName(e.target.value)} />
              {error && <div className="gate-error">{error}</div>}
            </div>
            <div className="modal-foot">
              <button className="nb-btn" onClick={props.onClose} disabled={busy}>Cancel</button>
              <button className="nb-btn primary" data-testid="add-computer-next" onClick={next} disabled={busy}>
                {busy ? "Creating…" : "Next"}
              </button>
            </div>
          </>
        )}

        {step === "connect" && result && (
          <>
            <div className="modal-body">
              <div className="connect-hint"><Terminal size={15} /> Run this command in the terminal of that computer to connect:</div>
              <div className="cmd-box">
                <code data-testid="connect-command">{result.connectCommand}</code>
                <button className="nb-btn" data-testid="copy-command" title="Copy" onClick={copy}><Copy size={13} /></button>
              </div>
              <div className={`wait-banner ${online ? "ok" : ""}`} data-testid="connect-status">
                {online
                  ? <><CheckCircle2 size={14} /> Connected! You can click Done now</>
                  : <><Loader size={14} /> Waiting for computer to connect…</>}
              </div>
              <div className="fake" style={{ marginTop: 8 }}>
                The command template is generated from server config; once connected, this computer reports its OS / runtimes.
              </div>
            </div>
            <div className="modal-foot">
              <button className="nb-btn" onClick={props.onClose}>Cancel</button>
              <button
                className="nb-btn primary" data-testid="connect-done"
                disabled={!online}
                onClick={() => props.onConnected(result.machine.id)}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
