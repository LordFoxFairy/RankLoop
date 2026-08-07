import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'

/**
 * 用户密码与会话令牌。
 *
 * 密码用 Argon2id（规格 §8.2）——密码是低熵输入，必须用慢哈希抵御离线爆破。
 * 会话令牌是 256 位随机值，不存在字典攻击空间，用 SHA-256 即可，
 * 且每次请求都要校验，慢哈希会拖垮吞吐。
 */

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB，OWASP 推荐下限
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTIONS)
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain)
  } catch {
    // 哈希格式损坏时不应抛错中断登录流程，按验证失败处理
    return false
  }
}

export interface SessionToken {
  /** 明文，写入 Cookie，不入库 */
  token: string
  hash: string
}

export function generateSessionToken(): SessionToken {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashSessionToken(token) }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function verifySessionToken(token: string, expectedHash: string): boolean {
  const a = Buffer.from(hashSessionToken(token), 'hex')
  const b = Buffer.from(expectedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** 密码强度：只做长度下限，不强制字符类别（NIST 800-63B 的建议） */
export function validatePasswordStrength(plain: string): { ok: boolean; reason?: string } {
  if (plain.length < 10) return { ok: false, reason: '密码至少 10 个字符' }
  if (plain.length > 200) return { ok: false, reason: '密码过长' }
  return { ok: true }
}

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000
export const SESSION_COOKIE = 'rankloop_session'
