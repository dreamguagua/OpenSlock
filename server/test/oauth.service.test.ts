import { describe, it, expect } from "vitest";
import { OAuthService, type OAuthProvider } from "../src/auth/oauth.js";
import { isDomainError } from "../src/domain/errors.js";

const fakeProvider = (email: string): OAuthProvider => ({
  name: "fake",
  authorizeUrl: (state, redirectUri) => `https://fake/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
  exchangeCode: async (code) => ({ email: code === "good" ? email : "", name: "Faker" }),
});

function svc(email = "x@e.com") {
  const calls: Array<{ email: string; name?: string }> = [];
  const s = new OAuthService({
    providers: { fake: fakeProvider(email) },
    findOrCreateByEmail: async (em, name) => {
      calls.push({ email: em, ...(name ? { name } : {}) });
      return { token: "sk_user_tok", workspaceId: "ws1", handle: "faker" };
    },
  });
  return { s, calls };
}

async function expectCode(p: Promise<unknown>, code: string) {
  try { await p; expect.unreachable("expected " + code); }
  catch (e) { expect(isDomainError(e) && e.code).toBe(code); }
}

describe("OAuthService", () => {
  it("start 返回授权 URL(带 state)+ 记录 state", () => {
    const { s } = svc();
    const r = s.start("fake", "https://app/cb");
    expect(r.url).toContain("https://fake/auth");
    expect(r.url).toContain(r.state);
  });

  it("callback:有效 state+code → 换邮箱并登录", async () => {
    const { s, calls } = svc("alice@e.com");
    const { state } = s.start("fake", "https://app/cb");
    const res = await s.callback("fake", "good", state, "https://app/cb");
    expect(res.token).toBe("sk_user_tok");
    expect(calls[0]).toEqual({ email: "alice@e.com", name: "Faker" });
  });

  it("callback:state 非法/重放 → VALIDATION(state 一次性)", async () => {
    const { s } = svc();
    const { state } = s.start("fake", "https://app/cb");
    await s.callback("fake", "good", state, "https://app/cb"); // 第一次用掉
    await expectCode(s.callback("fake", "good", state, "https://app/cb"), "VALIDATION"); // 重放
    await expectCode(s.callback("fake", "good", "never-issued", "https://app/cb"), "VALIDATION");
  });

  it("callback:provider 无邮箱 → VALIDATION", async () => {
    const { s } = svc();
    const { state } = s.start("fake", "https://app/cb");
    await expectCode(s.callback("fake", "bad", state, "https://app/cb"), "VALIDATION");
  });

  it("未知 provider → NOT_FOUND", () => {
    const { s } = svc();
    expect(() => s.start("nope", "https://app/cb")).toThrow();
  });

  it("available 列出已配置 provider", () => {
    expect(svc().s.available()).toEqual(["fake"]);
  });
});
