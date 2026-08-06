import {
  type Clock,
  Content,
  type ContentChecker,
  ContentNotFound,
  type ContentPath,
  ContentPathTaken,
  type ContentRepository,
  ContentVersion,
  type IdGenerator,
  type QuotaRepository,
  QuotaExceeded,
  type SiteRepository,
  SiteNotFound,
} from '../domain/content'
import { ContentPath as Path, type ContentFormat } from '../domain/content'
import { contentUrl } from '../shared/url'

/**
 * 应用层：编排用例，划定事务边界。
 *
 * 这里不包含业务规则——规则住在聚合根里。应用层只负责：
 * 取出聚合 → 调用领域方法 → 持久化。
 * 因此更换 HTTP 框架、或从队列里触发同一用例，都不影响业务语义。
 */

export interface ContentServiceDeps {
  contents: ContentRepository
  sites: SiteRepository
  quotas: QuotaRepository
  checker: ContentChecker
  ids: IdGenerator
  clock: Clock
}

export interface SubmitInput {
  siteId: string
  workspaceId: string
  path: string
  format: ContentFormat
  body: string
}

export interface ReviseInput {
  contentId: string
  workspaceId: string
  format?: ContentFormat
  body: string
}

export class ContentService {
  constructor(private readonly deps: ContentServiceDeps) {}

  async submit(input: SubmitInput): Promise<Content> {
    const site = await this.requireSite(input.siteId, input.workspaceId)
    const path = Path.create(input.path)

    const existing = await this.deps.contents.findByPath(site.id, path, input.workspaceId)
    if (existing) throw new ContentPathTaken(path.value, existing.id)

    await this.assertQuota(input.workspaceId)

    const result = this.deps.checker.check({
      format: input.format,
      body: input.body,
      url: contentUrl(site.origin, path.value),
    })

    const content = Content.create({
      id: this.deps.ids.next(),
      siteId: site.id,
      path,
      format: input.format,
      version: new ContentVersion(
        this.deps.ids.next(),
        1,
        input.body,
        result.check,
        result.metadata,
        this.deps.clock.now(),
      ),
    })

    await this.deps.contents.add(content)
    return content
  }

  async revise(input: ReviseInput): Promise<Content> {
    const content = await this.requireContent(input.contentId, input.workspaceId)
    const site = await this.requireSite(content.siteId, input.workspaceId)
    const format = input.format ?? content.format

    const result = this.deps.checker.check({
      format,
      body: input.body,
      url: contentUrl(site.origin, content.path.value),
    })

    const next = await this.deps.contents.nextVersionNumber(content.id)
    content.revise(
      new ContentVersion(
        this.deps.ids.next(),
        next,
        input.body,
        result.check,
        result.metadata,
        this.deps.clock.now(),
      ),
      format,
    )

    await this.deps.contents.save(content)
    return content
  }

  /**
   * 发布。
   *
   * 以当前版本重新检测后交给聚合根判定——门槛规则在领域层，
   * 这里不做任何 if 判断，避免规则出现第二处实现。
   */
  async publish(contentId: string, workspaceId: string): Promise<Content> {
    const content = await this.requireContent(contentId, workspaceId)
    const site = await this.requireSite(content.siteId, workspaceId)
    const version = content.currentVersion
    if (!version) throw new ContentNotFound()

    const result = this.deps.checker.check({
      format: content.format,
      body: version.body,
      url: contentUrl(site.origin, content.path.value),
    })

    content.publish(result.check, this.deps.clock.now())
    await this.deps.contents.save(content)
    return content
  }

  async get(contentId: string, workspaceId: string): Promise<Content> {
    return this.requireContent(contentId, workspaceId)
  }

  async list(params: { siteId: string; workspaceId: string; status?: string; limit: number }) {
    await this.requireSite(params.siteId, params.workspaceId)
    return this.deps.contents.listBySite(params)
  }

  /** 无状态预检：不落库，供第三方发布前反复试算 */
  check(params: { format: ContentFormat; body: string; url: string }) {
    return this.deps.checker.check(params)
  }

  private async requireSite(siteId: string, workspaceId: string) {
    const site = await this.deps.sites.findById(siteId, workspaceId)
    if (!site) throw new SiteNotFound()
    return site
  }

  private async requireContent(contentId: string, workspaceId: string): Promise<Content> {
    const content = await this.deps.contents.findById(contentId, workspaceId)
    if (!content) throw new ContentNotFound()
    return content
  }

  private async assertQuota(workspaceId: string): Promise<void> {
    const quota = await this.deps.quotas.findByWorkspace(workspaceId)
    if (!quota) return
    const count = await this.deps.contents.countByWorkspace(workspaceId)
    if (count >= quota.maxContents) throw new QuotaExceeded('max_contents', quota.maxContents)
  }
}

export type { ContentPath }
