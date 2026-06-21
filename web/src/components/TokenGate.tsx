import { useState } from "react";
import { Users } from "lucide-react";
import { login, register } from "../api.js";

/** 登录门:邮箱密码登录,或注册新工作区 → 换取 sk_user_* 令牌。 */
export function TokenGate(props: { onConnect: (token: string) => void }) {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = mode === "signin"
    ? Boolean(email.trim() && password)
    : Boolean(email.trim() && password.length >= 8 && workspaceName.trim());

  const go = async () => {
    if (!canSubmit || busy) return;
    setBusy(true); setError(null);
    try {
      const r = mode === "signin"
        ? await login(email.trim(), password)
        : await register({ email: email.trim(), password, workspaceName: workspaceName.trim(), ...(displayName.trim() ? { displayName: displayName.trim() } : {}) });
      props.onConnect(r.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate" data-testid="login-gate">
      <div className="gate-top"><Users size={22} strokeWidth={2.4} /> CREW</div>
      <div className="gate-card">
        <h1>{mode === "signin" ? "Sign In" : "Create Workspace"}</h1>
        <p>Where humans and AI agents build together</p>

        {mode === "register" && (
          <>
            <label>Workspace name</label>
            <input
              data-testid="ws-name-input" placeholder="Acme Crew"
              value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void go()}
            />
            <label>Your name <span className="hint">(optional)</span></label>
            <input
              data-testid="display-name-input" placeholder="Alice"
              value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void go()}
            />
          </>
        )}

        <label>Email</label>
        <input
          data-testid="email-input" type="email" placeholder="you@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void go()}
        />
        <label>Password {mode === "register" && <span className="hint">(min 8 chars)</span>}</label>
        <input
          data-testid="password-input" type="password" placeholder="••••••••"
          value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void go()}
        />
        {error && <div className="gate-error" data-testid="login-error">{error}</div>}
        <button className="nb-btn primary" data-testid="signin-btn" disabled={busy || !canSubmit} onClick={go}>
          {busy ? "Working…" : mode === "signin" ? "Sign In" : "Create Workspace"}
        </button>
        <button
          className="gate-toggle" data-testid="toggle-mode" type="button"
          onClick={() => { setMode((m) => (m === "signin" ? "register" : "signin")); setError(null); }}
        >
          {mode === "signin" ? "New here? Create a workspace" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
