import { belongsToSite } from '../../shared/url'

/**
 * IndexNow 领域逻辑（规格 §3.7）。
 *
 * IndexNow 是 Bing/Yandex/Seznam 等引擎支持的主动通知协议。
 * Google 不支持 IndexNow——Google 侧依靠 sitemap 与自然抓取，
 * 因此本模块的说明必须准确，不得暗示「提交后 Google 立即收录」。
 */

export type IndexNowEvent = 'added' | 'updated' | 'deleted'

export class UrlNotOwnedBySite extends Error {
  readonly code = 'URL_NOT_OWNED'

  constructor(readonly urls: string[]) {
    super('提交的 URL 不属于该站点')
  }
}

export class EmptyUrlList extends Error {
  readonly code = 'EMPTY_URL_LIST'
  constructor() {
    super('URL 列表为空')
  }
}

/** 单次提交上限，超出需分批（IndexNow 协议限制 10000） */
export const MAX_URLS_PER_SUBMISSION = 10_000

/**
 * 校验并规范化待提交的 URL。
 *
 * 只接受属于本站点的 URL——否则可借平台向搜索引擎提交他人站点的 URL，
 * 这既是滥用也会连累平台的提交信誉（规格 §3.7）。
 */
export function prepareSubmission(params: {
  urls: string[]
  origin: string
}): { urls: string[]; batches: string[][] } {
  if (params.urls.length === 0) throw new EmptyUrlList()

  const foreign = params.urls.filter((u) => !belongsToSite(u, params.origin))
  if (foreign.length > 0) throw new UrlNotOwnedBySite(foreign)

  // 去重，避免同一 URL 重复消耗配额
  const unique = [...new Set(params.urls)]

  const batches: string[][] = []
  for (let i = 0; i < unique.length; i += MAX_URLS_PER_SUBMISSION) {
    batches.push(unique.slice(i, i + MAX_URLS_PER_SUBMISSION))
  }

  return { urls: unique, batches }
}

/** IndexNow 协议请求体 */
export function buildIndexNowPayload(params: {
  host: string
  key: string
  urls: string[]
}): Record<string, unknown> {
  return {
    host: params.host,
    key: params.key,
    keyLocation: `https://${params.host}/${params.key}.txt`,
    urlList: params.urls,
  }
}

/**
 * 支持 IndexNow 的搜索引擎端点。
 *
 * 提交到任一端点即会同步给其余参与方，因此只需一个端点。
 * Google 不在其列——这是协议现状，不是实现缺失。
 */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

export const INDEXNOW_PARTICIPANTS = ['Bing', 'Yandex', 'Seznam', 'Naver'] as const
