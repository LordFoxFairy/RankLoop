import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireScope } from '../../lib/auth'
import { API_KEY_SCOPES, generateApiKey } from '../../shared/api-key'
import { ApiError } from '../../shared/errors'
import { RESERVED_SLUGS, isValidSlug } from '../../domain/site/host-routing'
import { normalizeOrigin } from '../../shared/url'

/** 由站点名推导 slug：转小写、非字母数字转连字符、去重复与首尾连字符 */
function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'site'
}
import { badRequest } from '../error-mapper'

/**
 * 站点与 API Key 管理接口。
 *
 * 供管理平台使用；所有操作限定在调用方工作区内（规格 §2.2）。
 */

export async function siteRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  app.get('/sites', { preHandler: requireScope('sites:read') }, async (req, reply) => {
    const { workspaceId } = req.auth!
    const sites = await prisma.site.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { contents: true } }, indexNowKey: true },
    })

    return reply.send({
      data: sites.map((s) => ({
        id: s.id,
        name: s.name,
        origin: s.origin,
        content_count: s._count.contents,
        indexnow_configured: Boolean(s.indexNowKey),
        created_at: s.createdAt,
      })),
      meta: { request_id: req.id, count: sites.length },
    })
  })

  app.post('/sites', { preHandler: requireScope('sites:write') }, async (req, reply) => {
    const { workspaceId } = req.auth!
    const schema = z.object({
      name: z.string().min(1).max(120),
      origin: z.string().url(),
      // 子域名标识，决定访客地址 <slug>.<平台域名>；未提供时由站点名推导
      slug: z.string().min(1).max(63).optional(),
      // 自有域名（主推形态）。绑定后需验证才生效。
      domain: z.string().min(3).max(253).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw badRequest(parsed.error.issues)

    let origin: string
    try {
      origin = normalizeOrigin(parsed.data.origin)
    } catch (e) {
      throw new ApiError(422, 'INVALID_ORIGIN', (e as Error).message, {})
    }

    const quota = await prisma.workspaceQuota.findUnique({ where: { workspaceId } })
    if (quota) {
      const count = await prisma.site.count({ where: { workspaceId, archivedAt: null } })
      if (count >= quota.maxSites) {
        throw new ApiError(429, 'QUOTA_EXCEEDED', '已超出站点数配额', {
          quota: 'max_sites',
          limit: quota.maxSites,
        })
      }
    }

    const existing = await prisma.site.findUnique({
      where: { workspaceId_origin: { workspaceId, origin } },
    })
    if (existing) {
      throw new ApiError(409, 'SITE_EXISTS', '该 origin 已存在站点', { site_id: existing.id })
    }

    // slug 决定访客地址，必须全局唯一且不与平台保留名冲突
    const slug = (parsed.data.slug ?? deriveSlug(parsed.data.name)).toLowerCase()
    if (!isValidSlug(slug)) {
      throw new ApiError(422, 'INVALID_SLUG', 'slug 只能包含小写字母、数字与连字符，且不可使用保留名', {
        slug,
        reserved: [...RESERVED_SLUGS].slice(0, 8),
      })
    }
    if (await prisma.site.findUnique({ where: { slug } })) {
      throw new ApiError(409, 'SLUG_TAKEN', '该 slug 已被占用，请换一个', { slug })
    }

    const site = await prisma.site.create({
      data: { workspaceId, name: parsed.data.name, origin, slug, domain: parsed.data.domain },
    })

    return reply.code(201).send({
      data: {
        id: site.id,
        name: site.name,
        origin: site.origin,
        slug: site.slug,
        domain: site.domain,
        // 自有域名需验证后才生效，未绑定时先用子域名访问
        url: site.domain ? null : `https://${site.slug}.${process.env.PLATFORM_DOMAIN ?? 'rankloop.miaokit.cloud'}`,
      },
      meta: { request_id: req.id },
    })
  })

  app.delete<{ Params: { siteId: string } }>(
    '/sites/:siteId',
    { preHandler: requireScope('sites:write') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      // 软删除：内容与历史检测记录需保留以供追溯（规格 §6）
      await prisma.site.update({ where: { id: site.id }, data: { archivedAt: new Date() } })
      return reply.send({ data: { id: site.id, archived: true }, meta: { request_id: req.id } })
    },
  )

  app.get('/api-keys', { preHandler: requireScope('sites:read') }, async (req, reply) => {
    const { workspaceId } = req.auth!
    const keys = await prisma.apiKey.findMany({
      where: { workspaceId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      // 绝不返回 keyHash：即使是哈希也不应暴露
      select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, createdAt: true },
    })

    return reply.send({
      data: keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.keyPrefix,
        scopes: k.scopes,
        last_used_at: k.lastUsedAt,
        created_at: k.createdAt,
      })),
      meta: { request_id: req.id, count: keys.length },
    })
  })

  app.post('/api-keys', { preHandler: requireScope('sites:write') }, async (req, reply) => {
    const { workspaceId } = req.auth!
    const schema = z.object({
      name: z.string().min(1).max(80),
      scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw badRequest(parsed.error.issues)

    const generated = generateApiKey()
    const key = await prisma.apiKey.create({
      data: {
        workspaceId,
        name: parsed.data.name,
        keyHash: generated.hash,
        keyPrefix: generated.prefix,
        scopes: parsed.data.scopes,
      },
    })

    // 明文只在此处返回一次，不入库、不进日志（规格 §6、§8.2）
    return reply.code(201).send({
      data: {
        id: key.id,
        name: key.name,
        api_key: generated.plaintext,
        scopes: key.scopes,
        warning: '请立即保存，此明文不会再次显示。',
      },
      meta: { request_id: req.id },
    })
  })

  app.delete<{ Params: { keyId: string } }>(
    '/api-keys/:keyId',
    { preHandler: requireScope('sites:write') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const key = await prisma.apiKey.findFirst({
        where: { id: req.params.keyId, workspaceId, revokedAt: null },
      })
      if (!key) throw new ApiError(404, 'NOT_FOUND', 'API Key 不存在', {})

      await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } })
      return reply.send({ data: { id: key.id, revoked: true }, meta: { request_id: req.id } })
    },
  )
}
