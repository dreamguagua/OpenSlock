/** Thread 面板(右侧第 4 栏):父消息 + 回复串 + 线程内发送。 */

import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import type { AgentStatusInfo, Channel, Message } from "../types.js";
import { Avatar } from "./Avatar.js";
import { MessageText } from "./MessageText.js";
import { AttachmentList } from "./AttachmentList.js";
import { PendingFiles, imagesFromClipboard } from "./PendingFiles.js";

export function ThreadPanel(props: {
  channelName: string;
  parent: Message;
  replies: Message[];
  channels: Channel[];
  memberHandles: Set<string>;
  agentStatus: Record<string, AgentStatusInfo>;
  onChannel: (id: string) => void;
  onTask: () => void;
  onReply: (content: string) => Promise<void>;
  onReplyFiles: (content: string, files: File[]) => Promise<void>;
  onClose: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [props.replies.length]);

  const submit = async () => {
    const t = text.trim();
    if ((!t && files.length === 0) || busy) return;
    setBusy(true);
    try {
      if (files.length) await props.onReplyFiles(t, files);
      else await props.onReply(t);
      setText(""); setFiles([]);
    } finally { setBusy(false); }
  };

  const Row = (m: Message) => (
    <div key={m.id} className={`msg ${m.type}`} data-testid="thread-msg">
      <Avatar type={m.type} id={m.sender.id} size={28} status={m.type === "agent" ? props.agentStatus[m.sender.id]?.kind : undefined} />
      <div className="body">
        <div className="line1"><span className="who">{m.sender.id}</span><span className="meta mono">#{m.seq}</span></div>
        <div className="content"><MessageText content={m.content} channels={props.channels} memberHandles={props.memberHandles} onChannel={props.onChannel} onTask={props.onTask} /></div>
        <AttachmentList attachments={m.attachments ?? []} />
      </div>
    </div>
  );

  return (
    <aside className="thread" data-testid="thread-panel">
      <div className="thread-head">
        <div><b>Thread</b> <span className="meta">— #{props.channelName}</span></div>
        <button className="nb-btn" data-testid="thread-close" onClick={props.onClose}>×</button>
      </div>
      <div className="thread-body">
        <div className="thread-parent">{Row(props.parent)}</div>
        <div className="thread-divider">{props.replies.length} {props.replies.length === 1 ? "reply" : "replies"}</div>
        {props.replies.length === 0 && <div className="fake" style={{ padding: 12 }}>No replies yet — start the discussion below</div>}
        {props.replies.map(Row)}
        <div ref={endRef} />
      </div>
      <div className="composer composer-col">
        <PendingFiles files={files} onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))} />
        <textarea
          data-testid="thread-input"
          placeholder="Reply to thread… (Enter to send)"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { const imgs = imagesFromClipboard(e); if (imgs.length) { e.preventDefault(); setFiles((prev) => [...prev, ...imgs]); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
        />
        <div className="composer-foot">
          <input
            ref={fileInputRef} type="file" multiple data-testid="thread-file-input" style={{ display: "none" }}
            onChange={(e) => { setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]); if (fileInputRef.current) fileInputRef.current.value = ""; }}
          />
          <button className="nb-btn" data-testid="thread-attach-btn" title="Attach files" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={14} />
          </button>
          <span className="grow" />
          <button className="nb-btn primary" data-testid="thread-send" disabled={busy || (!text.trim() && files.length === 0)} onClick={submit}>Send</button>
        </div>
      </div>
    </aside>
  );
}
