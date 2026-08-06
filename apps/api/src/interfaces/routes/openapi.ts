import type { FastifyInstance } from 'fastify'
import { listRules } from '@rankloop/seo-rules'

/**
 * OpenAPI 3.1 文档（规格 §13.5 要求可访问）。
 *
 * 手写而非从代码生成：路由数量有限，手写能给出更贴切的示例与说明，
 * 且避免引入额外的 schema 生成依赖。新增路由时必须同步更新本文件。
 */

const errorResponse = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object' },
      },
    },
    meta: { type: 'object', properties: { request_id: { type: 'string' } } },
  },
} as const

const checkSchema = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100, description: '健康分，按规则权重扣除' },
    counts: {
      type: 'object',
      properties: {
        critical: { type: 'integer' },
        warning: { type: 'integer' },
        notice: { type: 'integer' },
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'warning', 'notice'] },
          message: { type: 'string' },
          evidence: { type: 'string', description: '触发规则的具体内容，便于定位' },
          recommendation: { type: 'string', description: '明确的修复建议' },
        },
      },
    },
    skipped_rules: {
      type: 'array',
      description: '因信息不足无法判定的规则及原因，不计入扣分',
      items: {
        type: 'object',
        properties: { code: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    rules_version: { type: 'string' },
  },
} as const

const contentBody = {
  type: 'object',
  required: ['format', 'body'],
  properties: {
    format: { type: 'string', enum: ['html', 'markdown'] },
    body: {
      type: 'string',
      description: 'HTML 源码，或带 frontmatter 的 Markdown 源码',
    },
  },
} as const

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'RankLoop SEO API',
      version: '1.0.0',
      description:
        '平台托管内容并执行 SEO 规则检测。第三方提交内容、获取不合格项、自行优化后重新提交，' +
        '达标才允许发布。平台不生成内容，只做判定。',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'API Key，格式 rkl_live_xxx。明文仅创建时返回一次。',
        },
      },
      schemas: { Check: checkSchema, Error: errorResponse },
    },
    security: [{ apiKey: [] }],
    paths: {
      '/rules': {
        get: {
          summary: '规则清单',
          description: '公开接口，返回全部规则的编码、级别与权重。',
          security: [],
          responses: { '200': { description: '规则列表' } },
        },
      },
      '/sites/{siteId}/contents': {
        post: {
          summary: '提交内容',
          description: '提交后立即检测并返回结果。scope: contents:write',
          parameters: [
            { name: 'siteId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    contentBody,
                    { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
                  ],
                },
              },
            },
          },
          responses: {
            '201': { description: '已创建并完成检测' },
            '409': { description: '该路径已存在内容', content: { 'application/json': { schema: errorResponse } } },
            '422': { description: '参数校验失败（含路径穿越）', content: { 'application/json': { schema: errorResponse } } },
            '429': { description: '超出配额', content: { 'application/json': { schema: errorResponse } } },
          },
        },
        get: {
          summary: '列出站点内容',
          description: 'scope: contents:read',
          parameters: [
            { name: 'siteId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'published'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200, default: 50 } },
          ],
          responses: { '200': { description: '内容列表' } },
        },
      },
      '/contents/{contentId}': {
        get: {
          summary: '查看内容与最新检测结果',
          description: 'scope: contents:read',
          parameters: [{ name: 'contentId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: '内容详情' },
            '404': { description: '不存在或不属于当前工作区', content: { 'application/json': { schema: errorResponse } } },
          },
        },
        put: {
          summary: '更新内容',
          description: '产生新版本并重新检测，支持反复迭代。scope: contents:write',
          parameters: [{ name: 'contentId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: contentBody } } },
          responses: { '200': { description: '已更新并完成检测' } },
        },
      },
      '/contents/check': {
        post: {
          summary: '无状态预检',
          description:
            '不落库，供发布前反复试算。平台不保存提交的正文。scope: contents:write',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    contentBody,
                    { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } } },
                  ],
                },
              },
            },
          },
          responses: { '200': { description: '检测结果' } },
        },
      },
      '/contents/{contentId}/publish': {
        post: {
          summary: '发布内容',
          description:
            '以当前版本重新检测；存在 critical 问题时拒绝发布并返回阻塞规则。scope: contents:publish',
          parameters: [{ name: 'contentId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: '已发布' },
            '422': {
              description: 'SEO 门槛未通过，details.blocking 列出阻塞规则',
              content: { 'application/json': { schema: errorResponse } },
            },
          },
        },
      },
    },
    'x-rules': listRules(),
  }
}

export async function openApiRoutes(app: FastifyInstance): Promise<void> {
  const doc = buildOpenApiDocument()
  app.get('/openapi.json', async () => doc)
}
