/**
 * 密码哈希 —— scrypt (Node 内置,无原生依赖),每个密码独立随机 salt + 时间安全比较。
 *
 * 存储格式:`scrypt$<saltHex>$<hashHex>`。
 * 兼容历史:旧账号是无 salt 的 sha256(带固定 pepper),verifyPassword 仍能校验,
 *   登录成功后调用方可用 needsUpgrade() 判断并 re-hash 升级到 scrypt。
 */

import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const KEYLEN = 64;
const SCRYPT_PREFIX = "scrypt$";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `${SCRYPT_PREFIX}${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** 旧格式(sha256 + 固定 pepper),仅用于历史账号校验/升级判断。 */
function legacySha256(password: string): string {
  return createHash("sha256").update(`crew-pw:${password}`).digest("hex");
}

export function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [, saltHex, hashHex] = stored.split("$");
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  // 历史 sha256:定长 hex,可安全比较
  const a = Buffer.from(legacySha256(password), "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 该存储哈希是否为旧格式(登录成功后应 re-hash 升级到 scrypt)。 */
export function needsUpgrade(stored: string): boolean {
  return !stored.startsWith(SCRYPT_PREFIX);
}
