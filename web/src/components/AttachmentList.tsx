/** Render a message's attachments. Files are fetched with the auth token (so plain <img src>
 *  won't work) → object URL. Images preview inline; other files show a download chip. */

import { useEffect, useState } from "react";
import { Paperclip, Download } from "lucide-react";
import { api } from "../api.js";
import type { AttachmentMeta } from "../types.js";

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentItem({ att }: { att: AttachmentMeta }) {
  const isImage = att.mime.startsWith("image/");
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 图片:进入即拉 blob 预览(带 token)。其它类型按需下载。
  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    let cancelled = false;
    api.fetchAttachment(att.id).then((b) => {
      if (cancelled) return;
      url = URL.createObjectURL(b);
      setObjUrl(url);
    }).catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [att.id, isImage]);

  const download = async () => {
    setBusy(true);
    try {
      const blob = await api.fetchAttachment(att.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = att.filename; a.click();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  };

  if (isImage && objUrl) {
    return (
      <a className="att-img" data-testid="attachment-image" href={objUrl} download={att.filename} title={att.filename}>
        <img src={objUrl} alt={att.filename} />
      </a>
    );
  }
  return (
    <button className="att-chip" data-testid="attachment-chip" onClick={download} disabled={busy} title={`Download ${att.filename}`}>
      <Paperclip size={13} />
      <span className="att-name">{att.filename}</span>
      <span className="att-size">{humanSize(att.size)}</span>
      <Download size={13} />
    </button>
  );
}

export function AttachmentList({ attachments }: { attachments: AttachmentMeta[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="attachments" data-testid="attachments">
      {attachments.map((a) => <AttachmentItem key={a.id} att={a} />)}
    </div>
  );
}
