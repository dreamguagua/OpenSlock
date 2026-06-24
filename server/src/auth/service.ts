/**
 * 凭证签发与解析 + 多工作区账号/成员身份 (DB 支撑)。
 *
 * 身份模型:
 *  - account   全局登录身份 (email 唯一)。一个账号可加入多个工作区。
 *  - membership account ↔ workspace ↔ role 的权威关系 (非-RLS,登录/切换跨工作区按 account 全局查)。
 *  - app_user  工作区内的人物档案 (handle/displayName,RLS 租户表)。
 *
 * 解析走全局连接 (credential/account/membership/invite 表无 RLS):鉴权时尚不知 workspace。
 * 解析成功后即得到 workspaceId + 调用者身份,后续所有租户数据访问再走 RLS。
 */

import { and, eq, desc, isNull } from "drizzle-orm";
import { getDb, withTenant } from "../db/client.js";
import * as s from "../db/schema.js";
import { DomainError } from "../domain/errors.js";
import type { Actor } from "../domain/actor.js";
import {
  generateToken,
  hashToken,
  tierOf,
  type CredentialTier,
} from "./credentials.js";
import { hashPassword, verifyPassword, needsUpgrade } from "./password.js";

export interface Principal {
  readonly workspaceId: string;
  readonly tier: CredentialTier;
  readonly actor: Actor;
}

/** 为某主体签发凭证,返回明文 token (仅此一次)。 */
export async function mintCredential(
  workspaceId: string,
  tier: CredentialTier,
  subject: Actor,
): Promise<string> {
  const token = generateToken(tier);
  await getDb().insert(s.credential).values({
    workspaceId,
    tier,
    tokenHash: hashToken(token),
    subjectType: subject.type,
    subjectId: subject.id,
  });
  return token;
}

export interface LoginResult {
  readonly token: string;
  readonly workspaceId: string;
  readonly handle: string;
  /** 账号尚未加入任何工作区:前端应进入"新建工作区"步骤 (token/workspaceId 为空)。 */
  readonly needsWorkspace?: boolean;
}

export interface WorkspaceMembership {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly handle: string;
  readonly role: string;
}

// ---------------------------------------------------------------------------
// 内部辅助 (均走全局连接,显式 where 过滤 —— 与 account/credential 同模式)
// ---------------------------------------------------------------------------

type AccountRow = typeof s.account.$inferSelect;

async function findAccountByEmail(email: string): Promise<AccountRow | undefined> {
  const [acc] = await getDb().select().from(s.account).where(eq(s.account.email, email.toLowerCase().trim()));
  return acc;
}

/** 邮箱密码核验账号 (含旧哈希透明升级)。失败返回 null。 */
async function authAccount(email: string, password: string): Promise<AccountRow | null> {
  const acc = await findAccountByEmail(email);
  if (!acc || !verifyPassword(password, acc.passwordHash)) return null;
  if (needsUpgrade(acc.passwordHash)) {
    await getDb().update(s.account).set({ passwordHash: hashPassword(password) }).where(eq(s.account.id, acc.id));
  }
  return acc;
}

/** 列出某账号的全部成员身份 (含工作区元信息),最近活跃优先。 */
async function membershipsForAccount(accountId: string): Promise<WorkspaceMembership[]> {
  const rows = await getDb()
    .select({
      id: s.workspace.id,
      name: s.workspace.name,
      slug: s.workspace.slug,
      handle: s.membership.handle,
      role: s.membership.role,
      createdAt: s.membership.createdAt,
    })
    .from(s.membership)
    .innerJoin(s.workspace, eq(s.workspace.id, s.membership.workspaceId))
    .where(eq(s.membership.accountId, accountId))
    .orderBy(desc(s.membership.createdAt));
  return rows.map(({ createdAt: _c, ...m }) => m);
}

/** 取某账号在某工作区的成员身份 (角色/handle)。 */
async function membershipInWorkspace(accountId: string, workspaceId: string) {
  const [m] = await getDb()
    .select()
    .from(s.membership)
    .where(and(eq(s.membership.accountId, accountId), eq(s.membership.workspaceId, workspaceId)));
  return m;
}

/** 反查:某工作区里某 handle 对应的成员身份 (account_id/role)。 */
export async function membershipByHandle(workspaceId: string, handle: string) {
  const [m] = await getDb()
    .select()
    .from(s.membership)
    .where(and(eq(s.membership.workspaceId, workspaceId), eq(s.membership.handle, handle)));
  return m;
}

/** name → ascii slug;不足 2 字符回退 fallback。 */
export function slugify(name: string, fallback: string): string {
  const v = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return v.length >= 2 ? v : fallback;
}

/** workspace.slug 全局唯一:base、base-2 … */
async function uniqueWorkspaceSlug(base: string): Promise<string> {
  const db = getDb();
  for (let i = 1; i < 1000; i++) {
    const cand = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
    const [hit] = await db.select({ id: s.workspace.id }).from(s.workspace).where(eq(s.workspace.slug, cand));
    if (!hit) return cand;
  }
  throw new DomainError("CONFLICT", "could not derive a unique workspace slug", { base });
}

/** 在某工作区内取唯一 handle (避开已有 app_user / agent)。须在 withTenant 事务内调用。 */
async function uniqueHandleInTenant(tx: Parameters<Parameters<typeof withTenant>[1]>[0], workspaceId: string, base: string): Promise<string> {
  for (let i = 1; i < 1000; i++) {
    const cand = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
    const [u] = await tx.select({ h: s.appUser.handle }).from(s.appUser)
      .where(and(eq(s.appUser.workspaceId, workspaceId), eq(s.appUser.handle, cand)));
    const [a] = await tx.select({ h: s.agent.handle }).from(s.agent)
      .where(and(eq(s.agent.workspaceId, workspaceId), eq(s.agent.handle, cand)));
    if (!u && !a) return cand;
  }
  throw new DomainError("CONFLICT", "could not derive a unique handle", { base });
}

/** 记录账号最近活跃工作区 (便捷指针,登录默认落点)。 */
async function touchActiveWorkspace(accountId: string, workspaceId: string, handle: string): Promise<void> {
  await getDb().update(s.account).set({ workspaceId, handle }).where(eq(s.account.id, accountId));
}

// ---------------------------------------------------------------------------
// 账号注册 (第一步:仅建全局账号,不绑工作区)
// ---------------------------------------------------------------------------

export interface CreateAccountInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

/** 建全局登录账号 (email 唯一)。不创建工作区。返回账号信息。 */
export async function createAccountOnly(input: CreateAccountInput): Promise<{ accountId: string; email: string; name: string }> {
  const email = input.email.toLowerCase().trim();
  const name = input.name.trim();
  const db = getDb();
  const [existing] = await db.select({ id: s.account.id }).from(s.account).where(eq(s.account.email, email));
  if (existing) throw new DomainError("CONFLICT", "email already registered", { email });
  const [acc] = await db.insert(s.account).values({ email, passwordHash: hashPassword(input.password), name }).returning();
  return { accountId: acc!.id, email, name };
}

// ---------------------------------------------------------------------------
// 第二步之一:为账号开一个新工作区 (本人成为 owner)
// ---------------------------------------------------------------------------

export interface CreateWorkspaceInput {
  readonly workspaceName: string;
  readonly displayName?: string | undefined;
}

/** 内部:已核验账号 → 建工作区 + owner app_user + #general,签发令牌。 */
async function createWorkspaceForAccountRow(acc: AccountRow, input: CreateWorkspaceInput): Promise<LoginResult> {
  const db = getDb();
  const wsName = input.workspaceName.trim() || "My Workspace";
  const slug = await uniqueWorkspaceSlug(slugify(wsName, "workspace"));
  const baseHandle = slugify(input.displayName?.trim() || acc.name?.trim() || acc.email.split("@")[0]!, "owner");
  const displayName = input.displayName?.trim() || acc.name?.trim() || baseHandle;

  const [ws] = await db.insert(s.workspace).values({ name: wsName, slug, createdByAccountId: acc.id }).returning();
  const WS = ws!.id;
  let handle = baseHandle;
  await withTenant(WS, async (tx) => {
    handle = await uniqueHandleInTenant(tx, WS, baseHandle);
    await tx.insert(s.appUser).values({ workspaceId: WS, handle, displayName });
    await tx.insert(s.channel).values({ workspaceId: WS, slug: "general", kind: "channel" });
  });
  await db.insert(s.membership).values({ accountId: acc.id, workspaceId: WS, handle, role: "owner" });
  await touchActiveWorkspace(acc.id, WS, handle);
  const token = await mintCredential(WS, "user", { type: "human", id: handle });
  return { token, workspaceId: WS, handle };
}

/** 公开:邮箱密码核验 → 新建工作区 (第二步)。密码错返回 null。 */
export async function createWorkspaceForAccount(
  email: string,
  password: string,
  input: CreateWorkspaceInput,
): Promise<LoginResult | null> {
  const acc = await authAccount(email, password);
  if (!acc) return null;
  return createWorkspaceForAccountRow(acc, input);
}

/** 已登录用户从切换器新建工作区 (无需重输密码) → 返回新工作区令牌。 */
export async function createWorkspaceForPrincipal(principal: Principal, input: CreateWorkspaceInput): Promise<LoginResult> {
  const cur = await membershipByHandle(principal.workspaceId, principal.actor.id);
  if (!cur) throw new DomainError("FORBIDDEN", "not a known account", {});
  const [acc] = await getDb().select().from(s.account).where(eq(s.account.id, cur.accountId));
  if (!acc) throw new DomainError("FORBIDDEN", "account not found", {});
  return createWorkspaceForAccountRow(acc, input);
}

// ---------------------------------------------------------------------------
// 一步注册 (兼容旧 /api/auth/register + 测试):建账号 + 建工作区
// ---------------------------------------------------------------------------

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly workspaceName: string;
  readonly displayName?: string | undefined;
}

export async function registerAccount(input: RegisterInput): Promise<LoginResult> {
  const created = await createAccountOnly({
    name: input.displayName?.trim() || input.email.split("@")[0]!,
    email: input.email,
    password: input.password,
  });
  const acc = (await findAccountByEmail(created.email))!;
  return createWorkspaceForAccountRow(acc, { workspaceName: input.workspaceName, displayName: input.displayName });
}

// ---------------------------------------------------------------------------
// 登录 / 切换 / 列出我的工作区
// ---------------------------------------------------------------------------

/** 邮箱密码登录 → 落到最近活跃 (或首个) 工作区并签发 sk_user_*。 */
export async function loginWithPassword(email: string, password: string): Promise<LoginResult | null> {
  const acc = await authAccount(email, password);
  if (!acc) return null;
  const mems = await getDb().select().from(s.membership).where(eq(s.membership.accountId, acc.id));
  if (mems.length === 0) return { token: "", workspaceId: "", handle: "", needsWorkspace: true };
  const chosen = mems.find((m) => m.workspaceId === acc.workspaceId) ?? mems[0]!;
  await touchActiveWorkspace(acc.id, chosen.workspaceId, chosen.handle);
  const token = await mintCredential(chosen.workspaceId, "user", { type: "human", id: chosen.handle });
  return { token, workspaceId: chosen.workspaceId, handle: chosen.handle };
}

/** 当前登录用户列出自己可访问的全部工作区 (供侧栏切换器)。 */
export async function listMyWorkspaces(principal: Principal): Promise<WorkspaceMembership[]> {
  const cur = await membershipByHandle(principal.workspaceId, principal.actor.id);
  if (!cur) return [];
  return membershipsForAccount(cur.accountId);
}

/** 切换到已加入的另一个工作区 → 为目标工作区签发新令牌。非成员/未登录返回 null。 */
export async function switchWorkspace(principal: Principal, targetWorkspaceId: string): Promise<LoginResult | null> {
  const cur = await membershipByHandle(principal.workspaceId, principal.actor.id);
  if (!cur) return null;
  const target = await membershipInWorkspace(cur.accountId, targetWorkspaceId);
  if (!target) return null;
  await touchActiveWorkspace(cur.accountId, targetWorkspaceId, target.handle);
  const token = await mintCredential(targetWorkspaceId, "user", { type: "human", id: target.handle });
  return { token, workspaceId: targetWorkspaceId, handle: target.handle };
}

// ---------------------------------------------------------------------------
// 邀请:生成 / 预览 / 接受
// ---------------------------------------------------------------------------

export interface InvitePreview {
  readonly workspaceName: string;
  readonly humans: number;
  readonly agents: number;
}

/** 取有效邀请 (存在 / 未撤销 / 未过期);否则 null。 */
async function getValidInvite(token: string) {
  const [inv] = await getDb().select().from(s.invite).where(eq(s.invite.token, token));
  if (!inv || inv.revokedAt) return null;
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) return null;
  return inv;
}

/** 生成一个工作区邀请链接 token (可复用)。 */
export async function createInvite(workspaceId: string, createdByHandle: string, role: string = "member"): Promise<{ token: string }> {
  const token = "inv_" + generateToken("user").slice("sk_user_".length); // 复用随机源,换前缀
  await getDb().insert(s.invite).values({ workspaceId, token, role, createdByHandle });
  return { token };
}

/** 邀请预览 (Join 页展示工作区名 + 人数/agent 数)。无效返回 null。 */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const inv = await getValidInvite(token);
  if (!inv) return null;
  const [ws] = await getDb().select({ name: s.workspace.name }).from(s.workspace).where(eq(s.workspace.id, inv.workspaceId));
  if (!ws) return null;
  let humans = 0;
  let agents = 0;
  await withTenant(inv.workspaceId, async (tx) => {
    const us = await tx.select({ h: s.appUser.handle }).from(s.appUser).where(eq(s.appUser.workspaceId, inv.workspaceId));
    const as = await tx.select({ h: s.agent.handle }).from(s.agent).where(eq(s.agent.workspaceId, inv.workspaceId));
    humans = us.length;
    agents = as.length;
  });
  return { workspaceName: ws.name, humans, agents };
}

/** 已核验账号加入某工作区 (幂等:已是成员则直接签发)。 */
async function joinWorkspace(acc: AccountRow, workspaceId: string, role: string, displayNameHint?: string): Promise<LoginResult> {
  const existing = await membershipInWorkspace(acc.id, workspaceId);
  if (existing) {
    await touchActiveWorkspace(acc.id, workspaceId, existing.handle);
    const token = await mintCredential(workspaceId, "user", { type: "human", id: existing.handle });
    return { token, workspaceId, handle: existing.handle };
  }
  const baseHandle = slugify(displayNameHint?.trim() || acc.name?.trim() || acc.email.split("@")[0]!, "member");
  const displayName = displayNameHint?.trim() || acc.name?.trim() || baseHandle;
  let handle = baseHandle;
  await withTenant(workspaceId, async (tx) => {
    handle = await uniqueHandleInTenant(tx, workspaceId, baseHandle);
    await tx.insert(s.appUser).values({ workspaceId, handle, displayName });
    // 加入 #general 频道,使新成员可见默认频道
    const [general] = await tx.select({ id: s.channel.id }).from(s.channel)
      .where(and(eq(s.channel.workspaceId, workspaceId), eq(s.channel.slug, "general")));
    if (general) {
      await tx.insert(s.channelMember).values({
        workspaceId, channelId: general.id, memberType: "human", memberId: handle, role: "member",
      });
    }
  });
  await getDb().insert(s.membership).values({ accountId: acc.id, workspaceId, handle, role });
  await touchActiveWorkspace(acc.id, workspaceId, handle);
  const token = await mintCredential(workspaceId, "user", { type: "human", id: handle });
  return { token, workspaceId, handle };
}

/** 凭邮箱密码接受邀请 (未登录入区流程)。密码错返回 null;邀请无效抛错。 */
export async function acceptInviteWithPassword(token: string, email: string, password: string, displayName?: string): Promise<LoginResult | null> {
  const inv = await getValidInvite(token);
  if (!inv) throw new DomainError("NOT_FOUND", "invite link is invalid or expired", { token });
  const acc = await authAccount(email, password);
  if (!acc) return null;
  return joinWorkspace(acc, inv.workspaceId, inv.role, displayName);
}

/** 已登录用户接受邀请 (从某工作区点开邀请链接)。非账号返回 null;邀请无效抛错。 */
export async function acceptInviteAsPrincipal(token: string, principal: Principal): Promise<LoginResult> {
  const inv = await getValidInvite(token);
  if (!inv) throw new DomainError("NOT_FOUND", "invite link is invalid or expired", { token });
  const cur = await membershipByHandle(principal.workspaceId, principal.actor.id);
  if (!cur) throw new DomainError("FORBIDDEN", "not a known account", {});
  const [acc] = await getDb().select().from(s.account).where(eq(s.account.id, cur.accountId));
  if (!acc) throw new DomainError("FORBIDDEN", "account not found", {});
  return joinWorkspace(acc, inv.workspaceId, inv.role);
}

// ---------------------------------------------------------------------------
// 账号信息 / 改密 / OAuth / 登出 / 解析
// ---------------------------------------------------------------------------

/** 取某成员的登录邮箱 (membership → account)。无则 null。 */
export async function getAccountEmail(workspaceId: string, handle: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ email: s.account.email })
    .from(s.membership)
    .innerJoin(s.account, eq(s.account.id, s.membership.accountId))
    .where(and(eq(s.membership.workspaceId, workspaceId), eq(s.membership.handle, handle)));
  return row?.email ?? null;
}

export type ChangePasswordResult = "ok" | "wrong_password" | "not_found";

/** 改密:校验当前密码 → 写入新 scrypt 哈希。 */
export async function changePassword(
  workspaceId: string,
  handle: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const db = getDb();
  const m = await membershipByHandle(workspaceId, handle);
  if (!m) return "not_found";
  const [acc] = await db.select().from(s.account).where(eq(s.account.id, m.accountId));
  if (!acc) return "not_found";
  if (!verifyPassword(currentPassword, acc.passwordHash)) return "wrong_password";
  await db.update(s.account).set({ passwordHash: hashPassword(newPassword) }).where(eq(s.account.id, acc.id));
  return "ok";
}

/** 吊销一个 token(置 revoked_at)。返回是否命中一条有效凭证。 */
export async function revokeToken(token: string): Promise<boolean> {
  if (!token || tierOf(token) === null) return false;
  const rows = await getDb()
    .update(s.credential)
    .set({ revokedAt: new Date() })
    .where(and(eq(s.credential.tokenHash, hashToken(token)), isNull(s.credential.revokedAt)))
    .returning({ id: s.credential.id });
  return rows.length > 0;
}

/**
 * OAuth 登录落地:按邮箱找已有账号→登录;无则建账号 + 默认工作区。
 */
export async function findOrCreateOAuthLogin(email: string, displayName?: string): Promise<LoginResult> {
  const e = email.toLowerCase().trim();
  let acc = await findAccountByEmail(e);
  if (!acc) {
    const { randomUUID } = await import("node:crypto");
    const created = await createAccountOnly({ name: displayName?.trim() || e.split("@")[0]!, email: e, password: randomUUID() + randomUUID() });
    acc = (await findAccountByEmail(created.email))!;
  }
  const mems = await getDb().select().from(s.membership).where(eq(s.membership.accountId, acc.id));
  if (mems.length > 0) {
    const chosen = mems.find((m) => m.workspaceId === acc!.workspaceId) ?? mems[0]!;
    await touchActiveWorkspace(acc.id, chosen.workspaceId, chosen.handle);
    const token = await mintCredential(chosen.workspaceId, "user", { type: "human", id: chosen.handle });
    return { token, workspaceId: chosen.workspaceId, handle: chosen.handle };
  }
  return createWorkspaceForAccountRow(acc, {
    workspaceName: `${displayName?.trim() || e.split("@")[0]}'s workspace`,
    ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
  });
}

/** 解析 token → Principal;无效/已吊销/格式错误返回 null。 */
export async function resolveToken(token: string): Promise<Principal | null> {
  if (!token || tierOf(token) === null) return null;
  const [row] = await getDb()
    .select()
    .from(s.credential)
    .where(and(eq(s.credential.tokenHash, hashToken(token)), isNull(s.credential.revokedAt)));
  if (!row) return null;
  return {
    workspaceId: row.workspaceId,
    tier: row.tier,
    actor: { type: row.subjectType, id: row.subjectId },
  };
}
