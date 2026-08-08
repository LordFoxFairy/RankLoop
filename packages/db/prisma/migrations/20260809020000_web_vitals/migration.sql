-- Core Web Vitals：来自 Google CrUX 的真实用户数据。
-- has_data 区分「没同步过」与「同步了但 Google 样本不足」——
-- 后者是新站点的常态，必须能如实说明原因而不是显示一堆 0。
CREATE TABLE "web_vitals" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'origin',
    "url" TEXT NOT NULL DEFAULT '',
    "form_factor" TEXT NOT NULL DEFAULT 'ALL',
    "date" DATE NOT NULL,
    "has_data" BOOLEAN NOT NULL DEFAULT false,
    "lcp_p75" DOUBLE PRECISION,
    "inp_p75" DOUBLE PRECISION,
    "cls_p75" DOUBLE PRECISION,
    "lcp_good" DOUBLE PRECISION,
    "inp_good" DOUBLE PRECISION,
    "cls_good" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_vitals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "web_vitals_site_id_scope_url_form_factor_date_key"
    ON "web_vitals"("site_id", "scope", "url", "form_factor", "date");
CREATE INDEX "web_vitals_site_id_date_idx" ON "web_vitals"("site_id", "date");

ALTER TABLE "web_vitals" ADD CONSTRAINT "web_vitals_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
