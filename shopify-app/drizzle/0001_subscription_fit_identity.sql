ALTER TABLE "organizations" DROP COLUMN IF EXISTS "base_fee_inr";
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "per_conversion_inr";
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "monthly_cap_inr";
--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_plan_tier_check";
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_tier_check" CHECK ("organizations"."plan_tier" IN ('trial','starter','growth'));
--> statement-breakpoint
ALTER TABLE "garment_mappings" DROP CONSTRAINT IF EXISTS "garment_mappings_chart_override_id_fit_size_charts_id_fk";
--> statement-breakpoint
ALTER TABLE "garment_mappings" DROP COLUMN IF EXISTS "chart_override_id";
--> statement-breakpoint
ALTER TABLE "garment_mappings" ADD COLUMN IF NOT EXISTS "fit_type" text DEFAULT 'regular' NOT NULL;
--> statement-breakpoint
ALTER TABLE "garment_mappings" DROP CONSTRAINT IF EXISTS "garment_mappings_garment_type_check";
--> statement-breakpoint
ALTER TABLE "garment_mappings" ADD CONSTRAINT "garment_mappings_garment_type_check" CHECK ("garment_mappings"."garment_type" IN ('tshirt','shirt','polo','sweatshirt','hoodie','jacket','kurta','top'));
--> statement-breakpoint
ALTER TABLE "garment_mappings" DROP CONSTRAINT IF EXISTS "garment_mappings_fit_type_check";
--> statement-breakpoint
ALTER TABLE "garment_mappings" ADD CONSTRAINT "garment_mappings_fit_type_check" CHECK ("garment_mappings"."fit_type" IN ('slim','regular','oversized'));
--> statement-breakpoint
ALTER TABLE "conversion_events" DROP COLUMN IF EXISTS "billed";
--> statement-breakpoint
ALTER TABLE "brand_requests" DROP CONSTRAINT IF EXISTS "brand_requests_status_check";
--> statement-breakpoint
ALTER TABLE "brand_requests" ADD CONSTRAINT "brand_requests_status_check" CHECK ("brand_requests"."status" IN ('pending','in_progress','completed'));
--> statement-breakpoint
DROP INDEX IF EXISTS "org_garment_size_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_garment_fit_size_unique" ON "fit_size_charts" USING btree ("org_id","garment_type","fit_type","size_label");
--> statement-breakpoint
DROP INDEX IF EXISTS "brand_size_charts_pk";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_size_charts_pk" ON "brand_size_charts" USING btree ("brand","garment_type","fit_type","size_label");
