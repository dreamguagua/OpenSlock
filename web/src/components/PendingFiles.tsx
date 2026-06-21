/** 待发送附件预览:图片显示缩略图,其它文件显示文件名 chip。用于频道/线程输入框。
 *  object URL 在文件列表变化/卸载时回收,避免内存泄漏。 */

import { useEffect, useState } from "react";
import { X, Paperclip } from "lucide-react";

const isImage = (f: File) => f.type.startsWith("image/");

export function PendingFiles(props: { files: File[]; onRemove: (index: number) => void }) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const made = props.files.map((f) => (isImage(f) ? URL.createObjectURL(f) : ""));
    setUrls(made);
    return () => made.forEach((u) => u && URL.revokeObjectURL(u));
  }, [props.files]);

  if (props.files.length === 0) return null;
  return (
    <div className="pending-files" data-testid="pending-files">
      {props.files.map((f, i) => (
        <span key={`${f.name}-${i}`} className={`pending-chip ${isImage(f) ? "img" : ""}`}>
          {isImage(f) && urls[i] ? (
            <img className="pending-thumb" src={urls[i]} alt={f.name} title={f.name} />
          ) : (
            <><Paperclip size={12} /><span className="pending-name">{f.name}</span></>
          )}
          <button className="pending-x" title="Remove" onClick={() => props.onRemove(i)}><X size={12} /></button>
        </span>
      ))}
    </div>
  );
}

/** 从粘贴事件里抽出图片文件(没有图片返回空数组,调用方据此决定是否 preventDefault)。 */
export function imagesFromClipboard(e: React.ClipboardEvent): File[] {
  return Array.from(e.clipboardData?.items ?? [])
    .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
    .map((it) => it.getAsFile())
    .filter((f): f is File => f !== null);
}
