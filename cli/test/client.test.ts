import { describe, it, expect } from "vitest";
import { CrewClient } from "../src/client.js";

function mockFetch(status: number, jsonBody: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => JSON.stringify(jsonBody),
    } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("CrewClient", () => {
  it("whoami: GET 带 Bearer 头", async () => {
    const { f, calls } = mockFetch(200, { success: true, data: {} });
    await new CrewClient("http://h", "sk_agent_x", f).whoami();
    expect(calls[0]!.url).toBe("http://h/agent/whoami");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk_agent_x");
  });

  it("listMessages: 拼接 afterSeq/limit 查询串并对 channelId 转义", async () => {
    const { f, calls } = mockFetch(200, { success: true, data: [] });
    await new CrewClient("http://h", "t", f).listMessages("c 1", { after: 3, limit: 10 });
    expect(calls[0]!.url).toBe("http://h/agent/channels/c%201/messages?afterSeq=3&limit=10");
  });

  it("sendMessage: POST 带 JSON body 与 content-type", async () => {
    const { f, calls } = mockFetch(201, { success: true, data: { kind: "sent" } });
    await new CrewClient("http://h", "t", f).sendMessage("c1", { content: "hi", force: true });
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ content: "hi", force: true });
  });

  it("claim: POST 到 /agent/tasks/:id/claim", async () => {
    const { f, calls } = mockFetch(200, { success: true, data: {} });
    await new CrewClient("http://h", "t", f).claim("t1");
    expect(calls[0]!.url).toBe("http://h/agent/tasks/t1/claim");
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("解析非 JSON 文本不抛错", async () => {
    const { f } = mockFetch(500, "boom");
    const r = await new CrewClient("http://h", "t", f).whoami();
    expect(r.status).toBe(500);
  });
});
