import type { Content } from './content'
import type { SeoCheck } from './seo-check'
import type { ContentFormat, ContentPath } from './values'

/**
 * 仓储与服务端口。
 *
 * 接口定义在领域层、实现放在基础设施层（依赖倒置）：
 * 领域层不认识 Prisma，因此可以脱离数据库测试，
 * 更换持久化方案也不会波及业务规则。
 *
 * 所有查询强制带 workspaceId——多租户隔离是领域约束，
 * 不能指望每个调用点自觉加过滤条件（规格 §2.2）。
 */
export interface ContentRepository {
  findById(id: string, workspaceId: string): Promise<Content | null>
  /** 跨租户查找，仅供平台管理员使用；普通路径必须走 findById */
  findByIdAnyTenant(id: string): Promise<Content | null>
  findByPath(siteId: string, path: ContentPath, workspaceId: string): Promise<Content | null>
  listBySite(params: {
    siteId: string
    workspaceId: string
    status?: string
    limit: number
    /** 平台管理员跨租户查看 */
    bypassTenantCheck?: boolean
  }): Promise<Array<{ content: Content; score: number | null }>>
  countByWorkspace(workspaceId: string): Promise<number>
  /** 保存新建聚合及其首个版本 */
  add(content: Content): Promise<void>
  /** 保存聚合状态变更，含 pendingVersion（若有） */
  save(content: Content): Promise<void>
  nextVersionNumber(contentId: string): Promise<number>
}

export interface SiteRepository {
  /** 按工作区查找，跨租户访问返回 null 而非抛错 */
  findById(siteId: string, workspaceId: string): Promise<{ id: string; origin: string } | null>
}

export interface QuotaRepository {
  findByWorkspace(workspaceId: string): Promise<{ maxContents: number } | null>
}

/**
 * 内容检测端口。
 *
 * 领域层只声明「需要一个能检测内容的东西」，
 * 解析 HTML/Markdown、跑规则引擎的细节在基础设施层。
 */
export interface ContentChecker {
  check(params: { format: ContentFormat; body: string; url: string }): {
    check: SeoCheck
    metadata: Record<string, unknown>
  }
}

export interface IdGenerator {
  next(): string
}

export interface Clock {
  now(): Date
}
