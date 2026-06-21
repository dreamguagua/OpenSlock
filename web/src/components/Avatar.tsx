/** 头像组件:DiceBear 生成的 SVG 套在 neo-brutalist 黑边方框里。
 *  传入 status 时,右下角叠加一个状态角标(online 🟢 / busy 🟡 / offline ⚪)。 */

import { avatarDataUri } from "../avatar.js";
import type { ActorType, AgentStatusKind } from "../types.js";

export function Avatar(props: { type: ActorType; id: string; size?: number; status?: AgentStatusKind; url?: string | null }) {
  const size = props.size ?? 34;
  const src = props.url && props.url.trim() ? props.url : avatarDataUri(props.type, props.id);
  const av = (
    <span
      className={`av ${props.type}`}
      style={{ width: size, height: size, padding: 0, overflow: "hidden" }}
      title={`${props.type}:${props.id}`}
    >
      <img src={src} alt={props.id} width={size} height={size} style={{ display: "block", objectFit: "cover" }} />
    </span>
  );
  if (!props.status) return av;

  // 角标尺寸随头像比例缩放,贴在右下角并略微外溢
  const dot = Math.max(8, Math.round(size * 0.3));
  const off = -Math.round(dot * 0.25);
  return (
    <span className="av-wrap">
      {av}
      <span
        className={`status-dot ${props.status}`}
        style={{ width: dot, height: dot, right: off, bottom: off }}
        title={props.status}
      />
    </span>
  );
}
