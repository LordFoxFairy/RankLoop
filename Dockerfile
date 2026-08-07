# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
# Prisma 需要 openssl 才能正确探测引擎版本，缺失会退化并告警
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---------- 依赖 ----------
FROM base AS deps
# 复制全部 workspace 清单：漏掉任何一个都会导致其依赖缺失。
# .dockerignore 已排除 node_modules 与 dist，因此整目录复制是安全的。
COPY package.json package-lock.json ./
COPY apps/ apps/
COPY packages/ packages/
RUN npm ci --include=dev

# ---------- 构建 ----------
FROM deps AS build
COPY tsconfig.json ./
# 镜像只提供 API 服务，静态站生成器由 GitHub Actions 单独构建，此处无需编译
RUN npm run generate \
  && npm run build --workspace @rankloop/seo-rules \
  && npm run build --workspace @rankloop/api

# ---------- 生产依赖 ----------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/ apps/
COPY packages/ packages/
RUN npm ci --omit=dev
COPY packages/db/prisma packages/db/prisma
RUN npx prisma generate --schema packages/db/prisma/schema.prisma

# ---------- 运行 ----------
FROM base AS runner

# 健康检查需要 curl；openssl 已在 base 阶段安装
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps --chown=node:node /app/node_modules node_modules
# npm 对版本冲突的依赖不会提升到根，会装进 workspace 自己的 node_modules，
# 漏拷则运行时 MODULE_NOT_FOUND（zod 就属于这种情况）
COPY --from=prod-deps --chown=node:node /app/apps/api/node_modules apps/api/node_modules
# 只复制 dist 与清单，不含源码（规格 §10.2）
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/packages/seo-rules/dist packages/seo-rules/dist
# 控制台的 Alpine.js 与 Pico CSS（本地内置，无 CDN 依赖）
COPY --chown=node:node apps/api/public apps/api/public
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node packages/seo-rules/package.json packages/seo-rules/
COPY --chown=node:node packages/db/prisma packages/db/prisma
# 初始化脚本随镜像发布，避免每次部署都要手动 cp 进容器
COPY --chown=node:node packages/db/seed.mjs packages/db/seed.mjs
COPY --chown=node:node package.json ./

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health/live || exit 1

CMD ["node", "apps/api/dist/server.js"]
