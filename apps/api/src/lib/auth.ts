import type { PrismaClient } from '@prisma/client'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { type ApiKeyScope, hashApiKey } from '../shared'
import { errors } from '../shared'

/**
 * API Key 认证与授权。
 *
 * 规格 §2.2：服务端从已认证身份计算授权，不信任客户端传入的工作区。
 * 因此 workspaceId 一律来自 Key 本身，请求体里的同名字段会被忽略。
 */

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { workspaceId: string; scopes: string[]; apiKeyId: string }
  }
}

export function createAuthMiddleware(prisma: PrismaClient) {
  return async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) throw errors.unauthorized()

    const plaintext = header.slice(7).trim()
    if (!plaintext) throw errors.unauthorized()

    // 直接按哈希查找：等价于固定时间比较，且不必把全部 Key 读进内存
    const record = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(plaintext) },
      select: { id: true, workspaceId: true, scopes: true, revokedAt: true },
    })

    if (!record || record.revokedAt) throw errors.unauthorized()

    req.auth = {
      workspaceId: record.workspaceId,
      scopes: record.scopes,
      apiKeyId: record.id,
    }

    // 异步更新最后使用时间，失败不影响请求
    void prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {})
  }
}

export function requireScope(scope: ApiKeyScope) {
  return async function check(req: FastifyRequest): Promise<void> {
    if (!req.auth) throw errors.unauthorized()
    if (!req.auth.scopes.includes(scope)) throw errors.forbidden(scope)
  }
}

/**
 * 取出站点并校验归属。
 *
 * 跨租户访问返回 404 而非 403——403 会确认资源存在，泄露其他工作区的 ID。
 */
export async function requireSite(prisma: PrismaClient, siteId: string, workspaceId: string) {
  const site = await prisma.site.findFirst({
    where: { id: siteId, workspaceId, archivedAt: null },
  })
  if (!site) throw errors.notFound('站点')
  return site
}
