import type { PrismaClient } from '@prisma/client'
import type { IndexNotifier } from '../application/content-service'

/**
 * 发布后自动排队 IndexNow 提交。
 *
 * 闭环的关键一环：客户 push 内容 → 通过门槛 → 发布 → **自动通知搜索引擎**。
 * 此前最后一步要客户再调一次 /indexnow/submit，实际上没人会调，
 * 于是内容虽然上线了，搜索引擎却要等自然抓取才发现。
 *
 * 注意 Google 不支持 IndexNow——Google 侧靠 sitemap 与自然抓取。
 * 这里能加速的是 Bing/Yandex/Seznam/Naver。
 */
export function createIndexNotifier(prisma: PrismaClient): IndexNotifier {
  return {
    async contentPublished({ siteId, url }) {
      // 未配置 key 的站点不排队：排了也投不出去，只会堆积失败记录
      const key = await prisma.indexNowKey.findUnique({ where: { siteId } })
      if (!key) return

      // 用 url + 日期做幂等键：同一内容当天反复发布只提交一次，
      // 避免频繁提交被搜索引擎判为滥用
      const idempotencyKey = `auto:${url}:${new Date().toISOString().slice(0, 10)}`

      await prisma.indexNowSubmission.upsert({
        where: { siteId_idempotencyKey: { siteId, idempotencyKey } },
        // 已存在说明当天已提交过，不重复排队
        update: {},
        create: {
          siteId,
          urls: [url],
          event: 'updated',
          status: 'queued',
          idempotencyKey,
        },
      })
    },
  }
}
