import type { PrismaClient } from '@prisma/client'
import type { FastifyRequest } from 'fastify'

/**
 * 审计日志（规格 §8.2）。
 *
 * 多租户产品的合规底线：谁在什么时候改了什么。
 * 表早已建好但一直没接上——本模块把它真正接进写操作路径。
 *
 * 写入失败绝不能影响主流程：审计是旁路，日志丢一条比业务失败可接受得多。
 */

export type AuditAction =
  | 'content.created'
  | 'content.updated'
  | 'content.published'
  | 'site.created'
  | 'site.archived'
  | 'site.domain_bound'
  | 'site.domain_verified'
  | 'apikey.created'
  | 'apikey.revoked'
  | 'tenant.created'
  | 'gsc.synced'

export interface AuditContext {
  workspaceId?: string | null
  userId?: string | null
  action: AuditAction
  resource: string
  resourceId?: string | null
  metadata?: Record<string, unknown>
}

/**
 * 记录一条审计。
 *
 * 刻意不 await——审计写入不应拖慢响应，也不应因失败中断请求。
 */
export function audit(prisma: PrismaClient, req: FastifyRequest, ctx: AuditContext): void {
  void prisma.auditLog
    .create({
      data: {
        workspaceId: ctx.workspaceId ?? req.auth?.workspaceId ?? null,
        userId: ctx.userId ?? req.user?.id ?? null,
        action: ctx.action,
        resource: ctx.resource,
        resourceId: ctx.resourceId ?? null,
        // 绝不记录正文、密钥明文等敏感内容——审计只记「谁做了什么」
        metadata: (ctx.metadata ?? {}) as object,
        ip: req.ip,
      },
    })
    .catch(() => {
      // 审计是旁路，失败不影响主流程
    })
}

export interface AuditQuery {
  workspaceId: string
  limit?: number
  action?: string
  resource?: string
}

export async function listAudit(prisma: PrismaClient, q: AuditQuery) {
  return prisma.auditLog.findMany({
    where: {
      workspaceId: q.workspaceId,
      ...(q.action ? { action: q.action } : {}),
      ...(q.resource ? { resource: q.resource } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(q.limit ?? 100, 500),
    include: { user: { select: { email: true } } },
  })
}
