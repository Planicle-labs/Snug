import { bigint, boolean, check, integer, jsonb, numeric, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  shop: text("shop").notNull(),
  state: text("state").notNull(),
  isOnline: boolean("isOnline").default(false).notNull(),
  scope: text("scope"),
  expires: timestamp("expires", { mode: "date" }),
  accessToken: text("accessToken").notNull(),
  userId: bigint("userId", { mode: "number" }),
  firstName: text("firstName"),
  lastName: text("lastName"),
  email: text("email"),
  accountOwner: boolean("accountOwner"),
  locale: text("locale"),
  collaborator: boolean("collaborator"),
  emailVerified: boolean("emailVerified"),
  refreshToken: text("refreshToken"),
  refreshTokenExpires: timestamp("refreshTokenExpires", { mode: "date" }),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull().unique(),
  brandSlug: text('brand_slug'),
  apiKey: text('api_key').unique().notNull(),
  planTier: text('plan_tier').default('free').notNull(),
  usageRemaining: integer('usage_remaining').default(500).notNull(),
  billingPeriodStart: timestamp('billing_period_start').defaultNow().notNull(),
  onboardingComplete: boolean('onboarding_complete').default(false).notNull(),
  widgetActive: boolean('widget_active').default(false).notNull(),
  installedAt: timestamp('installed_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const widgetConfigs = pgTable('widget_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  position: text('position').default('below_add_to_cart').notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  config: jsonb('config').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  orgUnique: uniqueIndex('org_unique').on(table.orgId),
}));

export const fitSizeCharts = pgTable('fit_size_charts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  garmentType: text('garment_type').notNull(),
  sizeLabel: text('size_label').notNull(),
  fitType: text('fit_type').notNull(),
  chestMinCm: numeric('chest_min_cm').notNull(),
  chestMaxCm: numeric('chest_max_cm').notNull(),
  lengthMinCm: numeric('length_min_cm'),
  lengthMaxCm: numeric('length_max_cm'),
  shoulderMinCm: numeric('shoulder_min_cm'),
  shoulderMaxCm: numeric('shoulder_max_cm'),
  easeValueCm: numeric('ease_value_cm').notNull(),
  easeSource: text('ease_source').default('explicit').notNull(),
  extraMeasurements: jsonb('extra_measurements'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  orgGarmentSizeUnique: uniqueIndex('org_garment_size_unique')
    .on(table.orgId, table.garmentType, table.sizeLabel),
  
  garmentTypeCheck: check('garment_type_check', 
    sql`${table.garmentType} IN ('tshirt','shirt','polo','sweatshirt','hoodie','jacket','kurta','top')`
  ),
  
  fitTypeCheck: check('fit_type_check',
    sql`${table.fitType} IN ('slim','regular','oversized')`
  ),
  
  easeSourceCheck: check('ease_source_check',
    sql`${table.easeSource} IN ('explicit','inferred','user_calibrated')`
  ),
}));

export const garmentMappings = pgTable('garment_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  shopifyProductId: text('shopify_product_id').notNull(),
  garmentType: text('garment_type').notNull(),
  chartOverrideId: uuid('chart_override_id').references(() => fitSizeCharts.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  orgProductUnique: uniqueIndex('org_product_unique')
    .on(table.orgId, table.shopifyProductId),
}));

export const brandRequests = pgTable('brand_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  brandName: text('brand_name').notNull(),
  brandWebsite: text('brand_website'),
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});