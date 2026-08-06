# syntax=docker/dockerfile:1

# 统一镜像：通过启动命令区分 api / worker 进程（规格 §11.2）
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
# Prisma 需要 openssl 才能正确探测引擎版本，缺失会退化为 openssl-1.1.x 并告警
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---------- 依赖 ----------
FROM base AS deps
# 只复制清单文件，让依赖层在源码变动时仍能命中缓存
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/seo-rules/package.json packages/seo-rules/
RUN npm ci --include=dev

# ---------- 构建 ----------
FROM deps AS build
COPY tsconfig.json ./
COPY packages/ packages/
COPY apps/ apps/
# 根 build 脚本负责顺序：先 generate，再按依赖顺序构建各包。
# 不能用 --workspaces，其顺序不保证 seo-rules 先于依赖它的 api 构建。
RUN npm run build

# ---------- 生产依赖 ----------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/seo-rules/package.json packages/seo-rules/
RUN npm ci --omit=dev
# 运行时需要 Prisma Client，必须在生产依赖中再生成一次
COPY packages/db/prisma packages/db/prisma
RUN npx prisma generate --schema packages/db/prisma/schema.prisma

# ---------- 运行 ----------
FROM base AS runner

# 健康检查需要 curl；openssl 已在 base 阶段安装
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/packages/seo-rules/dist packages/seo-rules/dist
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node packages/seo-rules/package.json packages/seo-rules/
COPY --chown=node:node packages/db/prisma packages/db/prisma
COPY --chown=node:node package.json ./

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health/live || exit 1

CMD ["node", "apps/api/dist/server.js"]
