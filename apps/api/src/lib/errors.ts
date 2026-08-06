/**
 * 统一错误响应（规格 §7.3）。
 *
 * 所有对外错误都必须带稳定的 code，第三方据此做自动化处理，
 * 不能让他们去解析 message 文本。
 */

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const errors = {
  unauthorized: () => new ApiError(401, 'UNAUTHORIZED', '缺少或无效的凭据'),

  forbidden: (scope?: string) =>
    new ApiError(403, 'FORBIDDEN', '当前凭据无权执行该操作', scope ? { required_scope: scope } : {}),

  /**
   * 跨租户访问一律返回 404 而非 403。
   * 返回 403 等于确认「该资源存在但你无权访问」，会泄露其他工作区的资源 ID
   * （规格 §2.2、§13.2）。
   */
  notFound: (resource: string) =>
    new ApiError(404, 'NOT_FOUND', `${resource}不存在`, { resource }),

  validation: (details: Record<string, unknown>) =>
    new ApiError(422, 'VALIDATION_FAILED', '请求参数校验失败', details),

  gateFailed: (blocking: string[], score: number) =>
    new ApiError(422, 'SEO_GATE_FAILED', '内容存在严重 SEO 问题，无法发布', {
      blocking,
      score,
    }),

  quotaExceeded: (quota: string, limit: number) =>
    new ApiError(429, 'QUOTA_EXCEEDED', '已超出配额限制', { quota, limit }),

  conflict: (code: string, message: string, details: Record<string, unknown> = {}) =>
    new ApiError(409, code, message, details),
}
