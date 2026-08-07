/**
 * 初始化平台管理员。
 *
 * 客户不自助注册——由管理员登录后台创建租户并分配 API Key，
 * 客户拿到 Key 后直接调接口推内容，无需登录任何界面。
 *
 * 幂等：管理员已存在时只更新密码，不重复创建。
 */
import argon2 from 'argon2'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const email = (process.env.INITIAL_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase()
const password = process.env.INITIAL_ADMIN_PASSWORD

if (!password) {
  console.error('缺少 INITIAL_ADMIN_PASSWORD 环境变量')
  process.exit(1)
}
if (password.length < 10) {
  console.error('INITIAL_ADMIN_PASSWORD 至少 10 个字符')
  process.exit(1)
}

const passwordHash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
})

const user = await prisma.user.upsert({
  where: { email },
  update: { passwordHash, isPlatformAdmin: true, disabledAt: null },
  create: { email, passwordHash, isPlatformAdmin: true, displayName: '平台管理员' },
})

console.log(`\n✓ 平台管理员已就绪：${user.email}`)
console.log('  登录后台创建租户并分配 API Key\n')

await prisma.$disconnect()
