CREATE TABLE "brand_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_name" text NOT NULL,
	"brand_website" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fit_size_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"garment_type" text NOT NULL,
	"size_label" text NOT NULL,
	"fit_type" text NOT NULL,
	"chest_min_cm" numeric NOT NULL,
	"chest_max_cm" numeric NOT NULL,
	"length_min_cm" numeric,
	"length_max_cm" numeric,
	"shoulder_min_cm" numeric,
	"shoulder_max_cm" numeric,
	"ease_value_cm" numeric NOT NULL,
	"ease_source" text DEFAULT 'explicit' NOT NULL,
	"extra_measurements" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "garment_type_check" CHECK ("fit_size_charts"."garment_type" IN ('tshirt','shirt','polo','sweatshirt','hoodie','jacket','kurta','top')),
	CONSTRAINT "fit_type_check" CHECK ("fit_size_charts"."fit_type" IN ('slim','regular','oversized')),
	CONSTRAINT "ease_source_check" CHECK ("fit_size_charts"."ease_source" IN ('explicit','inferred','user_calibrated'))
);
--> statement-breakpoint
CREATE TABLE "garment_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shopify_product_id" text NOT NULL,
	"garment_type" text NOT NULL,
	"chart_override_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop" text NOT NULL,
	"brand_slug" text,
	"api_key" text NOT NULL,
	"plan_tier" text DEFAULT 'free' NOT NULL,
	"usage_remaining" integer DEFAULT 500 NOT NULL,
	"billing_period_start" timestamp DEFAULT now() NOT NULL,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"widget_active" boolean DEFAULT false NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_shop_unique" UNIQUE("shop"),
	CONSTRAINT "organizations_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"shop" text NOT NULL,
	"state" text NOT NULL,
	"isOnline" boolean DEFAULT false NOT NULL,
	"scope" text,
	"expires" timestamp,
	"accessToken" text NOT NULL,
	"userId" bigint,
	"firstName" text,
	"lastName" text,
	"email" text,
	"accountOwner" boolean,
	"locale" text,
	"collaborator" boolean,
	"emailVerified" boolean,
	"refreshToken" text,
	"refreshTokenExpires" timestamp
);
--> statement-breakpoint
CREATE TABLE "widget_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"position" text DEFAULT 'below_add_to_cart' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_requests" ADD CONSTRAINT "brand_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_size_charts" ADD CONSTRAINT "fit_size_charts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garment_mappings" ADD CONSTRAINT "garment_mappings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garment_mappings" ADD CONSTRAINT "garment_mappings_chart_override_id_fit_size_charts_id_fk" FOREIGN KEY ("chart_override_id") REFERENCES "public"."fit_size_charts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_configs" ADD CONSTRAINT "widget_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_garment_size_unique" ON "fit_size_charts" USING btree ("org_id","garment_type","size_label");--> statement-breakpoint
CREATE UNIQUE INDEX "org_product_unique" ON "garment_mappings" USING btree ("org_id","shopify_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_unique" ON "widget_configs" USING btree ("org_id");