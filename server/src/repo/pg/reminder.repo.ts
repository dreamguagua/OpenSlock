/**
 * PostgreSQL ReminderRepo。owner-scoped 更新用条件 WHERE 原子保证;
 * dueAcrossWorkspaces 遍历 workspace(无 RLS) 后逐租户查(避免 worker 需要 BYPASSRLS)。
 */

import { and, asc, eq, lte, inArray } from "drizzle-orm";
import { getDb, withTenant } from "../../db/client.js";
import * as s from "../../db/schema.js";
import { actorEquals, type Actor } from "../../domain/actor.js";
import type {
  NewReminder,
  ReminderEventKind,
  ReminderEventRow,
  ReminderOutcome,
  ReminderPatch,
  ReminderRepo,
  ReminderRow,
  ReminderStatus,
} from "../types.js";

type Row = typeof s.reminder.$inferSelect;

const toRow = (r: Row): ReminderRow => ({
  id: r.id,
  workspaceId: r.workspaceId,
  owner: { type: r.ownerType, id: r.ownerId },
  title: r.title,
  anchorChannelId: r.anchorChannelId,
  anchorMessageId: r.anchorMessageId,
  kind: r.kind,
  fireAt: r.fireAt ? r.fireAt.toISOString() : null,
  cron: r.cron,
  timezone: r.timezone,
  nextFireAt: r.nextFireAt ? r.nextFireAt.toISOString() : null,
  status: r.status,
});

export const reminders: ReminderRepo = {
  async create(ws, r: NewReminder) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx
        .insert(s.reminder)
        .values({
          workspaceId: ws,
          ownerType: r.owner.type,
          ownerId: r.owner.id,
          title: r.title,
          anchorChannelId: r.anchorChannelId ?? null,
          anchorMessageId: r.anchorMessageId ?? null,
          kind: r.kind,
          fireAt: r.fireAt ?? null,
          cron: r.cron ?? null,
          timezone: r.timezone,
          nextFireAt: r.nextFireAt ?? null,
        })
        .returning();
      await tx.insert(s.reminderEvent).values({
        workspaceId: ws, reminderId: row!.id, kind: "scheduled",
      });
      return toRow(row!);
    });
  },

  async get(ws, rid) {
    return withTenant(ws, async (tx) => {
      const [row] = await tx.select().from(s.reminder).where(eq(s.reminder.id, rid));
      return row ? toRow(row) : null;
    });
  },

  async list(ws, owner?: Actor) {
    return withTenant(ws, async (tx) => {
      const where = owner
        ? and(eq(s.reminder.ownerType, owner.type), eq(s.reminder.ownerId, owner.id))
        : undefined;
      const rows = await tx.select().from(s.reminder).where(where).orderBy(asc(s.reminder.nextFireAt));
      return rows.map(toRow);
    });
  },

  async update(ws, rid, owner: Actor, patch: ReminderPatch): Promise<ReminderOutcome> {
    return withTenant(ws, async (tx) => {
      const [cur] = await tx.select().from(s.reminder).where(eq(s.reminder.id, rid));
      if (!cur) return { kind: "not_found" };
      if (!actorEquals({ type: cur.ownerType, id: cur.ownerId }, owner)) {
        return { kind: "forbidden" };
      }
      const set: Partial<Row> = { updatedAt: new Date() };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.cron !== undefined) set.cron = patch.cron;
      if (patch.timezone !== undefined) set.timezone = patch.timezone;
      if (patch.nextFireAt !== undefined) set.nextFireAt = patch.nextFireAt;
      if (patch.status !== undefined) set.status = patch.status;
      const [row] = await tx
        .update(s.reminder)
        .set(set)
        .where(and(eq(s.reminder.id, rid), eq(s.reminder.ownerType, owner.type), eq(s.reminder.ownerId, owner.id)))
        .returning();
      return row ? { kind: "ok", reminder: toRow(row) } : { kind: "forbidden" };
    });
  },

  async appendEvent(ws, reminderId, kind: ReminderEventKind, detail?: unknown) {
    await withTenant(ws, async (tx) => {
      await tx.insert(s.reminderEvent).values({
        workspaceId: ws, reminderId, kind,
        detail: (detail ?? null) as never,
      });
    });
  },

  async listEvents(ws, reminderId): Promise<ReminderEventRow[]> {
    return withTenant(ws, async (tx) => {
      const rows = await tx
        .select()
        .from(s.reminderEvent)
        .where(eq(s.reminderEvent.reminderId, reminderId))
        .orderBy(asc(s.reminderEvent.at));
      return rows.map((e) => ({
        id: e.id, reminderId: e.reminderId, kind: e.kind,
        at: e.at.toISOString(), detail: e.detail,
      }));
    });
  },

  async dueAcrossWorkspaces(now: Date, limit: number) {
    // workspace 表无 RLS,可直接列;再逐租户查到点提醒
    const wss = await getDb().select({ id: s.workspace.id }).from(s.workspace);
    const out: Array<{ workspaceId: string; reminder: ReminderRow }> = [];
    for (const w of wss) {
      if (out.length >= limit) break;
      const due = await withTenant(w.id, async (tx) =>
        tx
          .select()
          .from(s.reminder)
          .where(
            and(
              inArray(s.reminder.status, ["scheduled", "snoozed"]),
              lte(s.reminder.nextFireAt, now),
            ),
          )
          .limit(limit),
      );
      for (const r of due) out.push({ workspaceId: w.id, reminder: toRow(r) });
    }
    return out.slice(0, limit);
  },

  async markFired(ws, rid, nextFireAt, status: ReminderStatus) {
    await withTenant(ws, async (tx) => {
      await tx
        .update(s.reminder)
        .set({ nextFireAt, status, updatedAt: new Date() })
        .where(eq(s.reminder.id, rid));
    });
  },
};
