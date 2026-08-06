import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * API Key 生成与校验（规格 §6、§8.2）。
 *
 * 数据库只保存哈希与前缀，明文仅在创建时返回一次。
 * 校验使用固定时间比较，避免通过响应时间差反推 Key。
 */

const PREFIX = 'rkl_live_'

export interface GeneratedKey {
  /** 明文，仅创建时返回一次，绝不入库、不进日志 */
  plaintext: string
  hash: string
  /** 前缀片段，供界面识别是哪一把 Key */
  prefix: string
}

export function generateApiKey(): GeneratedKey {
  const secret = randomBytes(24).toString('base64url')
  const plaintext = `${PREFIX}${secret}`
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, PREFIX.length + 6),
  }
}

/**
 * SHA-256 足够：Key 本身是 192 位随机值，不存在字典攻击空间，
 * 无需 Argon2 那样的慢哈希（慢哈希会拖慢每一次 API 请求）。
 * 用户密码则必须用 Argon2id——那是低熵输入。
 */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export function verifyApiKey(plaintext: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashApiKey(plaintext), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export const API_KEY_SCOPES = [
  'sites:read',
  'sites:write',
  'contents:read',
  'contents:write',
  'contents:publish',
  'issues:read',
  'indexing:read',
  'indexing:write',
  'webhooks:write',
] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

export function hasScope(granted: string[], required: ApiKeyScope): boolean {
  return granted.includes(required)
}
