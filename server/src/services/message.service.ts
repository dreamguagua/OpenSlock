/**
 * MessageService —— 频道消息的写入与发送。
 *
 * - 人类发送:直接 append (人始终通过 UI 看到最新,无需 freshness)。
 * - agent 发送:先做 freshness preflight。目标频道有模型未见过的新消息 → 不发,
 *   落为 draft 并抛 FRESHNESS_HOLD (除非 force=--send-draft)。否则 append。
 * - system 消息:由平台内部 append (如 "📋 task created")。
 *
 * seq 的原子分配由 repo 负责;本服务只编排"是否允许写 + 写什么"。
 */

import { z } from "zod";
import type { Actor } from "../domain/actor.js";
import { decideFreshness } from "../domain/freshness.js";
import { DomainError } from "../domain/errors.js";
import type {
  DraftRepo,
  MessageRepo,
  MessageRow,
  SeenCursorRepo,
} from "../repo/types.js";

const SendInput = z.object({
  channelId: z.string().min(1),
  content: z.string().min(1, "message content must not be empty"),
  threadParentId: z.string().min(1).nullable().optional(),
  force: z.boolean().optional(),
});
export type SendInput = z.infer<typeof SendInput>;

export type SendResult =
  | { readonly kind: "sent"; readonly message: MessageRow }
  | {
      readonly kind: "held";
      readonly draftId: string;
      readonly unseenCount: number;
      readonly fromSeq: number;
      readonly toSeq: number;
    };

export class MessageService {
  constructor(
    private readonly messages: MessageRepo,
    private readonly drafts: DraftRepo,
    private readonly seen: SeenCursorRepo,
    /** 可选:归档校验。提供时,向已归档频道发消息被拒。 */
    private readonly channels?: { isArchived(ws: string, channelId: string): Promise<boolean> },
  ) {}

  private async assertWritable(ws: string, channelId: string): Promise<void> {
    if (this.channels && (await this.channels.isArchived(ws, channelId))) {
      throw new DomainError("CONFLICT", "channel is archived; it is read-only", { channelId });
    }
  }

  /** 人类成员发送:无 freshness 约束。 */
  async sendAsHuman(
    workspaceId: string,
    sender: Actor,
    raw: SendInput,
  ): Promise<MessageRow> {
    const input = SendInput.parse(raw);
    await this.assertWritable(workspaceId, input.channelId);
    return this.messages.append(workspaceId, {
      channelId: input.channelId,
      type: "human",
      sender,
      content: input.content,
      threadParentId: input.threadParentId ?? null,
    });
  }

  /** agent 发送:freshness preflight,被 hold 则落 draft。 */
  async sendAsAgent(
    workspaceId: string,
    agent: Actor,
    raw: SendInput,
  ): Promise<SendResult> {
    const input = SendInput.parse(raw);
    await this.assertWritable(workspaceId, input.channelId);

    const latestSeq = await this.messages.latestSeq(workspaceId, input.channelId);
    const modelSeenSeq = await this.seen.get(workspaceId, agent.id, input.channelId);
    const decision = decideFreshness({
      modelSeenSeq,
      latestSeq,
      force: input.force ?? false,
    });

    if (decision.kind === "hold") {
      const draft = await this.drafts.create(workspaceId, {
        channelId: input.channelId,
        author: agent,
        content: input.content,
        heldAtSeq: latestSeq,
      });
      return {
        kind: "held",
        draftId: draft.id,
        unseenCount: decision.unseenCount,
        fromSeq: decision.fromSeq,
        toSeq: decision.toSeq,
      };
    }

    const message = await this.messages.append(workspaceId, {
      channelId: input.channelId,
      type: "agent",
      sender: agent,
      content: input.content,
      threadParentId: input.threadParentId ?? null,
    });
    // 发送成功视为已读到此刻:推进自己的 seen 游标,避免被自己刚发的消息 hold。
    await this.seen.advance(workspaceId, agent.id, input.channelId, message.seq);
    return { kind: "sent", message };
  }

  /** 关键词检索 (子串)。 */
  async search(
    workspaceId: string,
    opts: { query: string; channelId?: string | undefined; limit?: number | undefined },
  ): Promise<MessageRow[]> {
    const query = (opts.query ?? "").trim();
    if (!query) {
      throw new DomainError("VALIDATION", "search query must not be empty");
    }
    return this.messages.search(workspaceId, { ...opts, query });
  }

  /** 核实消息 id 是否真实存在 (按完整 id 或短码)。 */
  async resolve(workspaceId: string, idOrPrefix: string): Promise<MessageRow> {
    const key = (idOrPrefix ?? "").trim();
    if (!key) throw new DomainError("VALIDATION", "message id must not be empty");
    const row = await this.messages.resolve(workspaceId, key);
    if (!row) {
      throw new DomainError("NOT_FOUND", `message ${key} not found`, { idOrPrefix: key });
    }
    return row;
  }

  /** 平台内部 system 消息 (不可被 claim)。 */
  async appendSystem(
    workspaceId: string,
    channelId: string,
    content: string,
  ): Promise<MessageRow> {
    if (!channelId || !content) {
      throw new DomainError("VALIDATION", "system message requires channelId and content");
    }
    return this.messages.append(workspaceId, {
      channelId,
      type: "system",
      sender: { type: "system", id: "platform" },
      content,
      threadParentId: null,
    });
  }
}
