/**
 * Crew HTTP 客户端 —— CLI 经它走 agent 数据面与 server 通信。
 * fetch 可注入,便于单测。
 */

export interface HttpResult {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
}

export type FetchLike = typeof fetch;

export class CrewClient {
  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async req(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<HttpResult> {
    const res = await this.fetchImpl(`${this.serverUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let parsed: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, ok: res.ok, body: parsed };
  }

  whoami(): Promise<HttpResult> {
    return this.req("GET", "/agent/whoami");
  }

  /** 下载附件原始字节(图片/文件)。供 `crew attachment get` 落盘后让 agent 查看。 */
  async downloadAttachment(
    id: string,
  ): Promise<
    | { ok: true; bytes: Uint8Array; mime: string; filename: string }
    | { ok: false; status: number; error: string }
  > {
    const res = await this.fetchImpl(
      `${this.serverUrl}/agent/attachments/${encodeURIComponent(id)}/download`,
      { headers: { authorization: `Bearer ${this.token}` } },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    const cd = res.headers.get("content-disposition") ?? "";
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i) ?? cd.match(/filename="?([^";]+)"?/i);
    const filename = m?.[1] ? decodeURIComponent(m[1]) : id;
    return { ok: true, bytes, mime, filename };
  }

  listMessages(
    channelId: string,
    opts: { after?: number; limit?: number } = {},
  ): Promise<HttpResult> {
    const q = new URLSearchParams();
    if (opts.after != null) q.set("afterSeq", String(opts.after));
    if (opts.limit != null) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return this.req(
      "GET",
      `/agent/channels/${encodeURIComponent(channelId)}/messages${qs ? `?${qs}` : ""}`,
    );
  }

  markRead(channelId: string, upToSeq: number): Promise<HttpResult> {
    return this.req("POST", `/agent/channels/${encodeURIComponent(channelId)}/read`, {
      upToSeq,
    });
  }

  sendMessage(
    channelId: string,
    input: { content: string; thread?: string | undefined; force?: boolean },
  ): Promise<HttpResult> {
    const body: Record<string, unknown> = { content: input.content };
    if (input.thread) body.thread = input.thread;
    if (input.force) body.force = true;
    return this.req(
      "POST",
      `/agent/channels/${encodeURIComponent(channelId)}/messages`,
      body,
    );
  }

  unread(channelId: string): Promise<HttpResult> {
    return this.req("GET", `/agent/channels/${encodeURIComponent(channelId)}/unread`);
  }

  channelMembers(channelId: string): Promise<HttpResult> {
    return this.req("GET", `/agent/channels/${encodeURIComponent(channelId)}/members`);
  }
  joinChannel(channelId: string): Promise<HttpResult> {
    return this.req("POST", `/agent/channels/${encodeURIComponent(channelId)}/join`);
  }
  leaveChannel(channelId: string): Promise<HttpResult> {
    return this.req("POST", `/agent/channels/${encodeURIComponent(channelId)}/leave`);
  }
  listIntegrations(): Promise<HttpResult> {
    return this.req("GET", "/agent/integrations");
  }
  loginIntegration(name: string): Promise<HttpResult> {
    return this.req("POST", `/agent/integrations/${encodeURIComponent(name)}/login`);
  }
  logoutIntegration(name: string): Promise<HttpResult> {
    return this.req("POST", `/agent/integrations/${encodeURIComponent(name)}/logout`);
  }
  prepareAction(kind: string, payload: unknown, channelId?: string): Promise<HttpResult> {
    return this.req("POST", "/agent/actions", {
      kind,
      payload,
      ...(channelId ? { channelId } : {}),
    });
  }
  unfollowThread(thread: string): Promise<HttpResult> {
    return this.req("POST", `/agent/threads/${encodeURIComponent(thread)}/unfollow`);
  }
  followThread(thread: string): Promise<HttpResult> {
    return this.req("POST", `/agent/threads/${encodeURIComponent(thread)}/follow`);
  }

  claim(taskId: string): Promise<HttpResult> {
    return this.req("POST", `/agent/tasks/${encodeURIComponent(taskId)}/claim`);
  }

  listTasks(
    channelId: string,
    opts: { status?: string; mine?: boolean } = {},
  ): Promise<HttpResult> {
    const q = new URLSearchParams();
    if (opts.status) q.set("status", opts.status);
    if (opts.mine) q.set("mine", "1");
    const qs = q.toString();
    return this.req(
      "GET",
      `/agent/channels/${encodeURIComponent(channelId)}/tasks${qs ? `?${qs}` : ""}`,
    );
  }

  createTasksBatch(channelId: string, titles: string[], parentTaskId?: string): Promise<HttpResult> {
    return this.req("POST", `/agent/channels/${encodeURIComponent(channelId)}/tasks/batch`, {
      titles,
      ...(parentTaskId ? { parentTaskId } : {}),
    });
  }
  createTask(channelId: string, title: string): Promise<HttpResult> {
    return this.req("POST", `/agent/channels/${encodeURIComponent(channelId)}/tasks`, {
      title,
    });
  }

  unclaim(taskId: string): Promise<HttpResult> {
    return this.req("POST", `/agent/tasks/${encodeURIComponent(taskId)}/unclaim`);
  }

  assign(taskId: string, to: string): Promise<HttpResult> {
    return this.req("POST", `/agent/tasks/${encodeURIComponent(taskId)}/assign`, { to });
  }

  updateTaskStatus(taskId: string, status: string): Promise<HttpResult> {
    return this.req("POST", `/agent/tasks/${encodeURIComponent(taskId)}/status`, {
      status,
    });
  }

  serverInfo(): Promise<HttpResult> {
    return this.req("GET", "/agent/server-info");
  }

  searchMessages(
    query: string,
    opts: { channel?: string; limit?: number } = {},
  ): Promise<HttpResult> {
    const q = new URLSearchParams({ q: query });
    if (opts.channel) q.set("channel", opts.channel);
    if (opts.limit != null) q.set("limit", String(opts.limit));
    return this.req("GET", `/agent/messages/search?${q.toString()}`);
  }

  resolveMessage(idOrPrefix: string): Promise<HttpResult> {
    return this.req("GET", `/agent/messages/${encodeURIComponent(idOrPrefix)}/resolve`);
  }

  scheduleReminder(input: {
    title: string; at?: string; in?: string; cron?: string; channel?: string; timezone?: string;
  }): Promise<HttpResult> {
    return this.req("POST", "/agent/reminders", input);
  }
  listReminders(): Promise<HttpResult> {
    return this.req("GET", "/agent/reminders");
  }
  snoozeReminder(id: string, duration: string): Promise<HttpResult> {
    return this.req("POST", `/agent/reminders/${encodeURIComponent(id)}/snooze`, { in: duration });
  }
  updateReminder(
    id: string,
    patch: { title?: string; at?: string; in?: string; cron?: string },
  ): Promise<HttpResult> {
    return this.req("POST", `/agent/reminders/${encodeURIComponent(id)}/update`, patch);
  }
  cancelReminder(id: string): Promise<HttpResult> {
    return this.req("POST", `/agent/reminders/${encodeURIComponent(id)}/cancel`);
  }
  reminderLog(id: string): Promise<HttpResult> {
    return this.req("GET", `/agent/reminders/${encodeURIComponent(id)}/log`);
  }
}
