import { normalizePath } from '../../shared/url'
import { InvalidContentPath } from './errors'

/**
 * 内容路径值对象。
 *
 * 用值对象而非裸字符串，是为了让「已规范化」由类型保证：
 * 拿到 ContentPath 的代码不必再怀疑它是否含路径穿越。
 */
export class ContentPath {
  private constructor(readonly value: string) {
    Object.freeze(this)
  }

  static create(raw: string): ContentPath {
    try {
      return new ContentPath(normalizePath(raw))
    } catch (e) {
      throw new InvalidContentPath(raw, (e as Error).message)
    }
  }

  /** 从已规范化的存储值重建，跳过校验 */
  static restore(normalized: string): ContentPath {
    return new ContentPath(normalized)
  }

  equals(other: ContentPath): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

export type ContentFormat = 'html' | 'markdown'
export type ContentStatus = 'draft' | 'published' | 'archived'
