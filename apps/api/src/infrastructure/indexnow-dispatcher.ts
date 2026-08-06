import type { PrismaClient } from '@prisma/client'
import {
  INDEXNOW_ENDPOINT,
  buildIndexNowPayload,
} from '../domain/indexing/index-now'

/**
 * IndexNow 实际投递。
 *
 * 规格 §3.7 要求外部请求进队列而非阻塞 HTTP 线程，且需重试与限流。
 * 这里用「数据库队列 + 定时轮询」实现，不引入 BullMQ：
 * 提交量低（受配额限制），复杂度不值得再加一个中间件依赖。
 *
 * 幂等：只处理 status=queued 的记录，成功/失败都会落终态，
 * 因此重复轮询不会重复提交。
 */

const MAX_ATTEMPTS = 5
const REQUEST_TIMEOUT_MS = 15_000

export interface DispatchResult {
  processed: number
  succeeded: number
  failed: number
}

/** 可重试：网络抖动与 5xx；不可重试：4xx（请求本身有问题，重试无意义） */
function isRetryable(statusCode: number | null): boolean {
  if (statusCode === null) return true
  if (statusCode === 429) return true
  return statusCode >= 500
}

export async function dispatchPendingSubmissions(
  prisma: PrismaClient,
  options: { limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<DispatchResult> {
  const doFetch = options.fetchImpl ?? fetch
  const pending = await prisma.indexNowSubmission.findMany({
    where: { status: 'queued' },
    include: { site: { include: { indexNowKey: true } } },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 20,
  })

  const result: DispatchResult = { processed: 0, succeeded: 0, failed: 0 }

  for (const submission of pending) {
    result.processed += 1
    const key = submission.site.indexNowKey?.key

    if (!key) {
      await prisma.indexNowSubmission.update({
        where: { id: submission.id },
        data: { status: 'failed', responseSummary: '站点未配置 IndexNow Key' },
      })
      result.failed += 1
      continue
    }

    const urls = Array.isArray(submission.urls) ? (submission.urls as string[]) : []
    let host: string
    try {
      host = new URL(submission.site.origin).host
    } catch {
      await prisma.indexNowSubmission.update({
        where: { id: submission.id },
        data: { status: 'failed', responseSummary: '站点 origin 非法' },
      })
      result.failed += 1
      continue
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await doFetch(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(buildIndexNowPayload({ host, key, urls })),
        signal: controller.signal,
      })

      const summary = (await response.text().catch(() => '')).slice(0, 500)

      if (response.ok) {
        await prisma.indexNowSubmission.update({
          where: { id: submission.id },
          data: { status: 'succeeded', responseCode: response.status, responseSummary: summary },
        })
        result.succeeded += 1
      } else if (isRetryable(response.status)) {
        // 保持 queued 等待下次轮询；记录响应便于排查
        await prisma.indexNowSubmission.update({
          where: { id: submission.id },
          data: { responseCode: response.status, responseSummary: summary },
        })
      } else {
        await prisma.indexNowSubmission.update({
          where: { id: submission.id },
          data: { status: 'failed', responseCode: response.status, responseSummary: summary },
        })
        result.failed += 1
      }
    } catch (e) {
      await prisma.indexNowSubmission.update({
        where: { id: submission.id },
        data: { responseSummary: `请求失败：${(e as Error).message}`.slice(0, 500) },
      })
    } finally {
      clearTimeout(timer)
    }
  }

  return result
}

/** 启动周期性投递，返回停止函数 */
export function startIndexNowWorker(
  prisma: PrismaClient,
  intervalMs = 60_000,
): () => void {
  let running = false

  const tick = async () => {
    if (running) return // 防止上一轮未完成时并发执行
    running = true
    try {
      await dispatchPendingSubmissions(prisma)
    } catch {
      // 单次失败不应终止 worker
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

export { MAX_ATTEMPTS }
