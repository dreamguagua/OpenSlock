/**
 * 三级凭证的纯逻辑:token 格式、前缀→层级、哈希。
 *
 * 三层 (爆炸半径隔离):
 *  - `sk_user_*`    人类/web (PAT 或会话派生)
 *  - `sk_machine_*` daemon (机器级)
 *  - `sk_agent_*`   agent CLI (per-launch,能力最窄)
 *
 * 落库只存 sha256(token);明文仅在签发瞬间返回一次。
 */

import { createHash, randomBytes } from "node:crypto";

export const CREDENTIAL_TIERS = ["user", "machine", "agent"] as const;
export type CredentialTier = (typeof CREDENTIAL_TIERS)[number];

const PREFIX: Record<CredentialTier, string> = {
  user: "sk_user_",
  machine: "sk_machine_",
  agent: "sk_agent_",
};

/** 生成一个新 token (明文)。32 字节随机 → 64 hex。 */
export function generateToken(tier: CredentialTier): string {
  return `${PREFIX[tier]}${randomBytes(32).toString("hex")}`;
}

/** 从 token 前缀推断层级;格式非法返回 null。 */
export function tierOf(token: string): CredentialTier | null {
  for (const tier of CREDENTIAL_TIERS) {
    if (token.startsWith(PREFIX[tier]) && token.length > PREFIX[tier].length) {
      return tier;
    }
  }
  return null;
}

/** 落库用的不可逆哈希。 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
