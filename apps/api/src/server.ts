import { PrismaClient } from '@prisma/client'
import Fastify, { type FastifyInstance } from 'fastify'
import { listRules } from '@rankloop/seo-rules'
import { createAuthMiddleware } from './lib/auth'
import { type Env, loadEnv } from './lib/env'
import { ApiError } from './lib/errors'
import { contentRoutes } from './routes/contents'
import { openApiRoutes } from './routes/openapi'

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
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
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

  await app.register(
    async (scoped) => {
      scoped.addHook('preHandler', createAuthMiddleware(prisma))
      await contentRoutes(scoped, prisma)
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
