import { PrismaClient } from '@prisma/client'
import { listRules } from '@rankloop/seo-rules'
import { ApiError } from './shared/errors'
import Fastify, { type FastifyInstance } from 'fastify'
import { ContentService } from './application/content-service'
import {
  PrismaContentRepository,
  PrismaQuotaRepository,
  PrismaSiteRepository,
  systemClock,
  uuidGenerator,
} from './infrastructure/prisma-content-repository'
import { seoChecker } from './infrastructure/seo-checker'
import { createAuthMiddleware } from './lib/auth'
import { type Env, loadEnv } from './lib/env'
import { isDomainError, mapDomainError } from './interfaces/error-mapper'
import { dashboardRoutes } from './interfaces/dashboard'
import { contentRoutes } from './interfaces/routes/contents'
import { indexingRoutes } from './interfaces/routes/indexing'
import { statsRoutes } from './interfaces/routes/stats'
import { openApiRoutes } from './interfaces/routes/openapi'

/** 组合根：在此装配各层依赖，其余代码只依赖接口 */
export function buildContentService(prisma: PrismaClient): ContentService {
  return new ContentService({
    contents: new PrismaContentRepository(prisma),
    sites: new PrismaSiteRepository(prisma),
    quotas: new PrismaQuotaRepository(prisma),
    checker: seoChecker,
    ids: uuidGenerator,
    clock: systemClock,
  })
}

export async function buildServer(env: Env, prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // 规格 §8.2：敏感字段必须脱敏，绝不能把 Key 写进日志
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: () => `req_${crypto.randomUUID()}`,
    bodyLimit: 2_100_000,
  })

  app.setErrorHandler((error, req, reply) => {
    const mapped = isDomainError(error) ? mapDomainError(error) : error

    if (mapped instanceof ApiError) {
      return reply.code(mapped.statusCode).send({
        error: { code: mapped.code, message: mapped.message, details: mapped.details },
        meta: { request_id: req.id },
      })
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: '请求过于频繁', details: {} },
        meta: { request_id: req.id },
      })
    }

    req.log.error({ err: error }, 'unhandled error')
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误', details: {} },
      meta: { request_id: req.id },
    })
  })

  // 健康检查（规格 §16）
  app.get('/health/live', async () => ({ status: 'ok' }))

  app.get('/health/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return { status: 'ok', database: 'ok' }
    } catch {
      return reply.code(503).send({ status: 'unavailable', database: 'error' })
    }
  })

  // 规则清单公开可查，第三方据此理解检测标准
  app.get('/api/v1/rules', async () => ({ data: listRules() }))

  await app.register(openApiRoutes, { prefix: '/api/v1' })

  // 可视化面板（同进程提供，单容器单域名）
  await app.register(dashboardRoutes)

  const service = buildContentService(prisma)
  const sites = new PrismaSiteRepository(prisma)
  const siteOrigin = async (siteId: string, workspaceId: string): Promise<string> => {
    const site = await sites.findById(siteId, workspaceId)
    return site?.origin ?? ''
  }

  await app.register(
    async (scoped) => {
      scoped.addHook('preHandler', createAuthMiddleware(prisma))
      await contentRoutes(scoped, service, siteOrigin)
      await statsRoutes(scoped, prisma)
      await indexingRoutes(scoped, prisma)
    },
    { prefix: '/api/v1' },
  )

  return app
}

async function main(): Promise<void> {
  const env = loadEnv()
  const prisma = new PrismaClient()
  const app = await buildServer(env, prisma)

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ port: env.PORT, host: '0.0.0.0' })
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
