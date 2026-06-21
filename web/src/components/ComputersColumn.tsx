/** Computers 栏(第二列):COMPUTERS 列表 + 新增。每行 = 电脑图标 + 名称 + daemon 版本 + 在线点。
 *  Computers 面板。点击一台电脑打开详情。 */

import { Plus, Monitor } from "lucide-react";
import type { Machine } from "../types.js";

export function ComputersColumn(props: {
  machines: Machine[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="col" data-testid="computers-column">
      <div className="col-head">Computers</div>
      <div className="col-scroll">
        <div className="sect">
          <span>COMPUTERS</span><span className="count">{props.machines.length}</span>
          <span className="grow" />
          <button className="sect-add" data-testid="add-computer-btn" title="Add computer" onClick={props.onAdd}>
            <Plus size={15} />
          </button>
        </div>
        {props.machines.length === 0 && (
          <div className="member-row"><span className="nm" style={{ color: "#999" }}>No computers yet — click + to add</span></div>
        )}
        {props.machines.map((m) => (
          <div
            key={m.id}
            data-testid="computer-row"
            className={`member-row ${m.id === props.selectedId ? "active" : ""}`}
            onClick={() => props.onSelect(m.id)}
          >
            <span className="mono-icon"><Monitor size={18} /></span>
            <span className="comp-text">
              <span className="nm">{m.name}</span>
              <span className="member-sub">daemon {m.daemonVersion ?? "—"}</span>
            </span>
            <span className={`dot ${m.status === "online" ? "on" : "idle"}`} title={m.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
