/**
 * TaskService —— claim-before-work 协议。
 *
 * claim 是有 side effect 的操作,因此 agent claim 前同样要过 freshness preflight
 * (真实 task#160 case:claim 被 freshness hold,复核后重试才成功)。
 * 通过后调用 repo 的原子 claim,并把领域结果翻译为成功值或 DomainError。
 */

import { z } from "zod";
import { actorEquals, type Actor } from "../domain/actor.js";
import type { TaskStatus } from "../domain/claim.js";
import { decideFreshness } from "../domain/freshness.js";
import { decideStatusUpdate, decideUnclaim, isTaskStatus } from "../domain/task-ops.js";
import { DomainError } from "../domain/errors.js";
import type {
  MessageRepo,
  MessageRow,
  SeenCursorRepo,
  TaskListFilter,
  TaskRepo,
  TaskRow,
} from "../repo/types.js";

export interface ClaimSuccess {
  readonly taskId: string;
  readonly assignee: Actor;
  readonly status: TaskStatus;
  readonly idempotent: boolean;
}

const CreateInput = z.object({
  channelId: z.string().min(1),
  title: z.string().min(1).max(500),
  parentTaskId: z.string().min(1).optional(),
});
export type CreateTaskInput = z.infer<typeof CreateInput>;

export class TaskService {
  constructor(
    private readonly tasks: TaskRepo,
    private readonly seen: SeenCursorRepo,
    private readonly messages: MessageRepo, // 兼 freshness(latestSeq) 与 create(append)
  ) {}

  /**
   * agent 领取任务。
   * @throws DomainError NOT_FOUND / NOT_CLAIMABLE / FRESHNESS_HOLD / CLAIM_CONFLICT
   */
  async claim(
    workspaceId: string,
    claimant: Actor,
    taskId: string,
  ): Promise<ClaimSuccess> {
    const task = await this.tasks.get(workspaceId, taskId);
    if (!task) {
      throw new DomainError("NOT_FOUND", `task ${taskId} not found`, { taskId });
    }
    if (task.anchoredOnSystemMessage) {
      throw new DomainError("NOT_CLAIMABLE", "system messages cannot become tasks", {
        taskId,
      });
    }

    // freshness preflight:仅对 agent 生效(模型可能漏看新消息)。人类在 UI 上主动操作,
    // 自己就是当前读者,不应被 freshness 阻断。
    if (claimant.type === "agent") {
      const modelSeenSeq = await this.seen.get(workspaceId, claimant.id, task.channelId);
      const latestSeq = await this.messages.latestSeq(workspaceId, task.channelId);
      const decision = decideFreshness({ modelSeenSeq, latestSeq });
      if (decision.kind === "hold") {
        throw new DomainError(
          "FRESHNESS_HOLD",
          `claim blocked: ${decision.unseenCount} unseen message(s) in ${task.channelId}`,
          {
            taskId,
            channelId: task.channelId,
            unseenCount: decision.unseenCount,
            fromSeq: decision.fromSeq,
            toSeq: decision.toSeq,
          },
        );
      }
    }

    const result = await this.tasks.claim(workspaceId, taskId, claimant);
    switch (result.kind) {
      case "claimed":
        return {
          taskId,
          assignee: result.assignee,
          status: result.status,
          idempotent: false,
        };
      case "already_mine":
        return {
          taskId,
          assignee: claimant,
          status: task.status,
          idempotent: true,
        };
      case "not_claimable":
        throw new DomainError("NOT_CLAIMABLE", "task is not claimable", { taskId });
      case "conflict":
        throw new DomainError(
          "CLAIM_CONFLICT",
          `task ${taskId} already assigned`,
          { taskId, heldBy: result.heldBy },
        );
    }
  }

  /** 列任务板 (按频道/状态/负责人过滤)。 */
  async list(workspaceId: string, filter: TaskListFilter = {}): Promise<TaskRow[]> {
    return this.tasks.list(workspaceId, filter);
  }

  /**
   * 创建任务 = 发一条 task-message + 提升为任务。
   * @returns 新任务 + 其锚定消息
   */
  async create(
    workspaceId: string,
    creator: Actor,
    raw: CreateTaskInput,
  ): Promise<{ task: TaskRow; message: MessageRow }> {
    const input = CreateInput.parse(raw);
    const message = await this.messages.append(workspaceId, {
      channelId: input.channelId,
      type: creator.type === "human" ? "human" : "agent",
      sender: creator,
      content: input.title,
    });
    // 创建者已"看过"自己刚发的 task-message,推进其 freshness 游标,
    // 否则随后 claim 自己的任务会被自己这条新消息 freshness-hold。
    if (creator.type === "agent") {
      await this.seen.advance(workspaceId, creator.id, input.channelId, message.seq);
    }
    const task = await this.tasks.create(workspaceId, {
      channelId: input.channelId,
      title: input.title,
      messageId: message.id,
      createdBy: creator,
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
    });
    return { task, message };
  }

  /**
   * 批量创建任务(任务拆分:把一个大任务拆成多个并行子任务)。
   * 逐条复用 create(各自发 task-message + 分配编号);可选 parentTaskId 把它们挂到父任务下。
   * 父任务存在性校验:提供 parentTaskId 时父任务须存在,否则 NOT_FOUND。
   */
  async createBatch(
    workspaceId: string,
    creator: Actor,
    input: { channelId: string; titles: readonly string[]; parentTaskId?: string },
  ): Promise<Array<{ task: TaskRow; message: MessageRow }>> {
    const titles = input.titles.map((t) => t.trim()).filter(Boolean);
    if (titles.length === 0) throw new DomainError("VALIDATION", "no titles provided", {});
    if (titles.length > 50) throw new DomainError("VALIDATION", "too many subtasks (max 50)", { count: titles.length });
    if (input.parentTaskId) {
      const parent = await this.tasks.get(workspaceId, input.parentTaskId);
      if (!parent) throw new DomainError("NOT_FOUND", `parent task not found: ${input.parentTaskId}`, { parentTaskId: input.parentTaskId });
    }
    const out: Array<{ task: TaskRow; message: MessageRow }> = [];
    for (const title of titles) {
      out.push(await this.create(workspaceId, creator, {
        channelId: input.channelId,
        title,
        ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      }));
    }
    return out;
  }

  /**
   * 把一条已存在的消息提升为任务 (raft 的 asTask 语义:消息本身就是任务,不另发消息)。
   */
  async createFromMessage(
    workspaceId: string,
    creator: Actor,
    input: { channelId: string; title: string; messageId: string },
  ): Promise<TaskRow> {
    return this.tasks.create(workspaceId, {
      channelId: input.channelId,
      title: input.title.slice(0, 200),
      messageId: input.messageId,
      createdBy: creator,
    });
  }

  /**
   * 指派 / 交接:把任务的 assignee 设为指定 agent(覆盖现有)。
   * 用于:① 创建任务时服务端自动指派(DM 对端 / @mention);② agent 干完交接给下家(dev→qa)。
   * 权限:任务无主、或 byActor 是当前 assignee(交接)、或 byActor 是人类,才允许。
   * 不做 freshness 阻断(这是指派动作,非 agent 自己 claim)。
   * @throws DomainError NOT_FOUND / NOT_CLAIMABLE / FORBIDDEN / CONFLICT
   */
  async assign(
    workspaceId: string,
    byActor: Actor,
    taskId: string,
    toHandle: string,
  ): Promise<TaskRow> {
    const task = await this.tasks.get(workspaceId, taskId);
    if (!task) throw new DomainError("NOT_FOUND", `task ${taskId} not found`, { taskId });
    if (task.anchoredOnSystemMessage) {
      throw new DomainError("NOT_CLAIMABLE", "system messages cannot become tasks", { taskId });
    }
    const allowed =
      !task.assignee || byActor.type === "human" || actorEquals(task.assignee, byActor);
    if (!allowed) {
      throw new DomainError("FORBIDDEN", "only the current assignee or a human can reassign", { taskId });
    }
    const out = await this.tasks.assign(workspaceId, taskId, { type: "agent", id: toHandle });
    if (out.kind === "not_found") {
      throw new DomainError("NOT_FOUND", `task ${taskId} not found`, { taskId });
    }
    if (out.kind !== "ok") {
      throw new DomainError("CONFLICT", "task is not assignable (done/system)", { taskId });
    }
    return out.task;
  }

  /**
   * 释放认领。
   * @throws DomainError NOT_FOUND / FORBIDDEN(非本人) / CONFLICT(未认领或并发)
   */
  async unclaim(workspaceId: string, actor: Actor, taskId: string): Promise<TaskRow> {
    const task = await this.tasks.get(workspaceId, taskId);
    if (!task) throw new DomainError("NOT_FOUND", `task ${taskId} not found`, { taskId });

    const decision = decideUnclaim({ assignee: task.assignee, status: task.status }, actor);
    if (decision.kind === "not_claimed") {
      throw new DomainError("CONFLICT", "task is not claimed", { taskId });
    }
    if (decision.kind === "forbidden") {
      throw new DomainError("FORBIDDEN", "cannot unclaim another actor's task", { taskId });
    }
    const out = await this.tasks.unclaim(workspaceId, taskId, actor, decision.status);
    if (out.kind !== "ok") {
      throw new DomainError("CONFLICT", "unclaim failed (concurrent change)", { taskId });
    }
    return out.task;
  }

  /**
   * 改任务状态。
   * @throws DomainError NOT_FOUND / VALIDATION / CONFLICT(done 终态/并发) / FORBIDDEN(非本人)
   */
  async updateStatus(
    workspaceId: string,
    actor: Actor,
    taskId: string,
    nextStatus: string,
  ): Promise<TaskRow> {
    if (!isTaskStatus(nextStatus)) {
      throw new DomainError("VALIDATION", `invalid status: ${nextStatus}`, { nextStatus });
    }
    const task = await this.tasks.get(workspaceId, taskId);
    if (!task) throw new DomainError("NOT_FOUND", `task ${taskId} not found`, { taskId });

    const decision = decideStatusUpdate(
      { assignee: task.assignee, status: task.status },
      actor,
      nextStatus,
    );
    if (decision.kind === "invalid") {
      throw new DomainError("VALIDATION", `invalid status: ${nextStatus}`, { nextStatus });
    }
    if (decision.kind === "forbidden") {
      throw new DomainError("FORBIDDEN", "only the assignee or a human can update status", { taskId });
    }
    // 权限已由 decideStatusUpdate 放行;repo 仅做乐观并发 CAS:
    // 用 service 刚读到的 task.assignee 作为期望值,确保「读→写」之间未被并发改派。
    const out = await this.tasks.updateStatus(workspaceId, taskId, task.assignee, decision.status);
    if (out.kind !== "ok") {
      throw new DomainError("CONFLICT", "status update failed (concurrent change)", { taskId });
    }
    return out.task;
  }
}
