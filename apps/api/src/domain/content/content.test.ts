import { describe, expect, it } from 'vitest'
import { Content, ContentVersion } from './content'
import { ContentAlreadyPublished, ContentArchived, SeoGateNotPassed } from './errors'
import { SeoCheck } from './seo-check'
import { ContentPath } from './values'

const NOW = new Date('2026-08-06T00:00:00Z')

function check(overrides: { score?: number; critical?: number } = {}): SeoCheck {
  const critical = overrides.critical ?? 0
  return SeoCheck.restore({
    score: overrides.score ?? (critical > 0 ? 20 : 95),
    issues: Array.from({ length: critical }, (_, i) => ({
      code: `CRIT_${i}`,
      severity: 'critical' as const,
      message: 'x',
      evidence: 'x',
      recommendation: 'x',
    })),
    skippedRules: [],
    rulesVersion: '1.0.0',
  })
}

function version(seoCheck: SeoCheck, n = 1): ContentVersion {
  return new ContentVersion(`v_${n}`, n, 'body', seoCheck, {}, NOW)
}

function draft(seoCheck = check()): Content {
  return Content.create({
    id: 'c_1',
    siteId: 's_1',
    path: ContentPath.create('/article'),
    format: 'markdown',
    version: version(seoCheck),
  })
}

describe('Content 聚合根 — 创建', () => {
  it('新建内容处于 draft 状态', () => {
    expect(draft().status).toBe('draft')
    expect(draft().publishedAt).toBeNull()
  })

  it('路径经过规范化', () => {
    const c = Content.create({
      id: 'c_1',
      siteId: 's_1',
      path: ContentPath.create('/Article/'),
      format: 'html',
      version: version(check()),
    })
    expect(c.path.value).toBe('/article')
  })

  it('新建时首个版本待持久化', () => {
    expect(draft().pendingVersion?.version).toBe(1)
  })
})

describe('Content 聚合根 — 发布门槛', () => {
  // 全系统最重要的不变式：无论调用方是谁，都不能带 critical 问题发布。
  it('无 critical 问题时可发布', () => {
    const c = draft()
    c.publish(check({ critical: 0 }), NOW)
    expect(c.status).toBe('published')
    expect(c.publishedAt).toEqual(NOW)
  })

  it('存在 critical 问题时拒绝发布', () => {
    expect(() => draft().publish(check({ critical: 2 }), NOW)).toThrow(SeoGateNotPassed)
  })

  it('拒绝发布时状态不变——失败不留半改状态', () => {
    const c = draft()
    try {
      c.publish(check({ critical: 1 }), NOW)
    } catch {
      /* 预期抛错 */
    }
    expect(c.status).toBe('draft')
    expect(c.publishedAt).toBeNull()
  })

  it('异常携带阻塞规则与分数，供接口层回传第三方', () => {
    try {
      draft().publish(check({ critical: 2, score: 13 }), NOW)
      expect.unreachable('应当抛出 SeoGateNotPassed')
    } catch (e) {
      const err = e as SeoGateNotPassed
      expect(err.blockingRules).toEqual(['CRIT_0', 'CRIT_1'])
      expect(err.score).toBe(13)
    }
  })

  it('以传入的检测结果为准，而非历史结果', () => {
    // 规则收紧后，旧内容不能靠陈旧结论绕过门槛
    const c = draft(check({ critical: 0 }))
    expect(() => c.publish(check({ critical: 1 }), NOW)).toThrow(SeoGateNotPassed)
  })

  it('内容没有变化时重复发布被拒绝', () => {
    const c = draft()
    c.publish(check(), NOW)
    expect(() => c.publish(check(), NOW)).toThrow(ContentAlreadyPublished)
  })

  it('修订后可以再次发布——修复版本必须能上线', () => {
    // 闭环的关键一步：客户按建议修好问题后，新版本要能替换线上的旧版本。
    // 若拒绝，线上会永远停在有缺陷的那一版，「检测→修复→发布」断在最后。
    const c = draft(check({ critical: 1 }))
    expect(() => c.publish(check({ critical: 1 }), NOW)).toThrow(SeoGateNotPassed)

    c.revise(version(check({ critical: 0 }), 2), 'html')
    expect(() => c.publish(check({ critical: 0 }), NOW)).not.toThrow()
    expect(c.status).toBe('published')
  })

  it('再次发布仍受门槛约束——修订不能成为绕过检测的通道', () => {
    const c = draft()
    c.publish(check(), NOW)
    c.revise(version(check({ critical: 2 }), 2), 'html')
    expect(() => c.publish(check({ critical: 2 }), NOW)).toThrow(SeoGateNotPassed)
  })

  it('发布后 pendingVersion 清空，避免无变化时被误判为可重发', () => {
    const c = draft()
    c.revise(version(check(), 2), 'html')
    c.publish(check(), NOW)
    expect(c.pendingVersion).toBeNull()
    expect(() => c.publish(check(), NOW)).toThrow(ContentAlreadyPublished)
  })
})

describe('Content 聚合根 — 修订', () => {
  it('更新版本后当前版本随之改变', () => {
    const c = draft()
    c.revise(version(check({ score: 90 }), 2), 'markdown')
    expect(c.currentVersion?.version).toBe(2)
    expect(c.pendingVersion?.version).toBe(2)
  })

  it('已发布内容仍可修订', () => {
    const c = draft()
    c.publish(check(), NOW)
    expect(() => c.revise(version(check(), 2), 'html')).not.toThrow()
    expect(c.status).toBe('published')
  })

  it('修订可切换格式', () => {
    const c = draft()
    c.revise(version(check(), 2), 'html')
    expect(c.format).toBe('html')
  })

  it('publishable 反映当前版本是否达标', () => {
    const c = draft(check({ critical: 1 }))
    expect(c.publishable).toBe(false)
    c.revise(version(check({ critical: 0 }), 2), 'markdown')
    expect(c.publishable).toBe(true)
  })
})

describe('Content 聚合根 — 归档', () => {
  it('归档后不可修订', () => {
    const c = draft()
    c.archive()
    expect(() => c.revise(version(check(), 2), 'html')).toThrow(ContentArchived)
  })

  it('归档后不可发布', () => {
    const c = draft()
    c.archive()
    expect(() => c.publish(check(), NOW)).toThrow(ContentArchived)
  })
})

describe('SeoCheck 值对象', () => {
  it('不可变', () => {
    expect(Object.isFrozen(check())).toBe(true)
  })

  it('按 critical 数量判定是否过门槛', () => {
    expect(check({ critical: 0 }).passesGate).toBe(true)
    expect(check({ critical: 1 }).passesGate).toBe(false)
  })

  it('统计各级别数量', () => {
    expect(check({ critical: 3 }).counts.critical).toBe(3)
  })

  it('按值相等', () => {
    expect(check({ score: 90 }).equals(check({ score: 90 }))).toBe(true)
    expect(check({ score: 90 }).equals(check({ score: 80 }))).toBe(false)
  })
})

describe('ContentPath 值对象', () => {
  it('规范化后按值相等', () => {
    expect(ContentPath.create('/A/').equals(ContentPath.create('/a'))).toBe(true)
  })

  it('阻断路径穿越', () => {
    expect(() => ContentPath.create('/../etc')).toThrow()
  })

  it('不可变', () => {
    expect(Object.isFrozen(ContentPath.create('/a'))).toBe(true)
  })
})
