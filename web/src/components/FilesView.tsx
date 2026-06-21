/** Files tab: all attachments in the current channel. Download fetches with the auth token. */

import { useEffect, useState, useCallback } from "react";
import { Paperclip, Download, FileText, Image as ImageIcon, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import type { ChannelFile } from "../types.js";

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesView({ channelId }: { channelId: string }) {
  const [items, setItems] = useState<ChannelFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.channelFiles(channelId).then(setItems).catch((e) => setError((e as Error).message));
  }, [channelId]);
  useEffect(() => { load(); }, [load]);

  const download = async (f: ChannelFile) => {
    const blob = await api.fetchAttachment(f.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = f.filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="files-view" data-testid="files-view">
      <div className="act-toolbar" style={{ padding: "8px 16px" }}>
        <span className="profile-sect" style={{ margin: 0 }}>FILES</span>
        <span className="grow" />
        <button className="nb-btn" data-testid="files-refresh" onClick={load}><RefreshCw size={13} /></button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {items === null && !error && <div className="placeholder"><div className="fake">Loading…</div></div>}
      {items?.length === 0 && <div className="placeholder"><div className="big">No files</div><div className="fake">Attachments shared in this channel show up here.</div></div>}
      <div className="files-list">
        {items?.map((f) => {
          const Icon = f.mime.startsWith("image/") ? ImageIcon : f.mime.startsWith("text/") ? FileText : Paperclip;
          return (
            <div key={f.id} className="file-row" data-testid="file-row">
              <span className="file-ic"><Icon size={18} /></span>
              <div className="file-main">
                <div className="file-name">{f.filename}</div>
                <div className="file-meta">{humanSize(f.size)} · {f.uploader.id} · {new Date(f.createdAt).toLocaleString("en-US")}</div>
              </div>
              <button className="nb-btn" data-testid="file-download" title="Download" onClick={() => download(f)}><Download size={14} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
