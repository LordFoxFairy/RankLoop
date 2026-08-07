import { describe, expect, it, vi } from 'vitest'
import { verifyPassword } from '../shared/password'
import { bootstrapAdmin } from './bootstrap-admin'

/**
 * 初始管理员创建。
 *
 * 重点是幂等与安全：重启不能覆盖已有账号（否则等于给环境变量持有者一个后门），
 * 弱密码宁可不建也不能建（弱密码的管理员比没有管理员更危险）。
 */

function fakePrisma(existingAdmin: { email: string } | null) {
  const create = vi.fn().mockResolvedValue({})
  return {
    prisma: { user: { findFirst: vi.fn().mockResolvedValue(existingAdmin), create } } as never,
    create,
  }
}

const STRONG = 'Str0ng-Admin-Passw0rd!'

describe('初始管理员创建', () => {
  it('全新部署时创建管理员', async () => {
    const { prisma, create } = fakePrisma(null)
    const r = await bootstrapAdmin(prisma, { email: 'admin@acme.com', password: STRONG })

    expect(r.created).toBe(true)
    expect(create.mock.calls[0][0].data.isPlatformAdmin).toBe(true)
  })

  it('密码经过哈希，绝不明文入库', async () => {
    const { prisma, create } = fakePrisma(null)
    await bootstrapAdmin(prisma, { email: 'admin@acme.com', password: STRONG })

    const hash = create.mock.calls[0][0].data.passwordHash
    expect(hash).not.toContain(STRONG)
    expect(await verifyPassword(hash, STRONG)).toBe(true)
  })

  it('邮箱统一转小写——登录时不区分大小写，入库不一致会导致登不进去', async () => {
    const { prisma, create } = fakePrisma(null)
    await bootstrapAdmin(prisma, { email: '  Admin@ACME.com  ', password: STRONG })

    expect(create.mock.calls[0][0].data.email).toBe('admin@acme.com')
  })

  it('已存在管理员时不再创建——否则重启就能用环境变量重置权限', async () => {
    const { prisma, create } = fakePrisma({ email: 'old@acme.com' })
    const r = await bootstrapAdmin(prisma, { email: 'new@acme.com', password: STRONG })

    expect(r.created).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('弱密码拒绝创建——弱密码的管理员比没有管理员更危险', async () => {
    const { prisma, create } = fakePrisma(null)
    const r = await bootstrapAdmin(prisma, { email: 'admin@acme.com', password: '123456' })

    expect(r.created).toBe(false)
    expect(r.reason).toContain('不合要求')
    expect(create).not.toHaveBeenCalled()
  })

  it('未配置环境变量时静默跳过——本地开发不该被强制要求', async () => {
    const { prisma, create } = fakePrisma(null)
    const r = await bootstrapAdmin(prisma, {})

    expect(r.created).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('只配了邮箱没配密码时不创建', async () => {
    const { prisma, create } = fakePrisma(null)
    const r = await bootstrapAdmin(prisma, { email: 'admin@acme.com' })

    expect(r.created).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
})
