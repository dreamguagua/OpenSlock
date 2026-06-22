import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Square, Users, Archive, RotateCcw, LogOut, Hash, User, MessageSquare, ListChecks, Paperclip } from "lucide-react";
import { api } from "./api.js";
import { useCrew } from "./useCrew.js";
import { TokenGate } from "./components/TokenGate.js";
import { FarRail, type RailSection } from "./components/FarRail.js";
import { ChannelColumn } from "./components/ChannelColumn.js";
import { NewChannelDialog } from "./components/NewChannelDialog.js";
import { ChannelMembersDialog } from "./components/ChannelMembersDialog.js";
import { ActivityView } from "./components/ActivityView.js";
import { SavedView } from "./components/SavedView.js";
import { FilesView } from "./components/FilesView.js";
import { SettingsDialog } from "./components/SettingsDialog.js";
import { ActionsView } from "./components/ActionsView.js";
import { ChatView } from "./components/ChatView.js";
import { TaskBoard } from "./components/TaskBoard.js";
import { Placeholder } from "./components/Placeholder.js";
import { SearchView } from "./components/SearchView.js";
import { ThreadPanel } from "./components/ThreadPanel.js";
import { MembersColumn } from "./components/MembersColumn.js";
import { AgentDetail } from "./components/AgentDetail.js";
import { NewAgentDialog } from "./components/NewAgentDialog.js";
import { ImportAgentDialog } from "./components/ImportAgentDialog.js";
import { ComputersColumn } from "./components/ComputersColumn.js";
import { MachineDetail } from "./components/MachineDetail.js";
import { AddComputerDialog } from "./components/AddComputerDialog.js";

const TOKEN_KEY = "crew_token";
type View = "channel" | "activity" | "saved" | "search" | "members" | "computers" | "actions";
type Tab = "chat" | "tasks" | "files";

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  if (!token) {
    return (
      <TokenGate onConnect={(t) => { localStorage.setItem(TOKEN_KEY, t); setToken(t); }} />
    );
  }
  return <Workspace token={token} onLogout={() => { void api.logout().catch(() => {}); localStorage.removeItem(TOKEN_KEY); setToken(""); }} />;
}

function Workspace(props: { token: string; onLogout: () => void }) {
  const c = useCrew(props.token);
  const [view, setView] = useState<View>("channel");
  const [tab, setTab] = useState<Tab>("chat");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showImportAgent, setShowImportAgent] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [showAddComputer, setShowAddComputer] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const machine = c.machines.find((m) => m.id === selectedMachine) ?? null;
  const channel = c.channels.find((ch) => ch.id === c.selectedChannelId);
  const channelName = channel ? (channel.name ?? channel.slug) : "—";
  // DM 频道 slug 形如 `dm:{humanId}:{agentHandle}` → 取出对端 agent,在头部显示其状态
  const dmHandle = channel?.kind === "dm" ? (channel.slug.split(":").pop() ?? null) : null;
  const dmStatus = dmHandle ? c.agentStatus[dmHandle] : undefined;
  // 头部人数 = 本频道真实成员数(serverInfo 提供),不是全工作区总人数
  const memberCount = channel?.memberCount ?? 0;

  // 线程数据(从当前频道消息派生)
  const threadParent = threadId ? c.messages.find((m) => m.id === threadId) ?? null : null;
  const threadReplies = threadId ? c.messages.filter((m) => m.threadParentId === threadId) : [];
  const threadOpen = view === "channel" && (tab === "chat" || tab === "tasks") && threadParent !== null;

  // @mention / #channel / #task 链接化的数据与跳转
  const memberHandles = new Set<string>([...c.agents.map((a) => a.handle), ...c.humans.map((h) => h.handle)]);
  // @mention 自动补全候选:本工作区的 agent + human(humans 优先,通常更少更相关)
  const mentionMembers = [...c.humans, ...c.agents];
  const jumpChannel = (id: string) => { c.selectChannel(id); setView("channel"); setTab("chat"); setThreadId(null); };
  const jumpTask = () => { setView("channel"); setTab("tasks"); };

  const railActive: RailSection =
    view === "members" ? "members" : view === "computers" ? "computers" : view === "search" ? "search" : "chat";
  const navRail = (s: RailSection) => {
    if (s === "members") setView("members");
    else if (s === "computers") setView("computers");
    else if (s === "search") setView("search");
    else setView("channel");
    setThreadId(null);
  };

  return (
    <div className="shell" data-testid="workspace">
      <FarRail workspaceInitial="C" active={railActive} onNav={navRail} onLogout={props.onLogout} onSettings={() => setShowSettings(true)} />
      <PanelGroup direction="horizontal" className="panes" autoSaveId="crew-panels">
      <Panel id="side" order={1} defaultSize={22} minSize={14} maxSize={40} className="pane">
      {view === "members" ? (
        <MembersColumn
          agents={c.agents}
          humans={c.humans}
          agentStatus={c.agentStatus}
          selectedHandle={selectedAgent}
          onSelectAgent={(h) => setSelectedAgent(h)}
          onNewAgent={() => setShowNewAgent(true)}
          onImportAgent={() => setShowImportAgent(true)}
        />
      ) : view === "computers" ? (
        <ComputersColumn
          machines={c.machines}
          selectedId={selectedMachine}
          onSelect={(id) => setSelectedMachine(id)}
          onAdd={() => setShowAddComputer(true)}
        />
      ) : (
        <ChannelColumn
          channels={c.channels}
          selectedChannelId={c.selectedChannelId}
          view={view}
          onSelect={(id) => { c.selectChannel(id); setView("channel"); setTab("chat"); }}
          onNav={(v) => setView(v)}
          onNewChannel={() => setShowNewChannel(true)}
        />
      )}
      </Panel>

      <PanelResizeHandle className="resizer" />

      <Panel id="main" order={2} minSize={30} className="pane">
      <main className="main">
        {view === "members" && (
          selectedAgent
            ? <AgentDetail
                handle={selectedAgent}
                machines={c.machines}
                activity={c.agentActivity[selectedAgent]}
                status={c.agentStatus[selectedAgent]}
                onSave={c.editAgent}
                onDelete={c.removeAgent}
                onDeleted={() => setSelectedAgent(null)}
                onMessage={(h) => { void c.openDm(h).then(() => { setView("channel"); setTab("chat"); setThreadId(null); }); }}
              />
            : <><PaneHeader title="Members" connected={c.connected} onLogout={props.onLogout} /><Placeholder title="Select an agent" note="Click an agent on the left to view Profile / Workspace / Activity, or click + to create one" /></>
        )}
        {view === "computers" && (
          machine
            ? <MachineDetail machine={machine} agentStatus={c.agentStatus} onRename={c.renameMachine} />
            : <><PaneHeader title="Computers" connected={c.connected} onLogout={props.onLogout} /><Placeholder title="Select a computer" note="Click a computer on the left to view its info and agents, or click + to add one" /></>
        )}
        {view === "activity" && (
          <>
            <PaneHeader title="Activity" connected={c.connected} onLogout={props.onLogout} />
            <ActivityView
              channels={c.channels}
              agents={c.agents}
              humans={c.humans}
              onJump={(id) => { c.selectChannel(id); setView("channel"); setTab("chat"); setThreadId(null); }}
            />
          </>
        )}
        {view === "saved" && (
          <>
            <PaneHeader title="Saved" connected={c.connected} onLogout={props.onLogout} />
            <SavedView channels={c.channels} onJump={(id) => { c.selectChannel(id); setView("channel"); setTab("chat"); setThreadId(null); }} />
          </>
        )}
        {view === "actions" && (
          <>
            <PaneHeader title="Actions" connected={c.connected} onLogout={props.onLogout} />
            <ActionsView reloadKey={c.actionsTick} />
          </>
        )}
        {view === "search" && (
          <>
            <PaneHeader title="Search" connected={c.connected} onLogout={props.onLogout} />
            <SearchView
              channels={c.channels}
              agentStatus={c.agentStatus}
              onSearch={c.search}
              onJump={(id) => { c.selectChannel(id); setView("channel"); setTab("chat"); }}
            />
          </>
        )}

        {view === "channel" && (
          <>
            <div className="ch-head">
              <div className="sq">{channel?.kind === "dm" ? <User size={18} /> : <Hash size={18} />}</div>
              <div>
                <div className="nm">
                  {channelName}
                  {dmStatus && <> <span className={`dot ${dmStatus.kind}`} /> <span className="hero-status">{dmStatus.label}</span></>}
                </div>
                <div className="desc">{channel?.description ?? <span className="fake">Channel description (placeholder)</span>}</div>
              </div>
              <div className="right head-actions">
                <span
                  className={`live-pill ${c.connected ? "on" : ""}`}
                  title={c.connected ? "你的浏览器与服务器的实时连接正常(与 agent 是否在线无关)" : "正在连接服务器…"}
                >
                  <span className="live-dot" />{c.connected ? "Live" : "Connecting"}
                </span>
                <button className="hbtn icon" title="Stop all agents in this channel (placeholder)"><Square size={15} /></button>
                {channel && channel.kind !== "dm" && !channel.joined && (
                  <button className="hbtn primary" data-testid="channel-join" onClick={() => c.joinChannel(channel.id)}>Join</button>
                )}
                {channel && channel.kind !== "dm" && (
                  <button className="hbtn" data-testid="open-members" title="Members" onClick={() => setShowMembers(true)}>
                    <Users size={15} /><span className="hbtn-count">{memberCount}</span>
                  </button>
                )}
                {channel && channel.kind !== "dm" && (
                  <button
                    className="hbtn" data-testid="archive-toggle"
                    title={channel.archived ? "Unarchive channel" : "Archive channel (read-only)"}
                    onClick={() => c.archiveChannel(channel.id, !channel.archived)}
                  >
                    {channel.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                    {channel.archived ? "Unarchive" : "Archive"}
                  </button>
                )}
                <button className="hbtn" data-testid="logout-btn" title="Sign out" onClick={props.onLogout}><LogOut size={14} /> Sign out</button>
              </div>
            </div>

            <div className="tabs">
              <div className={`tab ${tab === "chat" ? "active" : ""}`} data-testid="tab-chat" onClick={() => setTab("chat")}><span className="ti"><MessageSquare size={15} /></span> Chat</div>
              <div className={`tab ${tab === "tasks" ? "active" : ""}`} data-testid="tab-tasks" onClick={() => setTab("tasks")}><span className="ti"><ListChecks size={15} /></span> Tasks</div>
              <div className={`tab ${tab === "files" ? "active" : ""}`} data-testid="tab-files" onClick={() => setTab("files")}><span className="ti"><Paperclip size={15} /></span> Files</div>
            </div>

            {c.error && <div className="error-banner" data-testid="error-banner">{c.error}</div>}

            {tab === "chat" && (
              <ChatView
                channelName={channelName}
                channelId={c.selectedChannelId}
                messages={c.messages}
                tasks={c.tasks}
                disabled={!c.selectedChannelId || Boolean(channel?.archived)}
                archived={Boolean(channel?.archived)}
                activeThreadId={threadId}
                channels={c.channels}
                memberHandles={memberHandles}
                members={mentionMembers}
                agentActivity={c.agentActivity}
                agentStatus={c.agentStatus}
                onChannel={jumpChannel}
                onTask={jumpTask}
                onSend={c.send}
                onSendFiles={c.sendWithFiles}
                onOpenThread={(m) => setThreadId(m.id)}
                onToggleReaction={c.toggleReaction}
                onToggleSave={c.toggleSave}
              />
            )}
            {tab === "tasks" && (
              <TaskBoard
                tasks={c.tasks}
                disabled={!c.selectedChannelId}
                onCreate={c.createTask}
                onClaim={c.claimTask}
                onSetStatus={c.setTaskStatus}
                onUnclaim={c.unclaimTask}
                onMove={c.moveTask}
                onOpenTask={(t) => setThreadId(t.messageId)}
              />
            )}
            {tab === "files" && (c.selectedChannelId ? <FilesView channelId={c.selectedChannelId} /> : <Placeholder title="Files" note="Select a channel" />)}
          </>
        )}
      </main>
      </Panel>

      {threadOpen && threadParent && (
        <>
          <PanelResizeHandle className="resizer" />
          <Panel id="thread" order={3} defaultSize={28} minSize={16} maxSize={50} className="pane">
            <ThreadPanel
              channelName={channelName}
              parent={threadParent}
              replies={threadReplies}
              channels={c.channels}
              memberHandles={memberHandles}
              members={mentionMembers}
              agentStatus={c.agentStatus}
              onChannel={jumpChannel}
              onTask={jumpTask}
              onReply={(content) => c.reply(threadParent.id, content)}
              onReplyFiles={(content, files) => c.replyWithFiles(threadParent.id, content, files)}
              onClose={() => setThreadId(null)}
            />
          </Panel>
        </>
      )}
      </PanelGroup>

      {showNewAgent && (
        <NewAgentDialog
          machines={c.machines}
          onCreate={c.createAgent}
          onClose={() => setShowNewAgent(false)}
          onCreated={(handle) => { setShowNewAgent(false); setSelectedAgent(handle); }}
        />
      )}

      {showSettings && (
        <SettingsDialog
          connected={c.connected}
          onClose={() => setShowSettings(false)}
          onLogout={() => { setShowSettings(false); props.onLogout(); }}
        />
      )}

      {showImportAgent && (
        <ImportAgentDialog
          machines={c.machines}
          onImport={c.importAgent}
          onClose={() => setShowImportAgent(false)}
          onImported={(handle) => { setShowImportAgent(false); setView("members"); setSelectedAgent(handle); }}
        />
      )}

      {showAddComputer && (
        <AddComputerDialog
          onCreate={c.createMachine}
          onClose={() => setShowAddComputer(false)}
          onConnected={(id) => { setShowAddComputer(false); setSelectedMachine(id); void c.refreshMachines(); }}
        />
      )}

      {showNewChannel && (
        <NewChannelDialog
          agents={c.agents}
          humans={c.humans}
          onCreate={c.createChannel}
          onClose={() => setShowNewChannel(false)}
          onCreated={() => { setShowNewChannel(false); setView("channel"); setTab("chat"); }}
        />
      )}

      {showMembers && channel && (
        <ChannelMembersDialog
          channelId={channel.id}
          channelName={channelName}
          joined={channel.joined}
          agents={c.agents}
          humans={c.humans}
          onLeave={c.leaveChannel}
          onAdd={c.addChannelMember}
          onRemove={c.removeChannelMember}
          onClose={() => setShowMembers(false)}
        />
      )}
    </div>
  );
}

function PaneHeader(props: { title: string; connected: boolean; onLogout: () => void }) {
  return (
    <div className="ch-head">
      <div className="sq">{props.title.slice(0, 1)}</div>
      <div className="nm">{props.title}</div>
      <div className="right">
        <button className="nb-btn" onClick={props.onLogout}>Sign out</button>
      </div>
    </div>
  );
}
