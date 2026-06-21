/**
 * Agent 管理服务 —— 列出 / 查看 / 新建工作区内的 AI agent。
 *
 * handle 规范化在此统一:小写、去首尾空白。重复 handle 抛 CONFLICT (路由层 → 409)。
 * 新建本身不启动进程 —— agent 在被 @ 提及时由 daemon 按需唤醒。
 */

import { DomainError } from "../domain/errors.js";
import type { AgentPatch, AgentRepo, AgentRow, NewAgent } from "../repo/types.js";

export class AgentService {
  constructor(private readonly repo: AgentRepo) {}

  list(ws: string): Promise<AgentRow[]> {
    return this.repo.list(ws);
  }

  get(ws: string, handle: string): Promise<AgentRow | null> {
    return this.repo.get(ws, normalizeHandle(handle));
  }

  async create(ws: string, input: NewAgent): Promise<AgentRow> {
    const handle = normalizeHandle(input.handle);
    const next: NewAgent = {
      ...input,
      handle,
      displayName: input.displayName.trim() || handle,
    };
    const outcome = await this.repo.create(ws, next);
    if (outcome.kind === "duplicate") {
      throw new DomainError("CONFLICT", `agent handle already exists: ${handle}`, { handle });
    }
    return outcome.agent;
  }

  /** 部分更新 (handle 不可改)。agent 不存在抛 NOT_FOUND。 */
  async update(ws: string, handle: string, patch: AgentPatch): Promise<AgentRow> {
    const next: AgentPatch = {
      ...patch,
      ...(patch.displayName !== undefined
        ? { displayName: patch.displayName.trim() || normalizeHandle(handle) }
        : {}),
    };
    const row = await this.repo.update(ws, normalizeHandle(handle), next);
    if (!row) throw new DomainError("NOT_FOUND", `agent not found: ${handle}`, { handle });
    return row;
  }

  /** 删除。agent 不存在抛 NOT_FOUND。 */
  async remove(ws: string, handle: string): Promise<void> {
    const ok = await this.repo.remove(ws, normalizeHandle(handle));
    if (!ok) throw new DomainError("NOT_FOUND", `agent not found: ${handle}`, { handle });
  }
}

const normalizeHandle = (h: string): string => h.trim().toLowerCase();
