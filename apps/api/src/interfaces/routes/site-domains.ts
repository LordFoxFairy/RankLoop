import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isValidSlug, siteOrigin } from '../../domain/site/host-routing'
import { requireScope } from '../../lib/auth'
import { ApiError } from '../../shared/errors'
import { badRequest } from '../error-mapper'

/**
 * 站点域名与展示配置管理。
 *
 * 自有域名是主推形态——内容权重积累在客户自己的域名下，
 * 而非平台子域名。绑定后必须验证归属才生效，
 * 否则任何人绑一个别人的域名就能劫持渲染。
 */

export async function siteDomainRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  platformDomain: string,
): Promise<void> {
  /** 站点详情：含访问地址、域名状态、内容统计 */
  app.get<{ Params: { siteId: string } }>(
    '/sites/:siteId',
    { preHandler: requireScope('sites:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      // 平台管理员可查看任意租户站点
      const site = await prisma.site.findFirst({
        where: {
          id: req.params.siteId,
          ...(req.user?.isPlatformAdmin ? {} : { workspaceId }),
          archivedAt: null,
        },
        include: {
          workspace: { select: { customDomainEnabled: true } },
          indexNowKey: true,
          _count: { select: { contents: true } },
        },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      const published = await prisma.content.count({
        where: { siteId: site.id, status: 'published' },
      })

      return reply.send({
        data: {
          id: site.id,
          name: site.name,
          slug: site.slug,
          subdomain_url: `https://${site.slug}.${platformDomain}`,
          domain: site.domain,
          domain_verified: Boolean(site.domainVerifiedAt),
          // 实际生效地址：已验证的自有域名优先，否则回退子域名
          live_url: siteOrigin({ ...site, platformDomain }),
          custom_domain_allowed: site.workspace.customDomainEnabled,
          settings: site.settings,
          content_count: site._count.contents,
          published_count: published,
          indexnow_configured: Boolean(site.indexNowKey),
          created_at: site.createdAt,
        },
        meta: { request_id: req.id },
      })
    },
  )

  /** 更新站点展示配置（站点名、导航、主题） */
  app.patch<{ Params: { siteId: string } }>(
    '/sites/:siteId',
    { preHandler: requireScope('sites:write') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      const schema = z.object({
        name: z.string().min(1).max(120).optional(),
        slug: z.string().min(1).max(63).optional(),
        settings: z
          .object({
            siteName: z.string().max(120).optional(),
            description: z.string().max(300).optional(),
            lang: z.string().max(16).optional(),
            nav: z
              .array(z.object({ label: z.string().max(40), href: z.string().max(300) }))
              .max(12)
              .optional(),
            theme: z
              .object({
                accent: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
                contentWidth: z.string().max(20).optional(),
              })
              .optional(),
            footer: z.string().max(500).optional(),
          })
          .optional(),
      })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) throw badRequest(parsed.error.issues)

      if (parsed.data.slug && parsed.data.slug !== site.slug) {
        const slug = parsed.data.slug.toLowerCase()
        if (!isValidSlug(slug)) {
          throw new ApiError(422, 'INVALID_SLUG', 'slug 非法或使用了保留名', { slug })
        }
        if (await prisma.site.findUnique({ where: { slug } })) {
          throw new ApiError(409, 'SLUG_TAKEN', '该 slug 已被占用', { slug })
        }
      }

      const updated = await prisma.site.update({
        where: { id: site.id },
        data: {
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          ...(parsed.data.slug ? { slug: parsed.data.slug.toLowerCase() } : {}),
          ...(parsed.data.settings
            ? { settings: { ...(site.settings as object), ...parsed.data.settings } }
            : {}),
        },
      })

      return reply.send({
        data: { id: updated.id, name: updated.name, slug: updated.slug, settings: updated.settings },
        meta: { request_id: req.id },
      })
    },
  )

  /**
   * 绑定自有域名。
   *
   * 返回一条需要客户添加的 TXT 记录用于验证归属。
   * 未验证前 domain 不生效，渲染仍走子域名。
   */
  app.post<{ Params: { siteId: string } }>(
    '/sites/:siteId/domain',
    { preHandler: requireScope('sites:write') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
        include: { workspace: { select: { customDomainEnabled: true } } },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})
      if (!site.workspace.customDomainEnabled) {
        throw new ApiError(403, 'CUSTOM_DOMAIN_DISABLED', '当前工作区未开放自有域名', {})
      }

      const schema = z.object({
        domain: z
          .string()
          .min(3)
          .max(253)
          // 只接受合法主机名，拒绝含协议、路径或端口的输入
          .regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i, '域名格式非法'),
      })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) throw badRequest(parsed.error.issues)

      const domain = parsed.data.domain.toLowerCase()
      // 不允许绑定平台域名自身或其子域名，否则会劫持平台路由
      if (domain === platformDomain || domain.endsWith(`.${platformDomain}`)) {
        throw new ApiError(422, 'RESERVED_DOMAIN', '不可绑定平台域名', { domain })
      }

      const taken = await prisma.site.findFirst({ where: { domain, NOT: { id: site.id } } })
      if (taken) throw new ApiError(409, 'DOMAIN_TAKEN', '该域名已被其他站点绑定', { domain })

      const token = `rankloop-verify=${randomBytes(16).toString('hex')}`
      await prisma.site.update({
        where: { id: site.id },
        // 换域名必须清空验证状态，否则旧验证会让新域名直接生效
        data: {
          domain,
          domainVerifiedAt: null,
          settings: { ...(site.settings as object), domainVerifyToken: token },
        },
      })

      return reply.send({
        data: {
          domain,
          verified: false,
          instructions: {
            step1: `在 ${domain} 的 DNS 添加一条 TXT 记录，值为：${token}`,
            step2: `把 ${domain} 的 CNAME 指向 ${site.slug}.${platformDomain}`,
            step3: '完成后调用 POST /sites/:siteId/domain/verify 触发验证',
          },
          verify_token: token,
        },
        meta: { request_id: req.id },
      })
    },
  )

  /** 触发域名归属验证 */
  app.post<{ Params: { siteId: string } }>(
    '/sites/:siteId/domain/verify',
    { preHandler: requireScope('sites:write') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})
      if (!site.domain) throw new ApiError(409, 'NO_DOMAIN', '尚未绑定自有域名', {})

      const settings = site.settings as { domainVerifyToken?: string }
      const token = settings.domainVerifyToken
      if (!token) throw new ApiError(409, 'NO_TOKEN', '缺少验证令牌，请重新绑定域名', {})

      // 查 TXT 记录确认归属
      const { promises: dns } = await import('node:dns')
      let records: string[][] = []
      try {
        records = await dns.resolveTxt(site.domain)
      } catch (e) {
        return reply.send({
          data: {
            verified: false,
            reason: `无法查询 ${site.domain} 的 TXT 记录：${(e as Error).message}`,
          },
          meta: { request_id: req.id },
        })
      }

      const found = records.some((r) => r.join('').includes(token))
      if (!found) {
        return reply.send({
          data: {
            verified: false,
            reason: '未找到匹配的 TXT 记录，DNS 生效可能需要几分钟',
            expected: token,
          },
          meta: { request_id: req.id },
        })
      }

      await prisma.site.update({
        where: { id: site.id },
        data: { domainVerifiedAt: new Date() },
      })

      return reply.send({
        data: {
          verified: true,
          domain: site.domain,
          live_url: `https://${site.domain}`,
          note: '域名已生效，内容将以该域名对外渲染，权重归属该域名。',
        },
        meta: { request_id: req.id },
      })
    },
  )

  /** 解绑自有域名，回退到子域名 */
  app.delete<{ Params: { siteId: string } }>(
    '/sites/:siteId/domain',
    { preHandler: requireScope('sites:write') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      await prisma.site.update({
        where: { id: site.id },
        data: { domain: null, domainVerifiedAt: null },
      })

      return reply.send({
        data: { domain: null, live_url: `https://${site.slug}.${platformDomain}` },
        meta: { request_id: req.id },
      })
    },
  )
}
