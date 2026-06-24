/**
 * 凭证签发与解析 (DB 支撑)。
 *
 * 解析走全局连接 (credential 表无 RLS):鉴权时尚不知 workspace,需按 token_hash 全局查。
 * 解析成功后即得到 workspaceId + 调用者身份,后续所有租户数据访问再走 RLS。
 */

import { and, eq, isNull } from "drizzle-orm";
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
}

/** 创建登录账号(email 全局唯一)。 */
export async function createAccount(
  workspaceId: string,
  email: string,
  password: string,
  handle: string,
): Promise<void> {
  await getDb().insert(s.account).values({
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    workspaceId,
    handle,
  });
}

/** 邮箱密码登录 → 为该账号签发 sk_user_*。失败返回 null。 */
export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResult | null> {
  const [acc] = await getDb()
    .select()
    .from(s.account)
    .where(eq(s.account.email, email.toLowerCase()));
  if (!acc || !verifyPassword(password, acc.passwordHash)) return null;
  // 透明升级:旧 sha256 账号登录成功后 re-hash 成 scrypt
  if (needsUpgrade(acc.passwordHash)) {
    await getDb()
      .update(s.account)
      .set({ passwordHash: hashPassword(password) })
      .where(eq(s.account.id, acc.id));
  }
  const token = await mintCredential(acc.workspaceId, "user", { type: "human", id: acc.handle });
  return { token, workspaceId: acc.workspaceId, handle: acc.handle };
}

/** 取某账号的登录邮箱(account 无 RLS,按 ws+handle 全局查)。无账号返回 null。 */
export async function getAccountEmail(workspaceId: string, handle: string): Promise<string | null> {
  const [acc] = await getDb()
    .select({ email: s.account.email })
    .from(s.account)
    .where(and(eq(s.account.workspaceId, workspaceId), eq(s.account.handle, handle)));
  return acc?.email ?? null;
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
  const [acc] = await db
    .select()
    .from(s.account)
    .where(and(eq(s.account.workspaceId, workspaceId), eq(s.account.handle, handle)));
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

/** name → ascii slug;不足 2 字符回退 fallback。 */
export function slugify(name: string, fallback: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s.length >= 2 ? s : fallback;
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

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly workspaceName: string;
  readonly displayName?: string | undefined;
}

/**
 * 注册:开通一个新工作区 + owner 账号 + 一个起步频道,返回登录令牌。
 *   1. email 全局唯一校验 → 冲突 409
 *   2. 建 workspace(唯一 slug)
 *   3. 租户内建 owner app_user + #general 频道
 *   4. 建 account(email/scrypt 哈希)+ 签发 sk_user_*
 */
export async function registerAccount(input: RegisterInput): Promise<LoginResult> {
  const email = input.email.toLowerCase().trim();
  const db = getDb();
  const [existing] = await db.select({ id: s.account.id }).from(s.account).where(eq(s.account.email, email));
  if (existing) throw new DomainError("CONFLICT", "email already registered", { email });

  const wsName = input.workspaceName.trim() || "My Workspace";
  const slug = await uniqueWorkspaceSlug(slugify(wsName, "workspace"));
  const handle = slugify(input.displayName?.trim() || email.split("@")[0]!, "owner");
  const displayName = input.displayName?.trim() || handle;

  const [ws] = await db.insert(s.workspace).values({ name: wsName, slug }).returning();
  const WS = ws!.id;
  await withTenant(WS, async (tx) => {
    await tx.insert(s.appUser).values({ workspaceId: WS, handle, displayName });
    await tx.insert(s.channel).values({ workspaceId: WS, slug: "general", kind: "channel" });
  });
  await createAccount(WS, email, input.password, handle);
  const token = await mintCredential(WS, "user", { type: "human", id: handle });
  return { token, workspaceId: WS, handle };
}

/**
 * OAuth 登录落地:按邮箱找已有账号→登录;无则开通新工作区+账号(密码随机不可用)。
 * 供 OAuthService.findOrCreateByEmail 注入。
 */
export async function findOrCreateOAuthLogin(email: string, displayName?: string): Promise<LoginResult> {
  const e = email.toLowerCase().trim();
  const [acc] = await getDb().select().from(s.account).where(eq(s.account.email, e));
  if (acc) {
    const token = await mintCredential(acc.workspaceId, "user", { type: "human", id: acc.handle });
    return { token, workspaceId: acc.workspaceId, handle: acc.handle };
  }
  // 新用户:开通工作区 + owner 账号(OAuth 账号无密码 → 写一段随机不可用口令)
  const { randomUUID } = await import("node:crypto");
  return registerAccount({
    email: e,
    password: randomUUID() + randomUUID(),
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
    .where(
      and(
        eq(s.credential.tokenHash, hashToken(token)),
        isNull(s.credential.revokedAt),
      ),
    );
  if (!row) return null;
  return {
    workspaceId: row.workspaceId,
    tier: row.tier,
    actor: { type: row.subjectType, id: row.subjectId },
  };
}
