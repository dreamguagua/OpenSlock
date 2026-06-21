/**
 * OAuth 登录(provider 无关 + 可注入)。
 *
 * 真实 provider(Google/GitHub)经 env 配置;本地/测试可注入 fake provider 联调整个流程。
 * 流程:start(发 state+授权 URL)→ 用户在 provider 授权 → callback(校验 state→换码取邮箱→
 *       按邮箱找/建账号签发 sk_user_*)。state 防 CSRF,一次性 + TTL。
 */

import { randomUUID } from "node:crypto";
import { DomainError } from "../domain/errors.js";
import type { LoginResult } from "./service.js";

export interface OAuthUserInfo {
  readonly email: string;
  readonly name?: string;
}

export interface OAuthProvider {
  readonly name: string;
  /** 构造跳转到 provider 的授权 URL(带 state)。 */
  authorizeUrl(state: string, redirectUri: string): string;
  /** 用 callback 收到的 code 换取用户信息(邮箱)。 */
  exchangeCode(code: string, redirectUri: string): Promise<OAuthUserInfo>;
}

const STATE_TTL_MS = 10 * 60 * 1000;

/** 一次性 CSRF state(内存;多实例部署需换共享存储)。 */
class StateStore {
  private readonly m = new Map<string, { provider: string; redirectUri: string; exp: number }>();
  put(state: string, provider: string, redirectUri: string): void {
    this.m.set(state, { provider, redirectUri, exp: Date.now() + STATE_TTL_MS });
  }
  take(state: string): { provider: string; redirectUri: string } | null {
    const e = this.m.get(state);
    if (!e) return null;
    this.m.delete(state); // 一次性
    if (e.exp < Date.now()) return null;
    return { provider: e.provider, redirectUri: e.redirectUri };
  }
}

export interface OAuthDeps {
  readonly providers: Readonly<Record<string, OAuthProvider>>;
  /** 按邮箱找已有账号→登录;无则开通新工作区+账号。 */
  readonly findOrCreateByEmail: (email: string, name?: string) => Promise<LoginResult>;
}

export class OAuthService {
  private readonly states = new StateStore();
  constructor(private readonly deps: OAuthDeps) {}

  /** 配置了哪些 provider(供前端展示登录按钮)。 */
  available(): string[] {
    return Object.keys(this.deps.providers);
  }

  start(providerName: string, redirectUri: string): { url: string; state: string } {
    const p = this.deps.providers[providerName];
    if (!p) throw new DomainError("NOT_FOUND", `oauth provider not configured: ${providerName}`, { providerName });
    const state = randomUUID();
    this.states.put(state, providerName, redirectUri);
    return { url: p.authorizeUrl(state, redirectUri), state };
  }

  async callback(providerName: string, code: string, state: string, redirectUri: string): Promise<LoginResult> {
    const p = this.deps.providers[providerName];
    if (!p) throw new DomainError("NOT_FOUND", `oauth provider not configured: ${providerName}`, { providerName });
    const st = this.states.take(state);
    if (!st || st.provider !== providerName) {
      throw new DomainError("VALIDATION", "invalid or expired oauth state", { providerName });
    }
    const info = await p.exchangeCode(code, redirectUri);
    if (!info.email) throw new DomainError("VALIDATION", "oauth provider returned no email", { providerName });
    return this.deps.findOrCreateByEmail(info.email, info.name);
  }
}

/**
 * 标准 OIDC provider(Google 等):authorize → token → userinfo。
 * 仅当 env 配齐 clientId/secret 时构造,否则不注册。
 */
export function oidcProvider(cfg: {
  name: string;
  clientId: string;
  clientSecret: string;
  authEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  scope?: string;
}): OAuthProvider {
  return {
    name: cfg.name,
    authorizeUrl(state, redirectUri) {
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: cfg.scope ?? "openid email profile",
        state,
      });
      return `${cfg.authEndpoint}?${q.toString()}`;
    },
    async exchangeCode(code, redirectUri) {
      const tokRes = await fetch(cfg.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });
      if (!tokRes.ok) throw new DomainError("CONFLICT", `oauth token exchange failed (${tokRes.status})`, {});
      const tok = (await tokRes.json()) as { access_token?: string };
      if (!tok.access_token) throw new DomainError("CONFLICT", "oauth: no access_token", {});
      const uiRes = await fetch(cfg.userinfoEndpoint, { headers: { authorization: `Bearer ${tok.access_token}` } });
      if (!uiRes.ok) throw new DomainError("CONFLICT", `oauth userinfo failed (${uiRes.status})`, {});
      const ui = (await uiRes.json()) as { email?: string; name?: string };
      return { email: ui.email ?? "", ...(ui.name ? { name: ui.name } : {}) };
    },
  };
}

/** 从 env 装配真实 provider(没配就空,routes 返回 404)。 */
export function providersFromEnv(): Record<string, OAuthProvider> {
  const out: Record<string, OAuthProvider> = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    out.google = oidcProvider({
      name: "google",
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    });
  }
  return out;
}
