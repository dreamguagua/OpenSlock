/** WebSocket 客户端:订阅 workspace 实时事件,自动重连。 */

import type { RealtimeEvent } from "./types.js";

export function connectWs(
  token: string,
  onEvent: (e: RealtimeEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 1000;

  const open = () => {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => {
      backoff = 1000;
      onStatus(true);
    };
    ws.onclose = () => {
      onStatus(false);
      if (!closed) {
        setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 15000);
      }
    };
    ws.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data) as RealtimeEvent);
      } catch {
        /* ignore malformed */
      }
    };
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
