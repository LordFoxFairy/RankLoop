import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import {
  type Clock,
  Content,
  ContentPath,
  type ContentRepository,
  ContentVersion,
  type IdGenerator,
  type QuotaRepository,
  SeoCheck,
  type SiteRepository,
} from '../domain/content'
import type { Issue, SkippedRule } from '@rankloop/seo-rules'

/**
 * 基础设施层：把领域聚合映射到 Prisma 模型。
 *
 * 映射逻辑集中在这里，领域层完全不认识 Prisma。
 * 所有查询强制带 workspaceId，跨租户访问返回 null（规格 §2.2）。
 */

type VersionRow = {
  id: string
  version: number
  body: string
  metadata: unknown
  createdAt: Date
  checks: Array<{
    score: number
    issues: unknown
    skippedRules: unknown
    rulesVersion: string
  }>
}

function toVersion(row: VersionRow | null | undefined): ContentVersion | null {
  if (!row) return null
  const check = row.checks[0]
  return new ContentVersion(
    row.id,
    row.version,
    row.body,
    check
      ? SeoCheck.restore({
          score: check.score,
          issues: (check.issues ?? []) as Issue[],
          skippedRules: (check.skippedRules ?? []) as SkippedRule[],
          rulesVersion: check.rulesVersion,
        })
      : SeoCheck.restore({ score: 0, issues: [], skippedRules: [], rulesVersion: 'unknown' }),
    (row.metadata ?? {}) as Record<string, unknown>,
    row.createdAt,
  )
}

const contentInclude = {
  currentVersion: { include: { checks: { take: 1, orderBy: { createdAt: 'desc' } } } },
} as const

export class PrismaContentRepository implements ContentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, workspaceId: string): Promise<Content | null> {
    const row = await this.prisma.content.findFirst({
      where: { id, site: { workspaceId } },
      include: contentInclude,
    })
    return row ? this.toDomain(row) : null
  }

  /** 跨租户查找：平台管理员需要查看任意租户的内容 */
  async findByIdAnyTenant(id: string): Promise<Content | null> {
    const row = await this.prisma.content.findUnique({ where: { id }, include: contentInclude })
    return row ? this.toDomain(row) : null
  }

  async findByPath(
    siteId: string,
    path: ContentPath,
    workspaceId: string,
  ): Promise<Content | null> {
    const row = await this.prisma.content.findFirst({
      where: { siteId, path: path.value, site: { workspaceId } },
      include: contentInclude,
    })
    return row ? this.toDomain(row) : null
  }

  async listBySite(params: {
    siteId: string
    workspaceId: string
    status?: string
    limit: number
    bypassTenantCheck?: boolean
  }): Promise<Array<{ content: Content; score: number | null }>> {
    const status = params.status as 'draft' | 'published' | 'archived' | undefined
    const rows = await this.prisma.content.findMany({
      where: {
        siteId: params.siteId,
        // 平台管理员跨租户查看时不加工作区过滤
        ...(params.bypassTenantCheck ? {} : { site: { workspaceId: params.workspaceId } }),
        ...(status ? { status } : {}),
      },
      include: contentInclude,
      orderBy: { updatedAt: 'desc' },
      take: params.limit,
    })
    return rows.map((row) => ({
      content: this.toDomain(row),
      score: row.currentVersion?.checks[0]?.score ?? null,
    }))
  }

  async countByWorkspace(workspaceId: string): Promise<number> {
    return this.prisma.content.count({ where: { site: { workspaceId } } })
  }

  async add(content: Content): Promise<void> {
    const version = content.pendingVersion
    if (!version) throw new Error('新建内容必须带首个版本')

    // 事务保证内容、版本、检测结果与 currentVersion 指针一致
    await this.prisma.$transaction(async (tx) => {
      await tx.content.create({
        data: {
          id: content.id,
          siteId: content.siteId,
          path: content.path.value,
          format: content.format,
          status: content.status,
        },
      })
      await this.writeVersion(tx, content.id, version)
      await tx.content.update({
        where: { id: content.id },
        data: { currentVersionId: version.id },
      })
    })
  }

  async save(content: Content): Promise<void> {
    const version = content.pendingVersion

    await this.prisma.$transaction(async (tx) => {
      if (version) await this.writeVersion(tx, content.id, version)
      await tx.content.update({
        where: { id: content.id },
        data: {
          status: content.status,
          format: content.format,
          publishedAt: content.publishedAt,
          ...(version ? { currentVersionId: version.id } : {}),
        },
      })
    })
  }

  async nextVersionNumber(contentId: string): Promise<number> {
    const latest = await this.prisma.contentVersion.findFirst({
      where: { contentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    return (latest?.version ?? 0) + 1
  }

  private async writeVersion(
    tx: Pick<PrismaClient, 'contentVersion'>,
    contentId: string,
    version: ContentVersion,
  ): Promise<void> {
    await tx.contentVersion.create({
      data: {
        id: version.id,
        contentId,
        version: version.version,
        body: version.body,
        metadata: version.metadata as object,
        checks: {
          create: {
            score: version.check.score,
            criticalCount: version.check.counts.critical,
            warningCount: version.check.counts.warning,
            noticeCount: version.check.counts.notice,
            issues: version.check.issues as unknown as object,
            skippedRules: version.check.skippedRules as unknown as object,
            rulesVersion: version.check.rulesVersion,
          },
        },
      },
    })
  }

  private toDomain(row: {
    id: string
    siteId: string
    path: string
    format: string
    status: string
    publishedAt: Date | null
    currentVersion: VersionRow | null
  }): Content {
    return Content.restore({
      id: row.id,
      siteId: row.siteId,
      path: ContentPath.restore(row.path),
      format: row.format as 'html' | 'markdown',
      status: row.status as 'draft' | 'published' | 'archived',
      currentVersion: toVersion(row.currentVersion),
      publishedAt: row.publishedAt,
    })
  }
}

export class PrismaSiteRepository implements SiteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(siteId: string, workspaceId: string) {
    return this.prisma.site.findFirst({
      where: { id: siteId, workspaceId, archivedAt: null },
      select: { id: true, origin: true },
    })
  }
}

export class PrismaQuotaRepository implements QuotaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByWorkspace(workspaceId: string) {
    return this.prisma.workspaceQuota.findUnique({
      where: { workspaceId },
      select: { maxContents: true },
    })
  }
}

export const uuidGenerator: IdGenerator = { next: () => randomUUID() }
export const systemClock: Clock = { now: () => new Date() }
