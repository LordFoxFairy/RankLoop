import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ApiError } from '../../shared/errors'
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  validatePasswordStrength,
  verifyPassword,
} from '../../shared/password'
import { badRequest } from '../error-mapper'

/**
 * 用户认证：注册、登录、登出、当前用户。
 *
 * 补齐产品入口——此前只能靠运维在服务器执行脚本生成 API Key，
 * 新用户没有任何自助路径。
 *
 * 会话用 HttpOnly Cookie，与 API Key 是两套并行的凭据：
 * Cookie 面向控制台的人类用户，API Key 面向第三方系统集成。
 */

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string; isPlatformAdmin: boolean }
  }
}

const credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
})

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ]
  // 生产环境必须带 Secure，否则会话可被中间人窃取；
  // 本地 http 开发时带上会导致 Cookie 根本不被写入
  if (secure) parts.push('Secure')
  reply.header('set-cookie', parts.join('; '))
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

function readSessionToken(req: FastifyRequest): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === SESSION_COOKIE) return v.join('=') || null
  }
  return null
}

/** 解析会话 Cookie，附加到 req.user；无会话时不报错，由路由自行决定 */
export function createSessionMiddleware(prisma: PrismaClient) {
  return async function loadSession(req: FastifyRequest): Promise<void> {
    const token = readSessionToken(req)
    if (!token) return

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: { select: { id: true, email: true, isPlatformAdmin: true, disabledAt: true } } },
    })
    if (!session || session.expiresAt < new Date() || session.user.disabledAt) return

    req.user = {
      id: session.user.id,
      email: session.user.email,
      isPlatformAdmin: session.user.isPlatformAdmin,
    }

    void prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {})
  }
}

export function requireUser(req: FastifyRequest): { id: string; email: string; isPlatformAdmin: boolean } {
  if (!req.user) throw new ApiError(401, 'UNAUTHORIZED', '请先登录', {})
  return req.user
}

export async function authRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  opts: { registrationMode: 'open' | 'invite' | 'closed'; secureCookie: boolean },
): Promise<void> {
  /**
   * 创建租户工作区并签发 API Key。
   *
   * 仅平台管理员可调用——客户不自助注册，由管理员分配凭据后
   * 直接调用接口推送内容，无需登录任何界面。
   */
  app.post('/admin/tenants', async (req, reply) => {
    const user = requireUser(req)
    if (!user.isPlatformAdmin) {
      throw new ApiError(403, 'FORBIDDEN', '需要平台管理员权限', {})
    }

    const schema = z.object({
      name: z.string().min(1).max(80),
      slug: z
        .string()
        .min(2)
        .max(40)
        .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'slug 只能包含小写字母、数字与连字符')
        .optional(),
      keyName: z.string().max(80).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw badRequest(parsed.error.issues)

    const slug =
      parsed.data.slug ??
      `${parsed.data.name.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20) || 'ws'}-${Math.random().toString(36).slice(2, 8)}`

    if (await prisma.workspace.findUnique({ where: { slug } })) {
      throw new ApiError(409, 'SLUG_TAKEN', '该 slug 已被占用', { slug })
    }

    const { generateApiKey, API_KEY_SCOPES } = await import('../../shared/api-key')
    const generated = generateApiKey()

    const result = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name: parsed.data.name,
          slug,
          quota: {
            create: {
              maxSites: Number(process.env.DEFAULT_MAX_SITES ?? 5),
              maxContents: Number(process.env.DEFAULT_MAX_CONTENTS ?? 1000),
              dailyIndexNow: Number(process.env.DEFAULT_DAILY_INDEXNOW ?? 200),
              maxWebhooks: Number(process.env.DEFAULT_MAX_WEBHOOKS ?? 10),
            },
          },
        },
      })
      await tx.apiKey.create({
        data: {
          workspaceId: ws.id,
          name: parsed.data.keyName ?? `${parsed.data.name} 的密钥`,
          keyHash: generated.hash,
          keyPrefix: generated.prefix,
          scopes: [...API_KEY_SCOPES],
        },
      })
      return ws
    })

    return reply.code(201).send({
      data: {
        workspace_id: result.id,
        name: result.name,
        slug: result.slug,
        api_key: generated.plaintext,
        warning: '请立即转交客户，此明文不会再次显示。',
      },
      meta: { request_id: req.id },
    })
  })

  app.post('/auth/login', async (req, reply) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) throw badRequest(parsed.error.issues)

    const email = parsed.data.email.toLowerCase()
    const user = await prisma.user.findUnique({ where: { email } })

    // 无论用户是否存在都执行一次密码校验，避免通过响应时间枚举已注册邮箱
    const ok = user
      ? await verifyPassword(user.passwordHash, parsed.data.password)
      : await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', parsed.data.password)

    if (!user || !ok || user.disabledAt) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确', {})
    }

    const { token, hash } = generateSessionToken()
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: req.headers['user-agent']?.slice(0, 300),
        ip: req.ip,
      },
    })
    setSessionCookie(reply, token, opts.secureCookie)

    return reply.send({
      data: { id: user.id, email: user.email },
      meta: { request_id: req.id },
    })
  })

  app.post('/auth/logout', async (req, reply) => {
    const token = readSessionToken(req)
    if (token) {
      await prisma.session
        .deleteMany({ where: { tokenHash: hashSessionToken(token) } })
        .catch(() => {})
    }
    clearSessionCookie(reply)
    return reply.send({ data: { ok: true }, meta: { request_id: req.id } })
  })

  /** 当前用户与其工作区 */
  app.get('/me', async (req, reply) => {
    const user = requireUser(req)
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      include: { workspace: { select: { id: true, name: true, slug: true } } },
    })

    return reply.send({
      data: {
        id: user.id,
        email: user.email,
        is_platform_admin: user.isPlatformAdmin,
        workspaces: memberships.map((m) => ({
          id: m.workspace.id,
          name: m.workspace.name,
          slug: m.workspace.slug,
          role: m.role,
        })),
      },
      meta: { request_id: req.id },
    })
  })

  /** 平台管理员总览：所有租户及其内容统计 */
  app.get('/admin/tenants', async (req, reply) => {
    const user = requireUser(req)
    if (!user.isPlatformAdmin) {
      throw new ApiError(403, 'FORBIDDEN', '需要平台管理员权限', {})
    }

    const workspaces = await prisma.workspace.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { sites: true, apiKeys: true } },
        sites: { select: { id: true, name: true, slug: true, domain: true, domainVerifiedAt: true } },
      },
    })

    const stats = await Promise.all(
      workspaces.map(async (w) => {
        const siteIds = w.sites.map((s) => s.id)
        const [total, published] = await Promise.all([
          prisma.content.count({ where: { siteId: { in: siteIds } } }),
          prisma.content.count({ where: { siteId: { in: siteIds }, status: 'published' } }),
        ])
        return { id: w.id, total, published }
      }),
    )
    const byId = new Map(stats.map((s) => [s.id, s]))

    return reply.send({
      data: workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        custom_domain_enabled: w.customDomainEnabled,
        site_count: w._count.sites,
        key_count: w._count.apiKeys,
        content_count: byId.get(w.id)?.total ?? 0,
        published_count: byId.get(w.id)?.published ?? 0,
        sites: w.sites,
        created_at: w.createdAt,
      })),
      meta: { request_id: req.id, count: workspaces.length },
    })
  })

  /** 为已有租户补发 API Key */
  app.post('/admin/tenants/:workspaceId/keys', async (req, reply) => {
    const user = requireUser(req)
    if (!user.isPlatformAdmin) {
      throw new ApiError(403, 'FORBIDDEN', '需要平台管理员权限', {})
    }
    const { workspaceId } = req.params as { workspaceId: string }
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } })
    if (!ws) throw new ApiError(404, 'NOT_FOUND', '租户不存在', {})

    const schema = z.object({ name: z.string().min(1).max(80) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw badRequest(parsed.error.issues)

    const { generateApiKey, API_KEY_SCOPES } = await import('../../shared/api-key')
    const generated = generateApiKey()
    const key = await prisma.apiKey.create({
      data: {
        workspaceId,
        name: parsed.data.name,
        keyHash: generated.hash,
        keyPrefix: generated.prefix,
        scopes: [...API_KEY_SCOPES],
      },
    })

    return reply.code(201).send({
      data: { id: key.id, name: key.name, api_key: generated.plaintext,
              warning: '请立即转交客户，此明文不会再次显示。' },
      meta: { request_id: req.id },
    })
  })
}
