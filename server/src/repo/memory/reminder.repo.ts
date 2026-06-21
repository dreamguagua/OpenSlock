/**
 * 内存 ReminderRepo —— 离线单测用。按 workspaceId 隔离。
 */

import { actorEquals, type Actor } from "../../domain/actor.js";
import type {
  NewReminder,
  ReminderEventKind,
  ReminderEventRow,
  ReminderOutcome,
  ReminderPatch,
  ReminderRepo,
  ReminderRow,
} from "../types.js";

const FIXED_TS = new Date(0).toISOString();
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function createMemoryReminderRepo(): ReminderRepo {
  const reminders = new Map<string, ReminderRow>(); // key `${ws}:${id}`
  const events: ReminderEventRow[] = [];
  let counter = 0;
  const id = (p: string) => `${p}_${(counter += 1)}`;

  return {
    async create(ws, r: NewReminder): Promise<ReminderRow> {
      const row: ReminderRow = {
        id: id("rem"),
        workspaceId: ws,
        owner: r.owner,
        title: r.title,
        anchorChannelId: r.anchorChannelId ?? null,
        anchorMessageId: r.anchorMessageId ?? null,
        kind: r.kind,
        fireAt: iso(r.fireAt),
        cron: r.cron ?? null,
        timezone: r.timezone,
        nextFireAt: iso(r.nextFireAt),
        status: "scheduled",
      };
      reminders.set(`${ws}:${row.id}`, row);
      return row;
    },

    async get(ws, rid) {
      return reminders.get(`${ws}:${rid}`) ?? null;
    },

    async list(ws, owner?: Actor) {
      return [...reminders.values()]
        .filter((r) => r.workspaceId === ws)
        .filter((r) => !owner || actorEquals(r.owner, owner))
        .sort((a, b) => (a.nextFireAt ?? "").localeCompare(b.nextFireAt ?? ""));
    },

    async update(ws, rid, owner: Actor, patch: ReminderPatch): Promise<ReminderOutcome> {
      const key = `${ws}:${rid}`;
      const cur = reminders.get(key);
      if (!cur) return { kind: "not_found" };
      if (!actorEquals(cur.owner, owner)) return { kind: "forbidden" };
      const updated: ReminderRow = {
        ...cur,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.cron !== undefined ? { cron: patch.cron } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.nextFireAt !== undefined ? { nextFireAt: patch.nextFireAt.toISOString() } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      };
      reminders.set(key, updated);
      return { kind: "ok", reminder: updated };
    },

    async appendEvent(ws, reminderId, kind: ReminderEventKind, detail?: unknown) {
      events.push({ id: id("ev"), reminderId, kind, at: FIXED_TS, detail: detail ?? null });
    },

    async listEvents(_ws, reminderId) {
      return events.filter((e) => e.reminderId === reminderId);
    },

    async dueAcrossWorkspaces(now: Date, limit: number) {
      return [...reminders.values()]
        .filter((r) => (r.status === "scheduled" || r.status === "snoozed"))
        .filter((r) => r.nextFireAt !== null && new Date(r.nextFireAt) <= now)
        .slice(0, limit)
        .map((r) => ({ workspaceId: r.workspaceId, reminder: r }));
    },

    async markFired(ws, rid, nextFireAt, status) {
      const key = `${ws}:${rid}`;
      const cur = reminders.get(key);
      if (!cur) return;
      reminders.set(key, { ...cur, nextFireAt: iso(nextFireAt), status });
    },
  };
}
