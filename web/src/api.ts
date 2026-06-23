/** REST 客户端:web 数据面,sk_user_* 经 Authorization 头。同源(vite 反代到 :3000)。 */

import type { ActionCard, ActivityFeedItem, AgentActivityItem, AgentPatch, AgentProfile, AttachmentMeta, Channel, ChannelFile, ChannelMember, CreateMachineResult, FsFile, FsList, ImportRaftInput, Machine, Me, Message, NewAgentInput, RaftInspectResult, ServerInfo, SkillInfo, Task } from "./types.js";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let token = "";
export function setToken(t: string): void {
  token = t;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => null)) as
    | { success: boolean; data?: T; error?: { code?: string; message?: string } }
    | null;
  if (!res.ok || !json?.success) {
    throw new ApiError(res.status, json?.error?.code ?? "ERR", json?.error?.message ?? "Request failed");
  }
  return json.data as T;
}

/** 登录(公开,无需 token):邮箱密码 → sk_user_* 令牌。 */
export async function login(email: string, password: string): Promise<{ token: string; handle: string; workspaceId: string }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json().catch(() => null)) as
    | { success: boolean; data?: { token: string; handle: string; workspaceId: string }; error?: { message?: string } }
    | null;
  if (!res.ok || !json?.success || !json.data) {
    throw new ApiError(res.status, "LOGIN", json?.error?.message ?? "Login failed");
  }
  return json.data;
}

/** 注册(公开):新建工作区 + owner 账号 → sk_user_* 令牌。 */
export async function register(input: { email: string; password: string; workspaceName: string; displayName?: string }): Promise<{ token: string; handle: string; workspaceId: string }> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => null)) as
    | { success: boolean; data?: { token: string; handle: string; workspaceId: string }; error?: { message?: string } }
    | null;
  if (!res.ok || !json?.success || !json.data) {
    throw new ApiError(res.status, "REGISTER", json?.error?.message ?? "Registration failed");
  }
  return json.data;
}

export const api = {
  serverInfo: () => req<ServerInfo>("GET", "/api/server-info"),
  logout: () => req<{ revoked: boolean }>("POST", "/api/auth/logout"),
  me: () => req<Me>("GET", "/api/me"),
  actions: () => req<ActionCard[]>("GET", "/api/actions"),
  executeAction: (id: string) => req<ActionCard>("POST", `/api/actions/${encodeURIComponent(id)}/execute`),
  dismissAction: (id: string) => req<ActionCard>("POST", `/api/actions/${encodeURIComponent(id)}/dismiss`),
  activity: (limit = 100) => req<ActivityFeedItem[]>("GET", `/api/activity?limit=${limit}`),
  messages: (channelId: string) =>
    req<Message[]>("GET", `/api/channels/${encodeURIComponent(channelId)}/messages`),
  send: (channelId: string, content: string, opts?: { threadParentId?: string; asTask?: boolean }) =>
    req<Message>("POST", `/api/channels/${encodeURIComponent(channelId)}/messages`, {
      content,
      ...(opts?.threadParentId ? { threadParentId: opts.threadParentId } : {}),
      ...(opts?.asTask ? { asTask: true } : {}),
    }),
  createChannel: (input: { name: string; description?: string; isPrivate?: boolean; members?: Array<{ type: "agent" | "human"; id: string }> }) =>
    req<Channel>("POST", "/api/channels", input),
  channelMembers: (channelId: string) =>
    req<ChannelMember[]>("GET", `/api/channels/${encodeURIComponent(channelId)}/members`),
  addChannelMember: (channelId: string, member: { type: "agent" | "human"; id: string }) =>
    req<ChannelMember[]>("POST", `/api/channels/${encodeURIComponent(channelId)}/members`, member),
  removeChannelMember: (channelId: string, member: { type: "agent" | "human"; id: string }) =>
    req<ChannelMember[]>(
      "DELETE",
      `/api/channels/${encodeURIComponent(channelId)}/members/${member.type}/${encodeURIComponent(member.id)}`,
    ),
  joinChannel: (channelId: string) =>
    req<Channel>("POST", `/api/channels/${encodeURIComponent(channelId)}/join`),
  leaveChannel: (channelId: string) =>
    req<Channel>("POST", `/api/channels/${encodeURIComponent(channelId)}/leave`),
  archiveChannel: (channelId: string, archived: boolean) =>
    req<{ archived: boolean }>("POST", `/api/channels/${encodeURIComponent(channelId)}/${archived ? "archive" : "unarchive"}`),
  tasks: (channelId: string) =>
    req<Task[]>("GET", `/api/channels/${encodeURIComponent(channelId)}/tasks`),
  createTask: (channelId: string, title: string) =>
    req<{ task: Task }>("POST", `/api/channels/${encodeURIComponent(channelId)}/tasks`, { title }),
  claimTask: (taskId: string) =>
    req<unknown>("POST", `/api/tasks/${encodeURIComponent(taskId)}/claim`),
  setTaskStatus: (taskId: string, status: string) =>
    req<Task>("POST", `/api/tasks/${encodeURIComponent(taskId)}/status`, { status }),
  unclaimTask: (taskId: string) =>
    req<Task>("POST", `/api/tasks/${encodeURIComponent(taskId)}/unclaim`),
  // 附件上传 (multipart)。复用模块内 token。
  uploadAttachment: async (channelId: string, messageId: string, file: File): Promise<AttachmentMeta> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(
      `/api/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/attachments`,
      { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd },
    );
    const json = (await res.json().catch(() => null)) as { success: boolean; data?: AttachmentMeta; error?: { code?: string; message?: string } } | null;
    if (!res.ok || !json?.success) throw new ApiError(res.status, json?.error?.code ?? "UPLOAD", json?.error?.message ?? "Upload failed");
    return json.data as AttachmentMeta;
  },
  // 附件下载:带 token fetch → blob (前端转 objectURL 渲染/下载)
  fetchAttachment: async (id: string): Promise<Blob> => {
    const res = await fetch(`/api/attachments/${encodeURIComponent(id)}/download`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, "DOWNLOAD", "Download failed");
    return res.blob();
  },
  channelFiles: (channelId: string) =>
    req<ChannelFile[]>("GET", `/api/channels/${encodeURIComponent(channelId)}/files`),
  savedMessages: () => req<Message[]>("GET", "/api/saved"),
  saveMessage: (messageId: string) =>
    req<{ ok: boolean }>("POST", `/api/messages/${encodeURIComponent(messageId)}/save`),
  unsaveMessage: (messageId: string) =>
    req<{ ok: boolean }>("DELETE", `/api/messages/${encodeURIComponent(messageId)}/save`),
  addReaction: (channelId: string, messageId: string, emoji: string) =>
    req<{ ok: boolean }>("POST", `/api/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions`, { emoji }),
  removeReaction: (channelId: string, messageId: string, emoji: string) =>
    req<{ ok: boolean }>("DELETE", `/api/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`),
  markRead: (channelId: string, upToSeq: number) =>
    req<{ lastReadSeq: number }>("POST", `/api/channels/${encodeURIComponent(channelId)}/read`, { upToSeq }),
  search: (query: string, channel?: string) => {
    const q = new URLSearchParams({ q: query });
    if (channel) q.set("channel", channel);
    return req<Message[]>("GET", `/api/messages/search?${q.toString()}`);
  },
  agents: () => req<AgentProfile[]>("GET", "/api/agents"),
  agent: (handle: string) => req<AgentProfile>("GET", `/api/agents/${encodeURIComponent(handle)}`),
  createAgent: (input: NewAgentInput) => req<AgentProfile>("POST", "/api/agents", input),
  importAgent: (input: ImportRaftInput) => req<AgentProfile>("POST", "/api/agents/import", input),
  inspectRaftAgent: (input: { machineId: string; raftPath: string }) =>
    req<RaftInspectResult>("POST", "/api/agents/import/inspect", input),
  updateAgent: (handle: string, patch: AgentPatch) =>
    req<AgentProfile>("PATCH", `/api/agents/${encodeURIComponent(handle)}`, patch),
  deleteAgent: (handle: string) =>
    req<{ deleted: boolean }>("DELETE", `/api/agents/${encodeURIComponent(handle)}`),
  agentFiles: (handle: string, path = "") =>
    req<FsList>("GET", `/api/agents/${encodeURIComponent(handle)}/files?path=${encodeURIComponent(path)}`),
  agentFile: (handle: string, path: string) =>
    req<FsFile>("GET", `/api/agents/${encodeURIComponent(handle)}/file?path=${encodeURIComponent(path)}`),
  agentActivity: (handle: string, limit = 100) =>
    req<AgentActivityItem[]>("GET", `/api/agents/${encodeURIComponent(handle)}/activity?limit=${limit}`),
  agentSkills: (handle: string) =>
    req<SkillInfo[]>("GET", `/api/agents/${encodeURIComponent(handle)}/skills`),
  openDm: (handle: string) =>
    req<Channel>("POST", `/api/agents/${encodeURIComponent(handle)}/dm`),
  machines: () => req<Machine[]>("GET", "/api/machines"),
  machine: (id: string) => req<Machine>("GET", `/api/machines/${encodeURIComponent(id)}`),
  createMachine: (name?: string) =>
    req<CreateMachineResult>("POST", "/api/machines", name ? { name } : {}),
  renameMachine: (id: string, name: string) =>
    req<Machine>("PATCH", `/api/machines/${encodeURIComponent(id)}`, { name }),
  deleteMachine: (id: string) =>
    req<{ deleted: boolean }>("DELETE", `/api/machines/${encodeURIComponent(id)}`),
  connectCommand: (id: string) =>
    req<{ token: string; connectCommand: string }>("POST", `/api/machines/${encodeURIComponent(id)}/connect-command`),
};

export type { AgentPatch, AgentProfile, Channel, CreateMachineResult, Machine, Message, NewAgentInput, ServerInfo, Task };
