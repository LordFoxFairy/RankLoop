import {
  ContentAlreadyPublished,
  ContentArchived,
  ContentNotFound,
  ContentPathTaken,
  DomainError,
  InvalidContentPath,
  QuotaExceeded,
  SeoGateNotPassed,
  SiteNotFound,
} from '../domain/content'
import { ApiError } from '../shared/errors'

/**
 * 领域异常 → HTTP 状态码。
 *
 * 映射集中在接口层：领域层不认识 HTTP，因此同一套规则也能被
 * 队列消费者或 CLI 复用。新增领域异常时只需在此补一行。
 */

export function badRequest(issues: unknown): ApiError {
  return new ApiError(422, 'VALIDATION_FAILED', '请求参数校验失败', { issues })
}

export function mapDomainError(error: DomainError): ApiError {
  if (error instanceof SeoGateNotPassed) {
    return new ApiError(422, error.code, error.message, {
      blocking: error.blockingRules,
      score: error.score,
    })
  }

  if (error instanceof ContentPathTaken) {
    return new ApiError(409, error.code, error.message, {
      path: error.path,
      content_id: error.existingContentId,
    })
  }

  if (error instanceof QuotaExceeded) {
    return new ApiError(429, error.code, error.message, {
      quota: error.quota,
      limit: error.limit,
    })
  }

  // 跨租户访问统一 404：403 会确认资源存在，泄露其他工作区的 ID（规格 §2.2）
  if (error instanceof ContentNotFound || error instanceof SiteNotFound) {
    return new ApiError(404, 'NOT_FOUND', error.message, {})
  }

  if (error instanceof InvalidContentPath) {
    return new ApiError(422, error.code, error.message, { path: error.path })
  }

  if (error instanceof ContentAlreadyPublished || error instanceof ContentArchived) {
    return new ApiError(409, error.code, error.message, {})
  }

  // 兜底：未显式映射的领域异常按 422 处理，避免误报 500
  return new ApiError(422, error.code, error.message, {})
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError
}
