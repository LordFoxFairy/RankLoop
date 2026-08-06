import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  EmptyUrlList,
  INDEXNOW_ENDPOINT,
  INDEXNOW_PARTICIPANTS,
  UrlNotOwnedBySite,
  buildIndexNowPayload,
  prepareSubmission,
} from '../../domain/indexing/index-now'
import { buildRobotsTxt, buildSitemap } from '../../domain/indexing/sitemap'
import { requireScope } from '../../lib/auth'
import { ApiError } from '../../shared/errors'
import { badRequest } from '../error-mapper'

/**
 * 收录相关接口（规格 §3.6、§3.7）。
 *
 * Google 与 IndexNow 是两条不同路径：
 * - Google：sitemap + robots.txt 声明，靠自然抓取，无法强制收录；
 * - IndexNow：Bing/Yandex 等支持的主动通知，Google 不参与。
 * 接口文案必须如实反映这一点，不得暗示可以强制 Google 收录（规格 §1.2）。
 */

const submitSchema = z.object({
  event: z.enum(['added', 'updated', 'deleted']).default('updated'),
  urls: z.array(z.string().url()).min(1).max(10_000),
})

export async function indexingRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  /** 站点 sitemap：只含已发布且通过门槛的内容 */
  app.get<{ Params: { siteId: string } }>(
    '/sites/:siteId/sitemap.xml',
    { preHandler: requireScope('indexing:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      // 只列已发布内容——把草稿放进 sitemap 会降低 Google 对该 sitemap 的信任
      const contents = await prisma.content.findMany({
        where: { siteId: site.id, status: 'published' },
        select: { path: true, publishedAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      })

      const xml = buildSitemap(
        contents.map((c) => ({
          loc: `${site.origin}${c.path}`,
          lastmod: c.publishedAt ?? c.updatedAt,
        })),
      )

      return reply.type('application/xml; charset=utf-8').send(xml)
    },
  )

  app.get<{ Params: { siteId: string } }>(
    '/sites/:siteId/robots.txt',
    { preHandler: requireScope('indexing:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      return reply
        .type('text/plain; charset=utf-8')
        .send(buildRobotsTxt({ sitemapUrl: `${site.origin}/sitemap.xml` }))
    },
  )

  /**
   * IndexNow 提交。
   *
   * 幂等：相同 Idempotency-Key 重复提交只记录一次，
   * 避免第三方重试导致配额被重复扣减（规格 §7.4）。
   */
  app.post<{ Params: { siteId: string }; Headers: { 'idempotency-key'?: string } }>(
    '/sites/:siteId/indexnow/submit',
    { preHandler: requireScope('indexing:write') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
        include: { indexNowKey: true },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      const parsed = submitSchema.safeParse(req.body)
      if (!parsed.success) throw badRequest(parsed.error.issues)

      let prepared: ReturnType<typeof prepareSubmission>
      try {
        prepared = prepareSubmission({ urls: parsed.data.urls, origin: site.origin })
      } catch (e) {
        if (e instanceof UrlNotOwnedBySite) {
          throw new ApiError(422, e.code, e.message, { urls: e.urls })
        }
        if (e instanceof EmptyUrlList) throw new ApiError(422, e.code, e.message, {})
        throw e
      }

      if (!site.indexNowKey) {
        throw new ApiError(409, 'INDEXNOW_KEY_MISSING', '该站点尚未配置 IndexNow Key', {
          hint: '先通过 POST /sites/:siteId/indexnow/key 配置',
        })
      }

      const idempotencyKey = req.headers['idempotency-key'] ?? null
      if (idempotencyKey) {
        const existing = await prisma.indexNowSubmission.findUnique({
          where: { siteId_idempotencyKey: { siteId: site.id, idempotencyKey } },
        })
        if (existing) {
          return reply.code(200).send({
            data: { id: existing.id, status: existing.status, deduplicated: true },
            meta: { request_id: req.id },
          })
        }
      }

      const submission = await prisma.indexNowSubmission.create({
        data: {
          siteId: site.id,
          urls: prepared.urls,
          event: parsed.data.event,
          status: 'queued',
          idempotencyKey,
        },
      })

      // 队列消费者尚未实现：如实返回 queued，不伪造成功（规格 §0 第 10 条）
      return reply.code(202).send({
        data: {
          id: submission.id,
          status: 'queued',
          url_count: prepared.urls.length,
          batches: prepared.batches.length,
          endpoint: INDEXNOW_ENDPOINT,
          participants: INDEXNOW_PARTICIPANTS,
          note: 'IndexNow 通知 Bing/Yandex 等引擎；Google 不支持该协议，Google 侧依靠 sitemap 与自然抓取。',
          payload_preview: buildIndexNowPayload({
            host: new URL(site.origin).host,
            key: site.indexNowKey.key,
            urls: prepared.batches[0].slice(0, 3),
          }),
        },
        meta: { request_id: req.id },
      })
    },
  )

  app.post<{ Params: { siteId: string } }>(
    '/sites/:siteId/indexnow/key',
    { preHandler: requireScope('indexing:write') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      const schema = z.object({ key: z.string().min(8).max(128).regex(/^[a-zA-Z0-9-]+$/) })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) throw badRequest(parsed.error.issues)

      const saved = await prisma.indexNowKey.upsert({
        where: { siteId: site.id },
        update: { key: parsed.data.key },
        create: { siteId: site.id, key: parsed.data.key },
      })

      return reply.send({
        data: {
          key_location: `${site.origin}/${saved.key}.txt`,
          note: '请在该地址放置内容为 Key 本身的文本文件，搜索引擎据此验证归属。',
        },
        meta: { request_id: req.id },
      })
    },
  )

  app.get<{ Params: { siteId: string } }>(
    '/sites/:siteId/indexnow/submissions',
    { preHandler: requireScope('indexing:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      const rows = await prisma.indexNowSubmission.findMany({
        where: { siteId: site.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })

      return reply.send({
        data: rows.map((r) => ({
          id: r.id,
          event: r.event,
          status: r.status,
          url_count: Array.isArray(r.urls) ? r.urls.length : 0,
          response_code: r.responseCode,
          created_at: r.createdAt,
        })),
        meta: { request_id: req.id, count: rows.length },
      })
    },
  )
}
