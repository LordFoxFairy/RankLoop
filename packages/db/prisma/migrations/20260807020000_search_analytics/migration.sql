-- CreateTable
CREATE TABLE "search_analytics" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL DEFAULT '',
    "page" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "device" TEXT NOT NULL DEFAULT '',
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "search_analytics_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "gsc_sync_jobs" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "rows_synced" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    CONSTRAINT "gsc_sync_jobs_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "search_analytics_site_id_date_idx" ON "search_analytics"("site_id", "date");
-- CreateIndex
CREATE INDEX "search_analytics_site_id_query_idx" ON "search_analytics"("site_id", "query");
-- CreateIndex
CREATE UNIQUE INDEX "search_analytics_site_id_date_query_page_country_device_key" ON "search_analytics"("site_id", "date", "query", "page", "country", "device");
-- CreateIndex
CREATE INDEX "gsc_sync_jobs_site_id_started_at_idx" ON "gsc_sync_jobs"("site_id", "started_at");
-- AddForeignKey
ALTER TABLE "search_analytics" ADD CONSTRAINT "search_analytics_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "gsc_sync_jobs" ADD CONSTRAINT "gsc_sync_jobs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
