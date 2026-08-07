import { z } from 'zod'

/**
 * 环境变量校验。
 *
 * 规格 §8.2：生产环境启动时若使用默认密钥必须直接失败——
 * 宁可起不来，也不能带着示例密钥对外服务。
 */

const DEFAULT_SECRETS = [
  'change-me',
  'change-to-at-least-32-random-bytes',
  'change-to-32-byte-key',
  'change-me-on-first-login',
]

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://redis:6379'),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DEFAULT_MAX_SITES: z.coerce.number().int().positive().default(5),
  DEFAULT_MAX_CONTENTS: z.coerce.number().int().positive().default(1000),
  DEFAULT_DAILY_INDEXNOW: z.coerce.number().int().positive().default(200),
  DEFAULT_MAX_WEBHOOKS: z.coerce.number().int().positive().default(10),
})

export type Env = z.infer<typeof schema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`环境变量校验失败：\n${details}`)
  }

  const env = parsed.data

  if (env.NODE_ENV === 'production') {
    const offenders = (['SESSION_SECRET', 'ENCRYPTION_KEY'] as const).filter((key) =>
      DEFAULT_SECRETS.some((d) => env[key].includes(d)),
    )
    if (offenders.length > 0) {
      throw new Error(
        `生产环境不得使用示例密钥：${offenders.join(', ')}。请生成随机值，例如 openssl rand -base64 32`,
      )
    }

    // APP_URL 决定 canonical 与 og:image。留着示例域名会让 Google
    // 把权重转给 example.com——这是静默且严重的 SEO 损害，必须拦在启动前。
    if (/example\.(com|org|net)|localhost/.test(env.APP_URL)) {
      throw new Error(
        `生产环境的 APP_URL 不能是示例或本地地址（当前：${env.APP_URL}）。` +
          'canonical 与社交分享图由它生成，指向错误域名会损害 SEO。',
      )
    }
  }

  return env
}
