/** Members 栏(第二列):AGENTS / HUMANS 分组列表 + 新建 agent。
 *  成员面板:每行 = 头像 + 名称 + 描述/状态点。点击 agent 打开详情。
 *  Graph / 新建 human 暂为占位(后期补充)。 */

import { useState } from "react";
import { Plus, GitBranch, Bot, Download } from "lucide-react";
import { Avatar } from "./Avatar.js";
import type { AgentStatusInfo, Member } from "../types.js";

export function MembersColumn(props: {
  agents: Member[];
  humans: Member[];
  agentStatus: Record<string, AgentStatusInfo>;
  selectedHandle: string | null;
  onSelectAgent: (handle: string) => void;
  onNewAgent: () => void;
  onImportAgent: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="col" data-testid="members-column">
      <div className="col-head">Members</div>
      <div className="col-scroll">
        <div className="nav-item" title="Relationship graph (coming soon)">
          <GitBranch size={16} /><span className="grow">Graph</span>
        </div>

        <div className="sect" style={{ position: "relative" }}>
          <span>AGENTS</span><span className="count">{props.agents.length}</span>
          <span className="grow" />
          <button
            className="sect-add" data-testid="add-agent-btn" title="Add agent"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Plus size={15} />
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="popmenu" data-testid="add-agent-menu">
                <button
                  className="popmenu-item" data-testid="menu-create-agent"
                  onClick={() => { setMenuOpen(false); props.onNewAgent(); }}
                >
                  <Bot size={15} /> Create Agent
                </button>
                <button
                  className="popmenu-item" data-testid="menu-import-agent"
                  onClick={() => { setMenuOpen(false); props.onImportAgent(); }}
                >
                  <Download size={15} /> Import raft agent
                </button>
              </div>
            </>
          )}
        </div>
        {props.agents.length === 0 && (
          <div className="member-row"><span className="nm" style={{ color: "#999" }}>No agents yet</span></div>
        )}
        {props.agents.map((a) => {
          const st = props.agentStatus[a.handle];
          const kind = st?.kind ?? (a.online ? "online" : "offline");
          return (
            <div
              key={a.handle}
              data-testid="agent-row"
              className={`member-row ${a.handle === props.selectedHandle ? "active" : ""}`}
              onClick={() => props.onSelectAgent(a.handle)}
            >
              <Avatar type="agent" id={a.handle} size={26} status={kind} url={a.avatarUrl} />
              <span className="nm">{a.displayName}</span>
              {a.description && <span className="member-sub">{a.description}</span>}
              <span className={`dot ${kind}`} title={st?.label ?? kind} />
            </div>
          );
        })}

        <div className="sect">
          <span>HUMANS</span><span className="count">{props.humans.length}</span>
          <span className="grow" />
          <button className="sect-add" title="Invite member (coming soon)"><Plus size={15} /></button>
        </div>
        {props.humans.map((h) => (
          <div key={h.handle} className="member-row" data-testid="human-row">
            <Avatar type="human" id={h.handle} size={26} />
            <span className="nm">{h.displayName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
