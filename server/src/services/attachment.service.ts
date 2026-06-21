/**
 * 附件服务 (raft attachment) —— 元数据进 DB,字节进 BlobStore。
 *
 * 上传:预生成 id → storageKey=<ws>/<id> → put 字节 → 写元数据行。
 * 下载:取元数据 (校验租户) → 从 store 取字节。
 */

import { randomUUID } from "node:crypto";
import { DomainError } from "../domain/errors.js";
import type { Actor } from "../domain/actor.js";
import type { AttachmentRepo, AttachmentRow } from "../repo/types.js";
import type { BlobStore } from "../storage/blob-store.js";

export interface AttachmentDTO {
  readonly id: string;
  readonly filename: string;
  readonly mime: string;
  readonly size: number;
  readonly url: string; // 经鉴权 fetch 的下载地址
}
/** Files tab 用:附件 + 上传者 + 时间。 */
export interface ChannelFileDTO extends AttachmentDTO {
  readonly uploader: Actor;
  readonly createdAt: string;
}

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

export class AttachmentService {
  constructor(
    private readonly repo: AttachmentRepo,
    private readonly store: BlobStore,
  ) {}

  async upload(
    ws: string,
    uploader: Actor,
    input: { messageId: string | null; filename: string; mime: string; data: Buffer },
  ): Promise<AttachmentRow> {
    const filename = input.filename.trim();
    if (!filename) throw new DomainError("VALIDATION", "filename required", {});
    if (input.data.length === 0) throw new DomainError("VALIDATION", "empty file", {});
    if (input.data.length > MAX_BYTES) {
      throw new DomainError("VALIDATION", `file too large (max ${MAX_BYTES} bytes)`, { size: input.data.length });
    }
    const id = randomUUID();
    const storageKey = `${ws}/${id}`;
    await this.store.put(storageKey, input.data);
    try {
      return await this.repo.create(ws, {
        id,
        messageId: input.messageId,
        uploader,
        filename,
        mime: input.mime || "application/octet-stream",
        sizeBytes: input.data.length,
        storageKey,
      });
    } catch (e) {
      // 元数据写失败 → 回收已写字节,避免孤儿 blob
      await this.store.delete(storageKey).catch(() => {});
      throw e;
    }
  }

  /** 取附件字节 + 元数据 (下载用)。不存在 → NOT_FOUND。 */
  async download(ws: string, id: string): Promise<{ row: AttachmentRow; data: Buffer }> {
    const row = await this.repo.get(ws, id);
    if (!row) throw new DomainError("NOT_FOUND", `attachment not found: ${id}`, { id });
    const data = await this.store.get(row.storageKey);
    return { row, data };
  }

  /** 某频道的全部附件 (Files tab),含上传者 + 时间,按上传时间倒序。 */
  async forChannel(ws: string, channelId: string): Promise<ChannelFileDTO[]> {
    const rows = await this.repo.listForChannel(ws, channelId);
    return rows.map((r) => ({ ...toDTO(r), uploader: r.uploader, createdAt: r.createdAt }));
  }

  /** 聚合这批消息的附件:messageId → DTO[]。 */
  async forMessages(ws: string, messageIds: readonly string[]): Promise<Map<string, AttachmentDTO[]>> {
    const out = new Map<string, AttachmentDTO[]>();
    if (messageIds.length === 0) return out;
    const rows = await this.repo.listForMessages(ws, messageIds);
    for (const r of rows) {
      if (!r.messageId) continue;
      const list = out.get(r.messageId) ?? [];
      list.push(toDTO(r));
      out.set(r.messageId, list);
    }
    return out;
  }
}

export function toDTO(r: AttachmentRow): AttachmentDTO {
  return { id: r.id, filename: r.filename, mime: r.mime, size: r.sizeBytes, url: `/api/attachments/${r.id}/download` };
}
