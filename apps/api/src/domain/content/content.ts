import { ContentAlreadyPublished, ContentArchived, SeoGateNotPassed } from './errors'
import type { SeoCheck } from './seo-check'
import type { ContentFormat, ContentPath, ContentStatus } from './values'

/**
 * 内容版本实体。
 *
 * 一经创建即不可变——它记录「第 N 次提交的正文与当时的检测结果」，
 * 修改历史版本会让审计与回溯失去意义。
 */
export class ContentVersion {
  constructor(
    readonly id: string,
    readonly version: number,
    readonly body: string,
    readonly check: SeoCheck,
    readonly metadata: Record<string, unknown>,
    readonly createdAt: Date,
  ) {
    Object.freeze(this)
  }
}

export interface ContentSnapshot {
  id: string
  siteId: string
  path: ContentPath
  format: ContentFormat
  status: ContentStatus
  currentVersion: ContentVersion | null
  /** 线上实际生效的版本号；与 currentVersion 不同说明有修订待发布 */
  publishedVersionNumber: number | null
  publishedAt: Date | null
}

/**
 * 内容聚合根。
 *
 * 一致性边界：内容及其版本、当前生效版本。
 * 所有状态变更必须经由此处的方法——这样「critical 问题不得发布」
 * 等不变式无法被绕过，无论调用方是 HTTP 路由、队列消费者还是脚本。
 */
export class Content {
  private constructor(
    readonly id: string,
    readonly siteId: string,
    readonly path: ContentPath,
    private _format: ContentFormat,
    private _status: ContentStatus,
    private _currentVersion: ContentVersion | null,
    private _publishedAt: Date | null,
    private _publishedVersionNumber: number | null = null,
    private _pendingVersion: ContentVersion | null = null,
  ) {}

  static create(params: {
    id: string
    siteId: string
    path: ContentPath
    format: ContentFormat
    version: ContentVersion
  }): Content {
    return new Content(
      params.id,
      params.siteId,
      params.path,
      params.format,
      'draft',
      params.version,
      null,
      // 新建内容尚未发布，线上版本为空；pendingVersion 记录待持久化的首个版本
      null,
      params.version,
    )
  }

  static restore(snapshot: ContentSnapshot): Content {
    return new Content(
      snapshot.id,
      snapshot.siteId,
      snapshot.path,
      snapshot.format,
      snapshot.status,
      snapshot.currentVersion,
      snapshot.publishedAt,
      snapshot.publishedVersionNumber,
    )
  }

  get format(): ContentFormat {
    return this._format
  }

  get status(): ContentStatus {
    return this._status
  }

  get currentVersion(): ContentVersion | null {
    return this._currentVersion
  }

  /** 线上生效的版本号；与 currentVersion 不同表示有修订尚未发布 */
  get publishedVersionNumber(): number | null {
    return this._publishedVersionNumber
  }

  get publishedAt(): Date | null {
    return this._publishedAt
  }

  /** 本次操作新产生、待持久化的版本 */
  get pendingVersion(): ContentVersion | null {
    return this._pendingVersion
  }

  get isPublished(): boolean {
    return this._status === 'published'
  }

  /** 当前版本是否达标，供接口层提前告知调用方 */
  get publishable(): boolean {
    return this._currentVersion?.check.passesGate ?? false
  }

  /**
   * 提交新版本。
   *
   * 已发布内容仍可修订——第三方修订上线内容是正常场景；归档内容不可改。
   */
  revise(version: ContentVersion, format: ContentFormat): void {
    this.assertNotArchived()
    this._currentVersion = version
    this._pendingVersion = version
    this._format = format
  }

  /**
   * 发布。
   *
   * 不变式：存在 critical 问题时拒绝（ADR-001 §4）。
   * 以传入的检测结果为准而非历史结果——规则版本可能已更新，
   * 用陈旧结论放行等于绕过门槛。
   *
   * 已发布内容修订后可以再次发布：客户按建议修好问题，
   * 修复版本必须能上线，否则线上永远停留在有缺陷的旧版本——
   * 那会让「检测→修复→发布」的闭环断在最后一步。
   * 只有内容确实没有变化时才拒绝，避免无意义的重复操作。
   */
  publish(check: SeoCheck, now: Date): void {
    this.assertNotArchived()
    // 用版本号比对而非内存标记：聚合从数据库恢复时 pendingVersion 必为 null，
    // 依赖它会让所有再次发布都被误判为「重复发布」。
    const current = this._currentVersion?.version ?? null
    if (this._status === 'published' && current === this._publishedVersionNumber) {
      throw new ContentAlreadyPublished()
    }
    if (!check.passesGate) throw new SeoGateNotPassed(check.blockingRules, check.score)
    this._status = 'published'
    this._publishedAt = now
    this._publishedVersionNumber = current
    this._pendingVersion = null
  }

  archive(): void {
    this._status = 'archived'
  }

  private assertNotArchived(): void {
    if (this._status === 'archived') throw new ContentArchived()
  }
}
