/**
 * DirectoryService —— server info (环境感知):列频道(含 viewer 的 joined/unread)+ 成员。
 * RLS 已做租户隔离。
 */

import type { Actor } from "../domain/actor.js";
import type { DirectoryRepo, ServerInfo, WorkspaceInfo } from "../repo/types.js";

export class DirectoryService {
  constructor(private readonly directory: DirectoryRepo) {}

  async serverInfo(workspaceId: string, viewer?: Actor): Promise<ServerInfo> {
    return this.directory.serverInfo(workspaceId, viewer);
  }

  async workspace(workspaceId: string): Promise<WorkspaceInfo | null> {
    return this.directory.workspace(workspaceId);
  }
}
