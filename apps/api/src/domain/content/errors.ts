/**
 * 领域异常。
 *
 * 领域层不认识 HTTP，因此这里不出现状态码——由接口层的 error-mapper 负责映射。
 * 这样同一套业务规则可以被 HTTP 路由、队列消费者、CLI 复用。
 */

export abstract class DomainError extends Error {
  abstract readonly code: string

  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class InvalidContentPath extends DomainError {
  readonly code = 'INVALID_CONTENT_PATH'

  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`内容路径非法：${reason}`)
  }
}

/** 发布门槛未通过（ADR-001 §4） */
export class SeoGateNotPassed extends DomainError {
  readonly code = 'SEO_GATE_FAILED'

  constructor(
    readonly blockingRules: readonly string[],
    readonly score: number,
  ) {
    super('内容存在严重 SEO 问题，无法发布')
  }
}

export class ContentAlreadyPublished extends DomainError {
  readonly code = 'CONTENT_ALREADY_PUBLISHED'
  constructor() {
    super('内容已处于发布状态')
  }
}

export class ContentArchived extends DomainError {
  readonly code = 'CONTENT_ARCHIVED'
  constructor() {
    super('已归档的内容不可再修改或发布')
  }
}

export class ContentPathTaken extends DomainError {
  readonly code = 'CONTENT_EXISTS'

  constructor(
    readonly path: string,
    readonly existingContentId: string,
  ) {
    super('该路径已存在内容')
  }
}

export class QuotaExceeded extends DomainError {
  readonly code = 'QUOTA_EXCEEDED'

  constructor(
    readonly quota: string,
    readonly limit: number,
  ) {
    super('已超出配额限制')
  }
}

export class ContentNotFound extends DomainError {
  readonly code = 'CONTENT_NOT_FOUND'
  constructor() {
    super('内容不存在')
  }
}

export class SiteNotFound extends DomainError {
  readonly code = 'SITE_NOT_FOUND'
  constructor() {
    super('站点不存在')
  }
}
