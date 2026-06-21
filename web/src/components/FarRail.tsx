/** 最左图标栏:工作区图标 + 导航图标(Lucide 开源图标,本地打包)+ 底部头像/设置。
 *  Chat / 搜索 / 成员 已接入真实视图;其余为视觉占位(标注 TODO)。 */

import { MessageSquare, Search, CheckCheck, Users, Monitor, Settings } from "lucide-react";

export type RailSection = "chat" | "search" | "members" | "computers";

export function FarRail(props: {
  workspaceInitial: string;
  active: RailSection;
  onNav: (s: RailSection) => void;
  onLogout: () => void;
  onSettings: () => void;
}) {
  return (
    <nav className="rail">
      <div className="ws" title="Workspace & settings" data-testid="rail-workspace" onClick={props.onSettings}>{props.workspaceInitial}</div>
      <div className={`icon ${props.active === "chat" ? "active" : ""}`} title="Chat" data-testid="rail-chat" onClick={() => props.onNav("chat")}><MessageSquare size={20} /></div>
      <div className={`icon ${props.active === "search" ? "active" : ""}`} title="Search" data-testid="rail-search" onClick={() => props.onNav("search")}><Search size={20} /></div>
      <div className="icon" title="Tasks (placeholder)"><CheckCheck size={20} /></div>
      <div className={`icon ${props.active === "members" ? "active" : ""}`} title="Members" data-testid="rail-members" onClick={() => props.onNav("members")}><Users size={20} /></div>
      <div className={`icon ${props.active === "computers" ? "active" : ""}`} title="Computers" data-testid="rail-computers" onClick={() => props.onNav("computers")}><Monitor size={20} /></div>
      <div className="spacer" />
      <div className="avatar" title="Sign out" onClick={props.onLogout}>You</div>
      <div className="icon" title="Settings" data-testid="rail-settings" onClick={props.onSettings}><Settings size={20} /></div>
    </nav>
  );
}
