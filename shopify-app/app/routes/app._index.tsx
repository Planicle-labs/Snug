import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Link,
  Banner,
  Badge,
  ProgressBar,
  Divider,
  Box,
  DataTable,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, fitSizeCharts, garmentMappings, widgetConfigs, usageLogs } from "@snug/db";
import { eq, sql, desc } from "drizzle-orm";

const MASTER_BRAND_MAP: Record<string, string> = {
  snitch: "Snitch",
  bewakoof: "Bewakoof",
  zara: "Zara",
  hm: "H&M",
  levis: "Levi's",
  nike: "Nike",
  roadster: "Roadster",
  souledstore: "The Souled Store",
  uniqlo: "Uniqlo",
  adidas: "Adidas",
  puma: "Puma",
  marksandspencer: "Marks & Spencer",
  "allen-solly": "Allen Solly",
  "peter-england": "Peter England",
  "van-heusen": "Van Heusen",
  gap: "Gap",
  lululemon: "Lululemon",
  under_armour: "Under Armour",
  ralph_lauren: "Ralph Lauren",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const dbClient = db as any;
  const orgTable = organizations as any;
  const fitSizeChartsTable = fitSizeCharts as any;
  const garmentMappingsTable = garmentMappings as any;
  const widgetConfigsTable = widgetConfigs as any;
  const usageLogsTable = usageLogs as any;

  const [org] = await dbClient
    .select()
    .from(orgTable)
    .where(eq(orgTable.shop, session.shop))
    .limit(1);

  const extensionId = process.env.SHOPIFY_EXTENSION_ID || "c260fa7a-4d1c-43c5-b1b0-7da41a36bca6c5bccfc7";
  const themeEditorDeepLink = `https://${session.shop}/admin/themes/current/editor?context=apps&activateAppId=${extensionId}/snug_embed`;

  if (!org) {
    return {
      shop: session.shop,
      planTier: "trial",
      trialRequestsRemaining: 1000,
      isWidgetActive: false,
      widgetPosition: "below_add_to_cart",
      totalSizeCharts: 0,
      totalMappings: 0,
      totalRecommendations: 0,
      avgConfidence: 0,
      configuredBrands: [],
      configuredGarments: [],
      recentLogs: [],
      storefrontUrl: `https://${session.shop}`,
      themeEditorDeepLink,
    };
  }

  const [sizeChartCount] = await dbClient
    .select({ count: sql<number>`count(*)` })
    .from(fitSizeChartsTable)
    .where(eq(fitSizeChartsTable.orgId, org.id))
    .limit(1);

  const garmentRows = await dbClient
    .select({ garmentType: fitSizeChartsTable.garmentType })
    .from(fitSizeChartsTable)
    .where(eq(fitSizeChartsTable.orgId, org.id));

  const configuredGarments = Array.from(
    new Set(garmentRows.map((r: any) => String(r.garmentType || "")).filter(Boolean))
  );

  const [mappingCount] = await dbClient
    .select({ count: sql<number>`count(*)` })
    .from(garmentMappingsTable)
    .where(eq(garmentMappingsTable.orgId, org.id))
    .limit(1);

  const [widgetConfig] = await dbClient
    .select()
    .from(widgetConfigsTable)
    .where(eq(widgetConfigsTable.orgId, org.id))
    .limit(1);

  const [usageSummary] = await dbClient
    .select({
      total: sql<number>`count(*)`,
      avgConfidence: sql<number>`coalesce(round(avg(confidence)), 0)`,
    })
    .from(usageLogsTable)
    .where(eq(usageLogsTable.orgId, org.id))
    .limit(1);

  const rawRecentLogs = await dbClient
    .select({
      id: usageLogsTable.id,
      refBrand: usageLogsTable.refBrand,
      refGarment: usageLogsTable.refGarment,
      refSize: usageLogsTable.refSize,
      predictedSize: usageLogsTable.predictedSize,
      confidence: usageLogsTable.confidence,
      isBoundaryCase: usageLogsTable.isBoundaryCase,
      createdAt: usageLogsTable.createdAt,
    })
    .from(usageLogsTable)
    .where(eq(usageLogsTable.orgId, org.id))
    .orderBy(desc(usageLogsTable.createdAt))
    .limit(5);

  const recentLogs = rawRecentLogs.map((log: any) => ({
    id: String(log.id),
    refBrand: String(log.refBrand || ""),
    refGarment: String(log.refGarment || ""),
    refSize: String(log.refSize || ""),
    predictedSize: String(log.predictedSize || ""),
    confidence: Number(log.confidence || 0),
    isBoundaryCase: Boolean(log.isBoundaryCase),
    createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : new Date().toISOString(),
  }));

  const rawSlugs = (org.brandSlug as string) || "";
  const configuredBrands = rawSlugs
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean)
    .map((slug: string) => {
      const key = slug.toLowerCase();
      const displayName = MASTER_BRAND_MAP[key] || slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      return { slug, name: displayName };
    });

  const totalSizeCharts = Number(sizeChartCount?.count ?? 0);
  const totalMappings = Number(mappingCount?.count ?? 0);
  const isWidgetActive = Boolean(org.widgetActive);

  return {
    shop: session.shop,
    planTier: (org.planTier as string) || "trial",
    trialRequestsRemaining: Number(org.trialRequestsRemaining ?? 1000),
    isWidgetActive,
    widgetPosition: (widgetConfig?.position as string) || "below_add_to_cart",
    totalSizeCharts,
    totalMappings,
    totalRecommendations: Number(usageSummary?.total ?? 0),
    avgConfidence: Number(usageSummary?.avgConfidence ?? 0),
    configuredBrands,
    configuredGarments,
    recentLogs,
    storefrontUrl: `https://${session.shop}`,
    themeEditorDeepLink,
  };
};

function formatRelativeTime(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export default function Index() {
  const {
    shop,
    planTier,
    trialRequestsRemaining,
    isWidgetActive,
    widgetPosition,
    totalSizeCharts,
    totalMappings,
    totalRecommendations,
    avgConfidence,
    configuredBrands,
    configuredGarments,
    recentLogs,
    storefrontUrl,
    themeEditorDeepLink,
  } = useLoaderData<typeof loader>();

  const readablePosition = widgetPosition.replace(/_/g, " ");

  const tableRows = recentLogs.map((log: any) => [
    `${log.refBrand.toUpperCase()} ${log.refSize} (${log.refGarment})`,
    <Badge tone="info" key={`pred-${log.id}`}>{log.predictedSize}</Badge>,
    <Badge tone={log.confidence >= 75 ? "success" : log.confidence >= 50 ? "info" : "attention"} key={`conf-${log.id}`}>
      {`${log.confidence}%`}
    </Badge>,
    log.isBoundaryCase ? <Badge tone="attention" key={`bound-${log.id}`}>Dual Size</Badge> : <Text as="span" tone="subdued" key={`bound-${log.id}`}>Single</Text>,
    formatRelativeTime(log.createdAt),
  ]);

  return (
    <Page
      title="Snug Overview"
      subtitle="AI-powered apparel sizing engine and fit recommendation hub"
      primaryAction={{
        content: "View Storefront",
        url: storefrontUrl,
        external: true,
      }}
    >
      <Layout>

        {/* Status Announcement Banner */}
        <Layout.Section>
          {isWidgetActive ? (
            <Banner title="Snug Sizing Engine is Live on Your Storefront" tone="success">
              <Text as="p" variant="bodyMd">
                Shoppers are actively receiving real-time fit recommendations based on reference brands they already wear.
              </Text>
            </Banner>
          ) : (
            <Banner title="Snug Sizing Engine is Inactive" tone="info">
              <Text as="p" variant="bodyMd">
                The sizing widget is not currently active on your storefront. Use the navigation sidebar to configure your store settings.
              </Text>
            </Banner>
          )}
        </Layout.Section>

        {/* Core Operational Metrics */}
        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "16px",
              paddingBottom: "16px",
            }}
          >
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Widget Status</Text>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="headingLg">{isWidgetActive ? "Active" : "Inactive"}</Text>
                  <Badge tone={isWidgetActive ? "success" : "attention"}>
                    {isWidgetActive ? "Live" : "Disabled"}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Placement: {readablePosition}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Recommendations</Text>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="headingLg">{totalRecommendations.toLocaleString()}</Text>
                  <Badge tone="info">All-time</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Lifetime shopper predictions
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Fit Confidence</Text>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="headingLg">{avgConfidence > 0 ? `${avgConfidence}%` : "--"}</Text>
                  <Badge tone={avgConfidence >= 70 ? "success" : "info"}>
                    {avgConfidence >= 70 ? "High Fit" : "Calibrated"}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Average precision accuracy
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Monthly Quota</Text>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="headingLg">{trialRequestsRemaining.toLocaleString()}</Text>
                  <Badge tone="info">{planTier.toUpperCase()}</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {1000 - trialRequestsRemaining} of 1,000 requests used
                </Text>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* Production Deployment Segment */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Production Deployment</Text>
                <Button url={storefrontUrl} external variant="primary">
                  Visit Storefront ↗
                </Button>
              </InlineStack>

              <Divider />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "24px",
                }}
              >
                {/* Column 1: Core Deployment & Runtime */}
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">
                      DEPLOYMENT
                    </Text>
                    <InlineStack gap="150" blockAlign="center">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        snug-edge-worker
                      </Text>
                      <Badge tone="success">Ready</Badge>
                    </InlineStack>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">
                      STATUS
                    </Text>
                    <InlineStack gap="150" blockAlign="center">
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: "#10B981",
                          display: "inline-block",
                        }}
                      />
                      <Text as="p" variant="bodyMd">
                        Ready (Global Edge Network)
                      </Text>
                    </InlineStack>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">
                      SOURCE &amp; VERSION
                    </Text>
                    <InlineStack gap="150" blockAlign="center">
                      <Badge tone="info">branch: main</Badge>
                      <Text as="span" variant="bodySm" tone="subdued">v2.0 release</Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>

                {/* Column 2: Domains & Endpoints */}
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">
                      DOMAINS
                    </Text>
                    <BlockStack gap="050">
                      <Link url={storefrontUrl} external>
                        {shop} ↗
                      </Link>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Active Production Storefront
                      </Text>
                    </BlockStack>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">
                      EDGE API ENDPOINT
                    </Text>
                    <BlockStack gap="050">
                      <Text as="p" variant="bodyMd">
                        snug-worker.planicle-labs.workers.dev
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Cloudflare Workers · V8 Isolates
                      </Text>
                    </BlockStack>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">
                      EDGE KV CACHE
                    </Text>
                    <InlineStack gap="150" blockAlign="center">
                      <Badge tone="success">Synchronized</Badge>
                      <Text as="span" variant="bodySm" tone="subdued">snug-kv namespace (sub-50ms)</Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>

                {/* Column 3: Storefront Integration & Configuration */}
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">
                      THEME APP EMBED
                    </Text>
                    <InlineStack gap="150" blockAlign="center">
                      <Badge tone={isWidgetActive ? "success" : "attention"}>
                        {isWidgetActive ? "Enabled" : "Disabled"}
                      </Badge>
                      <Text as="span" variant="bodySm" tone="subdued">snug_embed (Body Target)</Text>
                    </InlineStack>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">
                      BUTTON PLACEMENT
                    </Text>
                    <Text as="p" variant="bodyMd">
                      Placement: {readablePosition}
                    </Text>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">
                      PLAN &amp; USAGE ALLOWANCE
                    </Text>
                    <InlineStack gap="150" blockAlign="center">
                      <Badge tone="info">{planTier.toUpperCase()}</Badge>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {trialRequestsRemaining.toLocaleString()} requests remaining
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </div>

              <Divider />

              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="bodySm" tone="subdued">
                  Sizing engine is distributed across 300+ global Cloudflare edge locations with zero theme blocking.
                </Text>
                <Link url={themeEditorDeepLink} external>
                  Open Theme Editor ↗
                </Link>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Current Store Configuration Overview */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Store Configuration Overview</Text>

              {/* Reference Brands */}
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm">Calibrated Reference Brands</Text>
                  <Badge tone={configuredBrands.length > 0 ? "success" : "attention"}>
                    {configuredBrands.length > 0 ? `${configuredBrands.length} Brands Active` : "None"}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Shoppers can select any of these brands on your product pages for instant size calibration:
                </Text>
                {configuredBrands.length > 0 ? (
                  <InlineStack gap="150" wrap={true}>
                    {configuredBrands.map((b: any) => (
                      <Badge tone="info" key={b.slug}>{b.name}</Badge>
                    ))}
                  </InlineStack>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">No reference brands selected.</Text>
                )}
              </BlockStack>

              <Divider />

              {/* Size Charts & Garments */}
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm">Active Garment Charts</Text>
                  <Badge tone={totalSizeCharts > 0 ? "success" : "attention"}>
                    {totalSizeCharts > 0 ? `${totalSizeCharts} Sizes Configured` : "None"}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Garment categories with verified chest, length, and ease measurements:
                </Text>
                {configuredGarments.length > 0 ? (
                  <InlineStack gap="150" wrap={true}>
                    {configuredGarments.map((g: any) => (
                      <Badge tone="success" key={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</Badge>
                    ))}
                  </InlineStack>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">No size charts configured.</Text>
                )}
              </BlockStack>

              <Divider />

              {/* Products Mapping */}
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm">Catalog Product Mapping</Text>
                  <Badge tone={totalMappings > 0 ? "success" : "attention"}>
                    {totalMappings > 0 ? `${totalMappings} Products Linked` : "No Products Mapped"}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Catalog products currently connected to Snug fit sizing charts and algorithms.
                </Text>
              </BlockStack>

              <Divider />

              {/* Storefront Widget */}
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm">Storefront Widget Deployment</Text>
                  <Badge tone={isWidgetActive ? "success" : "attention"}>
                    {isWidgetActive ? "Active on Storefront" : "Inactive"}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {`Button Placement: ${readablePosition} · Theme App Embed: ${isWidgetActive ? "Enabled" : "Disabled"}`}
                </Text>
              </BlockStack>

            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Recent Activity Feed / Recommendation Preview */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">Recent Storefront Sizing Activity</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Live fit recommendations calculated for shoppers on your product pages.
                </Text>
              </BlockStack>

              {recentLogs.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Shopper Input", "Recommended Size", "Confidence", "Boundary", "Time"]}
                  rows={tableRows}
                />
              ) : (
                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      No recommendations served yet
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Once shoppers use the widget on your storefront, their sizing calculations will appear here in real time.
                    </Text>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

      </Layout>
    </Page>
  );
}
