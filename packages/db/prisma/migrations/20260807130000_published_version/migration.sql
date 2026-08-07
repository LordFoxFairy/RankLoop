-- 记录线上实际生效的版本。
-- 此前无法区分「已发布且未修改」与「已发布但有新修订」，
-- 导致修复后的版本无法再次发布，线上永远停留在旧版本。
ALTER TABLE "contents" ADD COLUMN "published_version_id" UUID;

-- 已发布的存量内容：当前版本即为线上版本
UPDATE "contents" SET "published_version_id" = "current_version_id"
WHERE "status" = 'published' AND "current_version_id" IS NOT NULL;
