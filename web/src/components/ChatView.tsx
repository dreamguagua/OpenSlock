/** Chat tab:主流只显示顶层消息;有回复的消息显示「N 条回复」可点开线程。 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentActivity, AgentStatusInfo, Channel, Member, Message, Task } from "../types.js";
import { Avatar } from "./Avatar.js";
import { MentionTextarea } from "./MentionTextarea.js";
import { MessageText } from "./MessageText.js";
import { TaskChip } from "./TaskChip.js";
import { ReactionBar } from "./ReactionBar.js";
import { AttachmentList } from "./AttachmentList.js";
import { Paperclip, Bookmark, MessageSquare, Archive } from "lucide-react";
import { ReactionAdd } from "./ReactionAdd.js";
import { PendingFiles, imagesFromClipboard } from "./PendingFiles.js";
import { ACTIVITY_LABEL } from "../status.js";
import { getChannelSeen, markThreadSeen } from "../threadSeen.js";

export function ChatView(props: {
  channelName: string;
  channelId: string | null;
  messages: Message[];
  tasks: Task[];
  disabled: boolean;
  archived?: boolean;
  activeThreadId: string | null;
  channels: Channel[];
  memberHandles: Set<string>;
  members: Member[];
  agentActivity: Record<string, AgentActivity>;
  agentStatus: Record<string, AgentStatusInfo>;
  onChannel: (id: string) => void;
  onTask: () => void;
  onSend: (text: string, asTask?: boolean) => Promise<void>;
  onSendFiles: (text: string, asTask: boolean, files: File[]) => Promise<void>;
  onOpenThread: (m: Message) => void;
  onToggleReaction: (messageId: string, emoji: string, mine: boolean) => void;
  onToggleSave: (messageId: string, saved: boolean) => void;
}) {
  // 活动条只显示当前频道的活动(activity 是全局收集的,这里按 channelId 过滤)
  const active = Object.entries(props.agentActivity).filter(([, a]) => a.channelId === props.channelId);
  const endRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [asTask, setAsTask] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 顶层消息 + 每条的回复数/回复 seq 列表(用于算「X new」)
  const { topLevel, replyInfo } = useMemo(() => {
    const info = new Map<string, { count: number; lastSeq: number; seqs: number[] }>();
    for (const m of props.messages) {
      if (m.threadParentId) {
        const cur = info.get(m.threadParentId) ?? { count: 0, lastSeq: 0, seqs: [] };
        info.set(m.threadParentId, { count: cur.count + 1, lastSeq: Math.max(cur.lastSeq, m.seq), seqs: [...cur.seqs, m.seq] });
      }
    }
    return { topLevel: props.messages.filter((m) => !m.threadParentId), replyInfo: info };
  }, [props.messages]);

  // 线程已读游标(每个 parentId → 已看到的最大回复 seq);决定「· X new」
  const [seen, setSeen] = useState<Record<string, number>>({});
  // 切频道:载入该频道持久化的已读游标
  useEffect(() => {
    setSeen(props.channelId ? getChannelSeen(props.channelId) : {});
  }, [props.channelId]);
  // 基线:首次见到的线程以当前最大回复 seq 为已读(避免历史线程全部显示为 new)
  useEffect(() => {
    const ch = props.channelId;
    if (!ch) return;
    setSeen((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [pid, info] of replyInfo) {
        if (next[pid] === undefined) { next[pid] = info.lastSeq; markThreadSeen(ch, pid, info.lastSeq); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [props.channelId, replyInfo]);
  // 当前打开的线程:新回复到达即视为已读(保持其 new=0)
  useEffect(() => {
    const ch = props.channelId, pid = props.activeThreadId;
    if (!ch || !pid) return;
    const info = replyInfo.get(pid);
    if (!info) return;
    markThreadSeen(ch, pid, info.lastSeq);
    setSeen((prev) => (prev[pid] === info.lastSeq ? prev : { ...prev, [pid]: info.lastSeq }));
  }, [props.channelId, props.activeThreadId, replyInfo]);

  // 打开线程:标记该线程已读(清零 new)后再交给上层切换
  const openThread = (m: Message) => {
    const info = replyInfo.get(m.id);
    if (info && props.channelId) {
      markThreadSeen(props.channelId, m.id, info.lastSeq);
      setSeen((prev) => ({ ...prev, [m.id]: info.lastSeq }));
    }
    props.onOpenThread(m);
  };

  // 消息 → 关联的 task(task.messageId 锚定):用于在消息下方显示状态彩色 chip
  const taskByMessage = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of props.tasks) map.set(t.messageId, t);
    return map;
  }, [props.tasks]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [topLevel.length]);

  const submit = async () => {
    const t = text.trim();
    if ((!t && files.length === 0) || busy) return;
    setBusy(true);
    try {
      if (files.length) await props.onSendFiles(t, asTask, files);
      else await props.onSend(t, asTask);
      setText(""); setAsTask(false); setFiles([]);
    } finally { setBusy(false); }
  };

  return (
    <div className="chat" data-testid="chat-view">
      <div className="msgs" data-testid="message-stream">
        {topLevel.length === 0 && <div className="placeholder"><div>No messages in this channel yet</div></div>}
        {topLevel.map((m) => {
          const r = replyInfo.get(m.id);
          const task = taskByMessage.get(m.id);
          const newCount = r ? r.seqs.filter((s) => s > (seen[m.id] ?? Infinity)).length : 0;
          return (
            <div key={m.id} className={`msg ${m.type}`} data-testid="message">
              <Avatar type={m.type} id={m.sender.id} status={m.type === "agent" ? props.agentStatus[m.sender.id]?.kind : undefined} />
              <div className="body">
                <div className="line1">
                  <span className="who">{m.sender.id}</span>
                  <span className="meta mono">#{m.seq} · {m.type}</span>
                  <span className="msg-actions">
                    <button className="msg-act" data-testid="reply-link" title="Reply in thread" onClick={() => openThread(m)}>
                      <MessageSquare size={14} />
                    </button>
                    <ReactionAdd reactions={m.reactions ?? []} onToggle={(emoji, mine) => props.onToggleReaction(m.id, emoji, mine)} />
                    <button
                      className={`msg-act ${m.saved ? "saved" : ""}`} data-testid="save-link"
                      title={m.saved ? "Remove from Saved" : "Save message"}
                      onClick={() => props.onToggleSave(m.id, Boolean(m.saved))}
                    >
                      <Bookmark size={14} fill={m.saved ? "currentColor" : "none"} />
                    </button>
                  </span>
                </div>
                <div className="content"><MessageText content={m.content} channels={props.channels} memberHandles={props.memberHandles} onChannel={props.onChannel} onTask={props.onTask} /></div>
                <AttachmentList attachments={m.attachments ?? []} />
                <ReactionBar reactions={m.reactions ?? []} onToggle={(emoji, mine) => props.onToggleReaction(m.id, emoji, mine)} />
                {(task || r) && (
                  <div className="msg-foot">
                    {task && <TaskChip task={task} onOpen={() => openThread(m)} />}
                    {r && (
                      <button
                        className={`thread-summary ${props.activeThreadId === m.id ? "active" : ""}`}
                        data-testid="thread-summary"
                        onClick={() => openThread(m)}
                      >
                        <MessageSquare size={12} /> {r.count} {r.count === 1 ? "reply" : "replies"}
                        {newCount > 0 && <span className="new-badge" data-testid="thread-new">· {newCount} new</span>}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {active.length > 0 && (
        <div className="activity-bar" data-testid="activity-bar">
          {active.map(([handle, a]) => (
            <span key={handle} className="act-chip">
              <span className="act-dot" /> {handle} is {ACTIVITY_LABEL[a.activity] ?? a.activity}…
            </span>
          ))}
        </div>
      )}
      <div className="composer composer-col" data-testid="composer">
        <PendingFiles files={files} onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))} />
        {props.archived && <div className="archived-note" data-testid="archived-note"><Archive size={13} /> This channel is archived (read-only).</div>}
        <MentionTextarea
          testId="composer-input"
          placeholder={props.archived ? "Channel is archived (read-only)" : props.disabled ? "Select a channel first" : `Message #${props.channelName}… (Enter to send)`}
          value={text}
          disabled={props.disabled || busy}
          members={props.members}
          onChange={setText}
          onPaste={(e) => { const imgs = imagesFromClipboard(e); if (imgs.length) { e.preventDefault(); setFiles((prev) => [...prev, ...imgs]); } }}
          onEnter={() => void submit()}
        />
        <div className="composer-foot">
          <input
            ref={fileInputRef} type="file" multiple data-testid="file-input" style={{ display: "none" }}
            onChange={(e) => { setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]); if (fileInputRef.current) fileInputRef.current.value = ""; }}
          />
          <button className="nb-btn" data-testid="attach-btn" title="Attach files" disabled={props.disabled || busy} onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={14} />
          </button>
          <label className="astask-toggle" title="Create a task from this message">
            <input type="checkbox" data-testid="as-task" checked={asTask} disabled={props.disabled || busy} onChange={(e) => setAsTask(e.target.checked)} />
            As task
          </label>
          <span className="grow" />
          <button className="nb-btn primary" data-testid="send-btn" disabled={props.disabled || busy || (!text.trim() && files.length === 0)} onClick={submit}>
            {asTask ? "Create task" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
