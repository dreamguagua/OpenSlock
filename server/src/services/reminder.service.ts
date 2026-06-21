/**
 * ReminderService —— schedule/list/snooze/update/cancel/log。
 * 调度计算委托 domain/reminder.ts;owner-scoped 操作由 repo 原子保证。
 */

import { z } from "zod";
import type { Actor } from "../domain/actor.js";
import { DomainError } from "../domain/errors.js";
import { parseDuration, resolveSchedule } from "../domain/reminder.js";
import type {
  ReminderEventRow,
  ReminderRepo,
  ReminderRow,
} from "../repo/types.js";

const ScheduleInput = z.object({
  title: z.string().min(1).max(500),
  at: z.string().optional(),
  in: z.string().optional(),
  cron: z.string().optional(),
  channelId: z.string().optional(),
  timezone: z.string().optional(),
});
export type ReminderScheduleInput = z.infer<typeof ScheduleInput>;

export type Clock = () => Date;

export class ReminderService {
  constructor(
    private readonly reminders: ReminderRepo,
    private readonly now: Clock = () => new Date(),
  ) {}

  async schedule(workspaceId: string, owner: Actor, raw: ReminderScheduleInput): Promise<ReminderRow> {
    const input = ScheduleInput.parse(raw);
    const sched = resolveSchedule(
      { at: input.at, in: input.in, cron: input.cron, timezone: input.timezone },
      this.now(),
    );
    return this.reminders.create(workspaceId, {
      owner,
      title: input.title,
      anchorChannelId: input.channelId ?? null,
      kind: sched.kind,
      ...(sched.kind === "once"
        ? { fireAt: sched.fireAt }
        : { cron: sched.cron, timezone: sched.timezone }),
      timezone: sched.kind === "recurring" ? sched.timezone : (input.timezone ?? "Asia/Shanghai"),
      nextFireAt: sched.nextFireAt,
    });
  }

  async list(workspaceId: string, owner: Actor): Promise<ReminderRow[]> {
    return this.reminders.list(workspaceId, owner);
  }

  async snooze(workspaceId: string, owner: Actor, id: string, duration: string): Promise<ReminderRow> {
    const nextFireAt = new Date(this.now().getTime() + parseDuration(duration));
    const out = await this.reminders.update(workspaceId, id, owner, {
      nextFireAt,
      status: "snoozed",
    });
    this.assertOk(out, id);
    await this.reminders.appendEvent(workspaceId, id, "snoozed", { until: nextFireAt.toISOString() });
    return (out as { reminder: ReminderRow }).reminder;
  }

  async update(
    workspaceId: string,
    owner: Actor,
    id: string,
    patch: {
      title?: string | undefined; at?: string | undefined;
      in?: string | undefined; cron?: string | undefined;
    },
  ): Promise<ReminderRow> {
    const set: { title?: string; cron?: string; nextFireAt?: Date } = {};
    if (patch.title) set.title = patch.title;
    if (patch.at || patch.in || patch.cron) {
      const sched = resolveSchedule(
        { at: patch.at, in: patch.in, cron: patch.cron },
        this.now(),
      );
      set.nextFireAt = sched.nextFireAt;
      if (sched.kind === "recurring") set.cron = sched.cron;
    }
    if (Object.keys(set).length === 0) {
      throw new DomainError("VALIDATION", "update requires at least one field (--title/--at/--in/--cron)");
    }
    const out = await this.reminders.update(workspaceId, id, owner, set);
    this.assertOk(out, id);
    await this.reminders.appendEvent(workspaceId, id, "updated", set.nextFireAt ? { nextFireAt: set.nextFireAt.toISOString() } : {});
    return (out as { reminder: ReminderRow }).reminder;
  }

  async cancel(workspaceId: string, owner: Actor, id: string): Promise<ReminderRow> {
    const out = await this.reminders.update(workspaceId, id, owner, { status: "cancelled" });
    this.assertOk(out, id);
    await this.reminders.appendEvent(workspaceId, id, "cancelled");
    return (out as { reminder: ReminderRow }).reminder;
  }

  async log(workspaceId: string, owner: Actor, id: string): Promise<ReminderEventRow[]> {
    const r = await this.reminders.get(workspaceId, id);
    if (!r) throw new DomainError("NOT_FOUND", `reminder ${id} not found`, { id });
    if (r.owner.type !== owner.type || r.owner.id !== owner.id) {
      throw new DomainError("FORBIDDEN", "not your reminder", { id });
    }
    return this.reminders.listEvents(workspaceId, id);
  }

  private assertOk(out: { kind: string }, id: string): void {
    if (out.kind === "not_found") throw new DomainError("NOT_FOUND", `reminder ${id} not found`, { id });
    if (out.kind === "forbidden") throw new DomainError("FORBIDDEN", "not your reminder", { id });
  }
}
