/** 仪表盘单页 HTML (内联,零依赖)。M4 预览版。 */

export const DASHBOARD_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OpenSlock · 进度看板</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,system-ui,"PingFang SC",sans-serif; background:#0d1117; color:#c9d1d9; }
  header { display:flex; gap:8px; align-items:center; padding:10px 16px; background:#161b22; border-bottom:1px solid #30363d; }
  header b { color:#58a6ff; font-size:15px; }
  header input { flex:1; background:#0d1117; border:1px solid #30363d; color:#c9d1d9; padding:6px 10px; border-radius:6px; font-family:ui-monospace,monospace; font-size:12px; }
  header button { background:#238636; color:#fff; border:0; padding:6px 14px; border-radius:6px; cursor:pointer; }
  #live { font-size:12px; padding:2px 8px; border-radius:10px; background:#30363d; }
  #live.on { background:#1f6feb; }
  main { display:grid; grid-template-columns:200px 1fr 320px; height:calc(100vh - 53px); }
  .col { overflow:auto; padding:12px; }
  .col + .col { border-left:1px solid #30363d; }
  h3 { margin:0 0 10px; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#8b949e; }
  .chan { padding:6px 10px; border-radius:6px; cursor:pointer; }
  .chan:hover { background:#161b22; }
  .chan.sel { background:#1f6feb33; color:#58a6ff; }
  .msg { padding:8px 0; border-bottom:1px solid #21262d; }
  .msg .who { font-weight:600; }
  .msg.human .who { color:#58a6ff; }
  .msg.agent .who { color:#3fb950; }
  .msg.system { color:#8b949e; font-style:italic; }
  .msg .seq { color:#484f58; font-size:11px; margin-left:6px; }
  .task { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; margin-bottom:10px; }
  .task .num { color:#58a6ff; font-weight:600; }
  .badge { font-size:11px; padding:2px 8px; border-radius:10px; }
  .s-todo{background:#30363d}.s-in_progress{background:#9e6a03}.s-in_review{background:#1f6feb}.s-done{background:#238636}
  .empty { color:#8b949e; padding:20px 0; }
  .hint { padding:24px; color:#8b949e; }
  code { background:#161b22; padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<header>
  <b>OpenSlock</b>
  <input id="token" placeholder="粘贴 sk_user_* token (pnpm seed 会打印)" />
  <button onclick="connect()">连接</button>
  <span id="live">●  未连接</span>
</header>
<main>
  <div class="col"><h3>频道</h3><div id="channels"><div class="empty">—</div></div></div>
  <div class="col"><h3 id="chanTitle">消息</h3><div id="messages"><div class="hint">填入 token 后点「连接」。token 来自 <code>pnpm seed</code> 输出。</div></div></div>
  <div class="col"><h3>任务</h3><div id="tasks"><div class="empty">—</div></div></div>
</main>
<script>
let snap = null, sel = null, ws = null, token = "";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

async function connect() {
  token = $("token").value.trim();
  if (!token) return;
  localStorage.setItem("crew_token", token);
  await refresh();
  openWs();
}

async function refresh() {
  const r = await fetch("/api/snapshot", { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) { $("messages").innerHTML = '<div class="hint">鉴权失败 (HTTP ' + r.status + ')。确认是 sk_user_* token。</div>'; return; }
  snap = (await r.json()).data;
  if (!sel && snap.channels[0]) sel = snap.channels[0].id;
  render();
}

function render() {
  $("channels").innerHTML = snap.channels.map(c =>
    '<div class="chan ' + (c.id===sel?'sel':'') + '" onclick="pick(\\''+c.id+'\\')">#' + esc(c.slug) + '</div>'
  ).join("") || '<div class="empty">无频道</div>';

  const ch = snap.channels.find(c => c.id === sel);
  $("chanTitle").textContent = ch ? "#" + ch.slug : "消息";
  const msgs = snap.messages.filter(m => m.channelId === sel);
  $("messages").innerHTML = msgs.map(m =>
    '<div class="msg ' + m.type + '"><span class="who">' + esc(m.senderId) +
    '</span><span class="seq">#' + m.seq + ' · ' + m.type + '</span><div>' + esc(m.content) + '</div></div>'
  ).join("") || '<div class="empty">该频道暂无消息</div>';

  $("tasks").innerHTML = snap.tasks.map(t =>
    '<div class="task"><div><span class="num">#' + t.number + '</span> ' + esc(t.title) + '</div>' +
    '<div style="margin-top:6px"><span class="badge s-' + t.status + '">' + t.status + '</span> ' +
    (t.assigneeId ? '→ ' + esc(t.assigneeType) + ':' + esc(t.assigneeId) : '<span style="color:#8b949e">未认领</span>') +
    '</div></div>'
  ).join("") || '<div class="empty">无任务</div>';
}

function pick(id) { sel = id; render(); }

function openWs() {
  if (ws) ws.close();
  ws = new WebSocket((location.protocol==="https:"?"wss":"ws") + "://" + location.host + "/ws?token=" + encodeURIComponent(token));
  ws.onopen = () => { $("live").textContent = "●  实时已连接"; $("live").className = "on"; };
  ws.onclose = () => { $("live").textContent = "●  已断开"; $("live").className = ""; };
  ws.onmessage = (e) => { const ev = JSON.parse(e.data); if (ev.type==="message.created"||ev.type==="task.updated") refresh(); };
}

const saved = localStorage.getItem("crew_token");
if (saved) { $("token").value = saved; connect(); }
</script>
</body>
</html>`;
