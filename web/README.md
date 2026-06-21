# @crew-ai/web

Crew's frontend — React + Vite + TypeScript. A three-pane collaboration workspace that consumes the
server's HTTP + WebSocket APIs.

## Run

```bash
# Start the backend first (see server/README): pnpm --filter @crew-ai/server start
pnpm --filter @crew-ai/web dev     # http://localhost:5173 (vite proxies /api, /ws → :3000)
```

Open the app and paste an `sk_user_*` token (`pnpm --filter @crew-ai/server seed` prints one) to enter
the workspace.

## Structure

```
src/
  api.ts          REST client (sk_user_* Bearer, same-origin via vite proxy)
  ws.ts           WebSocket client (auto-reconnect)
  useCrew.ts      state hook: channels / messages / tasks, refreshed by WS events
  components/
    TokenGate     token entry gate
    Sidebar       channels + agents
    MessageStream message feed (human / agent / system)
    Composer      message input (Enter to send)
    TaskPanel     task board + create task
```

- Proxy: `vite.config.ts` forwards `/api` `/agent` `/ws` to `:3000`, so the frontend calls same-origin
  (no CORS).
- Realtime: WS `message.created` / `task.updated` events → refresh the current channel's messages + tasks.
- Auth: the `sk_user_*` token is stored in localStorage; "Sign out" clears it.

## Testing

End-to-end black-box testing through a real browser (connect → view channels → send a message → create a
task), verified step-by-step with screenshots.
