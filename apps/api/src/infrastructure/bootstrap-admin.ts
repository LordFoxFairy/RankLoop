import type { PrismaClient } from '@prisma/client'
import { hashPassword, validatePasswordStrength } from '../shared/password'

/**
 * 首次启动创建平台管理员。
 *
 * 平台不开放自助注册——账号由管理员创建，租户凭签发的 API Key 调用。
 * 但这带来一个先有鸡还是先有蛋的问题：第一个管理员从哪来？
 * 此前 compose.yaml 与 render.yaml 都传了 INITIAL_ADMIN_*，
 * 却没有任何代码读它，部署后没人能登录，也就无法创建租户、分配密钥。
 *
 * 幂等：已存在同邮箱用户时不改动（绝不覆盖已有密码），
 * 因此重启、重新部署都安全。
 */
export interface BootstrapResult {
  created: boolean
  email?: string
  reason?: string
}

export async function bootstrapAdmin(
  prisma: PrismaClient,
  env: { email?: string; password?: string },
): Promise<BootstrapResult> {
  const email = env.email?.trim().toLowerCase()
  const password = env.password

  if (!email || !password) {
    return { created: false, reason: '未配置 INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD' }
  }

  // 已有任意管理员就不再创建：平台已完成初始化，
  // 此时再建账号等于给了环境变量持有者一个后门
  const existingAdmin = await prisma.user.findFirst({
    where: { isPlatformAdmin: true },
    select: { email: true },
  })
  if (existingAdmin) {
    return { created: false, reason: '平台管理员已存在', email: existingAdmin.email }
  }

  const strength = validatePasswordStrength(password)
  if (!strength.ok) {
    // 弱密码的管理员比没有管理员更危险，宁可不建并明确报错
    return { created: false, reason: `初始管理员密码不合要求：${strength.reason}` }
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      isPlatformAdmin: true,
      displayName: '平台管理员',
    },
  })

  return { created: true, email }
}
