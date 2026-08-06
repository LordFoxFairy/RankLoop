/**
 * 初始化管理员、工作区、站点与 API Key。
 *
 * 明文 API Key 只在本次输出中出现一次，不入库（规格 §6）。
 * 幂等：重复执行不会重建已存在的工作区与站点。
 */
import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SLUG = process.env.SEED_WORKSPACE_SLUG ?? 'default'
const ORIGIN = process.env.SEED_SITE_ORIGIN ?? 'https://example.com'

function generateKey() {
  const plaintext = `rkl_live_${randomBytes(24).toString('base64url')}`
  return {
    plaintext,
    hash: createHash('sha256').update(plaintext).digest('hex'),
    prefix: plaintext.slice(0, 15),
  }
}

const workspace = await prisma.workspace.upsert({
  where: { slug: SLUG },
  update: {},
  create: {
    slug: SLUG,
    name: 'Default Workspace',
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

const site = await prisma.site.upsert({
  where: { workspaceId_origin: { workspaceId: workspace.id, origin: ORIGIN } },
  update: {},
  create: { workspaceId: workspace.id, name: 'Default Site', origin: ORIGIN },
})

const key = generateKey()
await prisma.apiKey.create({
  data: {
    workspaceId: workspace.id,
    name: 'seed key',
    keyHash: key.hash,
    keyPrefix: key.prefix,
    scopes: [
      'sites:read',
      'sites:write',
      'contents:read',
      'contents:write',
      'contents:publish',
      'issues:read',
      'indexing:read',
      'indexing:write',
      'webhooks:write',
    ],
  },
})

console.log(JSON.stringify({ workspace_id: workspace.id, site_id: site.id, api_key: key.plaintext }, null, 2))
console.log('\n请立即保存上面的 api_key，它不会再次显示。')

await prisma.$disconnect()
