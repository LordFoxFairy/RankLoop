-- 多租户路由：站点新增 slug（子域名标识）与 domain（自有域名）

-- AlterTable：先加可空列，回填后再置为 NOT NULL，
-- 直接加 NOT NULL 会让已有数据的表迁移失败。
ALTER TABLE "sites" ADD COLUMN "slug" TEXT,
  ADD COLUMN "domain" TEXT,
  ADD COLUMN "domain_verified_at" TIMESTAMPTZ,
  ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';

-- 回填：由站点名推导 slug，冲突时附加 id 前缀保证唯一
UPDATE "sites" SET "slug" = COALESCE(
  NULLIF(regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'), ''),
  'site'
) || '-' || substring("id"::text, 1, 8)
WHERE "slug" IS NULL;

ALTER TABLE "sites" ALTER COLUMN "slug" SET NOT NULL;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "custom_domain_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "sites_slug_key" ON "sites"("slug");
CREATE UNIQUE INDEX "sites_domain_key" ON "sites"("domain");
CREATE INDEX "sites_domain_idx" ON "sites"("domain");
