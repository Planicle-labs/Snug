import { bigint, boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
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
  //Does not include the not null flag as for a brief duration of time it will be null
  //API key is generated programmatically during the OAuth callback after the row is created
  apiKey: text('api_key').unique(),

  // Trial tracking
  planTier: text('plan_tier').default('trial').notNull(),
  trialRequestsRemaining: integer('trial_requests_remaining').default(1000).notNull(),
  trialExhaustedAt: timestamp('trial_exhausted_at'),

  // Paid tier fields — all nullable, set on upgrade
  baseFeeInr: integer('base_fee_inr'),
  perConversionInr: integer('per_conversion_inr'),
  monthlyCapInr: integer('monthly_cap_inr'),
  shopifyChargeId: text('shopify_charge_id'),
  billingPeriodStart: timestamp('billing_period_start'),
  upgradedAt: timestamp('upgraded_at'),

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

export const usageLogs = pgTable(
  'usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No FK — Worker uses restricted connection that cannot enforce
    // referential integrity across tables
    orgId: uuid('org_id').notNull(),
    refBrand: text('ref_brand').notNull(),
    refGarment: text('ref_garment').notNull(),
    refSize: text('ref_size').notNull(),
    predictedSize: text('predicted_size').notNull(),
    confidence: integer('confidence').notNull(),
    // confidence_label derived at query time:
    // 75-100 = high, 45-74 = medium, below 45 = low
    isBoundaryCase: boolean('is_boundary_case').notNull(),
    responseMs: integer('response_ms').notNull(),
    visitorId: text('visitor_id'),
    ledToConversion: boolean('led_to_conversion').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // Critical for cron COUNT queries — prevents full table scan per org
    orgCreatedAtIndex: index('usage_logs_org_created_at_idx').on(
      table.orgId,
      table.createdAt
    ),
  })
);

export const conversionEvents = pgTable(
  'conversion_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No FK — Worker uses restricted connection
    orgId: uuid('org_id').notNull(),
    usageLogId: uuid('usage_log_id').notNull(),
    visitorId: text('visitor_id').notNull(),
    shopifyProductId: text('shopify_product_id').notNull(),
    billed: boolean('billed').default(false).notNull(),
    // Format: '2026-05' — used for grouping monthly billing reports
    billingPeriod: text('billing_period').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    orgBillingPeriodIndex: index('conversion_events_org_billing_period_idx').on(
      table.orgId,
      table.billingPeriod
    ),
    visitorProductIndex: index('conversion_events_visitor_product_idx').on(
      table.visitorId,
      table.shopifyProductId
    ),
  })
)

export const brandSizeCharts = pgTable(
  'brand_size_charts',
  {
    brand: text('brand').notNull(),
    garmentType: text('garment_type').notNull(),
    sizeLabel: text('size_label').notNull(),
    chestMinCm: numeric('chest_min_cm').notNull(),
    chestMaxCm: numeric('chest_max_cm').notNull(),
    lengthMinCm: numeric('length_min_cm'),
    lengthMaxCm: numeric('length_max_cm'),
    shoulderMinCm: numeric('shoulder_min_cm'),
    shoulderMaxCm: numeric('shoulder_max_cm'),
    fitType: text('fit_type').notNull(),
    easeValueCm: numeric('ease_value_cm').notNull(),
    easeSource: text('ease_source').notNull(),
    scrapedAt: timestamp('scraped_at').notNull(),
  },
  (table) => ({
    pk: uniqueIndex('brand_size_charts_pk').on(
      table.brand,
      table.garmentType,
      table.sizeLabel
    ),
    garmentTypeCheck: check(
      'brand_size_charts_garment_type_check',
      sql`${table.garmentType} IN ('tshirt','shirt','polo','sweatshirt','hoodie','jacket','kurta','top')`
    ),
    fitTypeCheck: check(
      'brand_size_charts_fit_type_check',
      sql`${table.fitType} IN ('slim','regular','oversized')`
    ),
    easeSourceCheck: check(
      'brand_size_charts_ease_source_check',
      sql`${table.easeSource} IN ('explicit','inferred','user_calibrated')`
    ),
  })
);

export const anthropometricAnchors = pgTable(
  'anthropometric_anchors',
  {
    garmentType: text('garment_type').notNull(),
    sizeLabel: text('size_label').notNull(),
    chestBodyCm: numeric('chest_body_cm').notNull(),
    shoulderBodyCm: numeric('shoulder_body_cm'),
    heightCm: numeric('height_cm'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: uniqueIndex('anthropometric_anchors_pk').on(
      table.garmentType,
      table.sizeLabel
    ),
    garmentTypeCheck: check(
      'anthropometric_anchors_garment_type_check',
      sql`${table.garmentType} IN ('tshirt','shirt','polo','sweatshirt','hoodie','jacket','kurta','top')`
    ),
  })
);

