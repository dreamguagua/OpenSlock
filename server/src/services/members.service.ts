/**
 * 工作区人类成员:角色 (membership)、详情页数据、移除成员。
 *
 * 角色/成员身份的权威表是非-RLS 的 membership(见 auth/service);此处的角色读写都走它。
 * 人物档案 (app_user) 与其创建的 agent 走租户 RLS (withTenant)。
 */

import { and, eq } from "drizzle-orm";
import { getDb, withTenant } from "../db/client.js";
import * as s from "../db/schema.js";
import { DomainError } from "../domain/errors.js";

export type WorkspaceRole = "owner" | "admin" | "member";
export const WS_ROLES: readonly WorkspaceRole[] = ["owner", "admin", "member"];

// membership/角色系统仅存在于 PG。内存仓储(测试/演示)用非-UUID 工作区 id 且无角色概念,
// 此时角色检查退化为放行(与引入角色前的行为一致),避免对真实 PG 失败时静默放行。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isPgWorkspace = (ws: string): boolean => UUID_RE.test(ws);

export interface HumanDetail {
  readonly handle: string;
  readonly displayName: string;
  readonly role: WorkspaceRole;
  readonly email: string | null;
  readonly joinedAt: string | null;
  readonly createdAgents: ReadonlyArray<{ handle: string; displayName: string }>;
}

/** 某人在工作区的角色;非成员返回 null。内存仓储(非-UUID 工作区)返回 null。 */
export async function memberRole(workspaceId: string, handle: string): Promise<WorkspaceRole | null> {
  if (!isPgWorkspace(workspaceId)) return null;
  const [m] = await getDb()
    .select({ role: s.membership.role })
    .from(s.membership)
    .where(and(eq(s.membership.workspaceId, workspaceId), eq(s.membership.handle, handle)));
  return (m?.role as WorkspaceRole) ?? null;
}

/** 断言调用者具备某些角色之一,否则抛 FORBIDDEN。内存仓储(无角色系统)放行。 */
export async function assertRole(workspaceId: string, handle: string, allowed: readonly WorkspaceRole[]): Promise<WorkspaceRole> {
  if (!isPgWorkspace(workspaceId)) return "owner"; // 退化:无角色系统,不限制
  const role = await memberRole(workspaceId, handle);
  if (!role || !allowed.includes(role)) {
    throw new DomainError("FORBIDDEN", "insufficient workspace role for this action", { required: allowed });
  }
  return role;
}

/** Human 详情页数据:档案 + 角色 + 邮箱 + 加入时间 + 其创建的 agent。 */
export async function humanDetail(workspaceId: string, handle: string): Promise<HumanDetail | null> {
  const profile = await withTenant(workspaceId, async (tx) => {
    const [u] = await tx.select().from(s.appUser).where(eq(s.appUser.handle, handle));
    if (!u) return null;
    const agents = await tx
      .select({ handle: s.agent.handle, displayName: s.agent.displayName })
      .from(s.agent)
      .where(eq(s.agent.createdByHandle, handle));
    return { u, agents };
  });
  if (!profile) return null;
  const role = (await memberRole(workspaceId, handle)) ?? "member";
  const [emailRow] = await getDb()
    .select({ email: s.account.email })
    .from(s.membership)
    .innerJoin(s.account, eq(s.account.id, s.membership.accountId))
    .where(and(eq(s.membership.workspaceId, workspaceId), eq(s.membership.handle, handle)));
  return {
    handle: profile.u.handle,
    displayName: profile.u.displayName,
    role,
    email: emailRow?.email ?? null,
    joinedAt: profile.u.createdAt ? profile.u.createdAt.toISOString() : null,
    createdAgents: profile.agents,
  };
}

/** 改某成员角色。禁止把最后一个 owner 降级 (工作区至少留一个 owner)。 */
export async function setMemberRole(workspaceId: string, handle: string, role: WorkspaceRole): Promise<HumanDetail | null> {
  const db = getDb();
  const [m] = await db
    .select()
    .from(s.membership)
    .where(and(eq(s.membership.workspaceId, workspaceId), eq(s.membership.handle, handle)));
  if (!m) return null;
  if (m.role === "owner" && role !== "owner") {
    const owners = await db.select({ id: s.membership.id }).from(s.membership)
      .where(and(eq(s.membership.workspaceId, workspaceId), eq(s.membership.role, "owner")));
    if (owners.length <= 1) {
      throw new DomainError("CONFLICT", "cannot demote the last owner; promote someone else first", { handle });
    }
  }
  await db.update(s.membership).set({ role }).where(eq(s.membership.id, m.id));
  return humanDetail(workspaceId, handle);
}

/** 移除成员:删 membership + app_user + 频道成员行。禁止移除最后一个 owner。 */
export async function removeMember(workspaceId: string, handle: string): Promise<boolean> {
  const db = getDb();
  const [m] = await db
    .select()
    .from(s.membership)
    .where(and(eq(s.membership.workspaceId, workspaceId), eq(s.membership.handle, handle)));
  if (m?.role === "owner") {
    const owners = await db.select({ id: s.membership.id }).from(s.membership)
      .where(and(eq(s.membership.workspaceId, workspaceId), eq(s.membership.role, "owner")));
    if (owners.length <= 1) {
      throw new DomainError("CONFLICT", "cannot remove the last owner", { handle });
    }
  }
  if (m) await db.delete(s.membership).where(eq(s.membership.id, m.id));
  return withTenant(workspaceId, async (tx) => {
    await tx.delete(s.channelMember).where(and(eq(s.channelMember.memberType, "human"), eq(s.channelMember.memberId, handle)));
    const deleted = await tx.delete(s.appUser).where(eq(s.appUser.handle, handle)).returning({ id: s.appUser.id });
    return deleted.length > 0 || !!m;
  });
}

/** 标记某 agent 由谁创建 (Human 详情页"Created Agents")。非关键增强,内存仓储下跳过。 */
export async function tagAgentCreator(workspaceId: string, agentHandle: string, creatorHandle: string): Promise<void> {
  if (!isPgWorkspace(workspaceId)) return;
  await withTenant(workspaceId, async (tx) => {
    await tx.update(s.agent).set({ createdByHandle: creatorHandle }).where(eq(s.agent.handle, agentHandle));
  });
}
