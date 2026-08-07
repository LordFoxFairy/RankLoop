import { describe, expect, it } from 'vitest'
import { loadEnv } from './env'

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  SESSION_SECRET: 'a'.repeat(32),
  ENCRYPTION_KEY: 'b'.repeat(32),
}

describe('环境变量校验', () => {
  it('接受合法配置并填充默认值', () => {
    const env = loadEnv({ ...valid } as NodeJS.ProcessEnv)
    expect(env.PORT).toBe(8080)
    expect(env.REGISTRATION_MODE).toBe('invite')
  })

  it('缺少 DATABASE_URL 时抛错', () => {
    const { DATABASE_URL, ...rest } = valid
    expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/)
  })

  it('密钥过短时抛错', () => {
    expect(() =>
      loadEnv({ ...valid, SESSION_SECRET: 'short' } as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_SECRET/)
  })

  it('生产环境使用示例密钥必须启动失败', () => {
    // 规格 §8.2：宁可起不来，也不能带着示例密钥对外服务
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        SESSION_SECRET: 'change-to-at-least-32-random-bytes',
      } as NodeJS.ProcessEnv),
    ).toThrow(/示例密钥/)
  })

  it('开发环境允许示例密钥，便于本地起服务', () => {
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'development',
        SESSION_SECRET: 'change-to-at-least-32-random-bytes',
      } as NodeJS.ProcessEnv),
    ).not.toThrow()
  })

  it('生产环境使用示例域名必须启动失败', () => {
    // APP_URL 决定 canonical 与 og:image。留着示例域名会让 Google
    // 把权重转给 example.com——静默且严重，必须拦在启动前。
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        APP_URL: 'https://seo.example.com',
      } as NodeJS.ProcessEnv),
    ).toThrow(/APP_URL/)
  })

  it('生产环境不接受 localhost 作为对外地址', () => {
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        APP_URL: 'http://localhost:3000',
      } as NodeJS.ProcessEnv),
    ).toThrow(/APP_URL/)
  })

  it('开发环境允许示例域名，便于本地调试', () => {
    expect(() =>
      loadEnv({ ...valid, APP_URL: 'https://seo.example.com' } as NodeJS.ProcessEnv),
    ).not.toThrow()
  })

  it('生产环境使用随机密钥可正常启动', () => {
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        APP_URL: 'https://rankloop.miaokit.cloud',
      } as NodeJS.ProcessEnv),
    ).not.toThrow()
  })
})
