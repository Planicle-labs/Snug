import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Page,
  Card,
  Grid,
  Text,
  IndexTable,
  Badge,
  ProgressBar,
  Banner,
  BlockStack,
  InlineStack,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, usageLogs, fitSizeCharts, conversionEvents } from "@snug/db";
import { eq, and, desc, count } from "drizzle-orm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const dbClient = db;
  const orgTable = organizations;
  const usageLogsTable = usageLogs;
  const fitSizeChartsTable = fitSizeCharts;
  const conversionEventsTable = conversionEvents;

  // 1. Fetch merchant organization record
  const orgs = await dbClient
    .select()
    .from(orgTable)
    .where(eq(orgTable.shop, shop))
    .limit(1);

  if (orgs.length === 0) {
    throw new Response("Organization not found for shop", { status: 404 });
  }

  const org = orgs[0];

  // 2. Trigger on-demand Worker sync to Durable Objects / Neon
  const workerUrl = process.env.WORKER_URL || "https://snug-worker.workers.dev";
  const internalSecret = process.env.INTERNAL_ADMIN_SECRET;

  if (!internalSecret) {
    // A dashboard must never silently fall back to a credential committed in code.
    console.error("[Analytics Loader] INTERNAL_ADMIN_SECRET is not configured; skipped usage sync.");
  } else {
    try {
      const response = await fetch(`${workerUrl}/v1/admin/usage?shop=${encodeURIComponent(shop)}`, {
        method: "GET",
        headers: {
          "X-Internal-Secret": internalSecret,
          "Accept": "application/json",
        },
      });
      if (!response.ok) {
        console.warn(`[Analytics Loader] Worker sync returned ${response.status}.`);
      }
    } catch (err) {
      console.warn("[Analytics Loader] Worker sync warning:", err);
    }
  }

  // 3. Query Analytics Metrics from Neon DB
  // A. Total recommendations
  const totalLogsRes = await dbClient
    .select({ value: count() })
    .from(usageLogsTable)
    .where(eq(usageLogsTable.orgId, org.id));
  const totalRecommendations = Number(totalLogsRes[0]?.value || 0);

  // B. Boundary cases count
  const boundaryLogsRes = await dbClient
    .select({ value: count() })
    .from(usageLogsTable)
    .where(and(eq(usageLogsTable.orgId, org.id), eq(usageLogsTable.isBoundaryCase, true)));
  const boundaryCount = Number(boundaryLogsRes[0]?.value || 0);
  const boundaryPercentage = totalRecommendations > 0 
    ? Math.round((boundaryCount / totalRecommendations) * 100) 
    : 0;

  // C. Conversions count & rate
  const conversionsRes = await dbClient
    .select({ value: count() })
    .from(conversionEventsTable)
    .where(eq(conversionEventsTable.orgId, org.id));
  const totalConversions = Number(conversionsRes[0]?.value || 0);
  const conversionRate = totalRecommendations > 0 
    ? ((totalConversions / totalRecommendations) * 100).toFixed(1) 
    : "0.0";

  // D. Active size charts count
  const activeChartsRes = await dbClient
    .select({ value: count() })
    .from(fitSizeChartsTable)
    .where(eq(fitSizeChartsTable.orgId, org.id));
  const activeChartsCount = Number(activeChartsRes[0]?.value || 0);

  // E. Top requested reference brands
  const topBrandsRes = await dbClient
    .select({
      brand: usageLogsTable.refBrand,
      count: count(),
    })
    .from(usageLogsTable)
    .where(eq(usageLogsTable.orgId, org.id))
    .groupBy(usageLogsTable.refBrand)
    .orderBy(desc(count()))
    .limit(5);

  // F. Predicted size distribution
  const sizeDistRes = await dbClient
    .select({
      size: usageLogsTable.predictedSize,
      count: count(),
    })
    .from(usageLogsTable)
    .where(eq(usageLogsTable.orgId, org.id))
    .groupBy(usageLogsTable.predictedSize)
    .orderBy(desc(count()));

  return {
    shop,
    planTier: (org.planTier as string) || "trial",
    trialRequestsRemaining: Number(org.trialRequestsRemaining ?? 1000),
    totalRecommendations,
    boundaryCount,
    boundaryPercentage,
    totalConversions,
    conversionRate,
    activeChartsCount,
    topBrands: topBrandsRes.map((brand) => ({ brand: brand.brand, count: Number(brand.count) })),
    sizeDistribution: sizeDistRes.map((size) => ({ size: size.size, count: Number(size.count) })),
  };
};

export default function AnalyticsDashboard() {
  const data = useLoaderData<typeof loader>();

  const brandRows = data.topBrands.map((b, index) => (
    <IndexTable.Row id={b.brand} key={b.brand} position={index}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {b.brand.toUpperCase()}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{b.count}</IndexTable.Cell>
      <IndexTable.Cell>
        {data.totalRecommendations > 0
          ? `${Math.round((b.count / data.totalRecommendations) * 100)}%`
          : "0%"}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page title="Usage & Analytics Dashboard" subtitle="Real-time performance metrics and fit recommendation insights">
      <BlockStack gap="500">
        <Banner title="Live Edge Sync Active" tone="info">
          <p>
            Analytics automatically sync with Cloudflare Durable Objects edge counters on load.
          </p>
        </Banner>

        {/* Overview Metric Cards */}
        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued" as="p">
                  Total Fit Recommendations
                </Text>
                <Text variant="headingXl" as="h3">
                  {data.totalRecommendations.toLocaleString()}
                </Text>
                <InlineStack align="space-between">
                  <Badge tone="success">Active</Badge>
                  <Text variant="bodyXs" tone="subdued" as="span">
                    {data.planTier === "trial" ? `${data.trialRequestsRemaining} trial left` : "Unlimited"}
                  </Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued" as="p">
                  Shopper Conversion Rate
                </Text>
                <Text variant="headingXl" as="h3">
                  {data.conversionRate}%
                </Text>
                <Text variant="bodyXs" tone="subdued" as="p">
                  {data.totalConversions} conversions recorded
                </Text>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued" as="p">
                  Boundary Fit Cases
                </Text>
                <Text variant="headingXl" as="h3">
                  {data.boundaryPercentage}%
                </Text>
                <Text variant="bodyXs" tone="subdued" as="p">
                  {data.boundaryCount} two-size suggestions
                </Text>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued" as="p">
                  Active Size Charts
                </Text>
                <Text variant="headingXl" as="h3">
                  {data.activeChartsCount}
                </Text>
                <Text variant="bodyXs" tone="subdued" as="p">
                  Garment charts configured
                </Text>
              </BlockStack>
            </Card>
          </Grid.Cell>
        </Grid>

        {/* Detailed Insights */}
        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Top Requested Reference Brands
                </Text>
                {data.topBrands.length > 0 ? (
                  <IndexTable
                    resourceName={{ singular: "brand", plural: "brands" }}
                    itemCount={data.topBrands.length}
                    selectable={false}
                    headings={[
                      { title: "Brand" },
                      { title: "Requests" },
                      { title: "Share" },
                    ]}
                  >
                    {brandRows}
                  </IndexTable>
                ) : (
                  <Box padding="400">
                    <Text variant="bodyMd" tone="subdued" as="p">
                      No reference brand requests recorded yet. Recommendations will populate here as shoppers interact with your storefront widget.
                    </Text>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Predicted Size Distribution
                </Text>
                {data.sizeDistribution.length > 0 ? (
                  <BlockStack gap="300">
                    {data.sizeDistribution.map((item) => {
                      const pct = data.totalRecommendations > 0
                        ? Math.round((item.count / data.totalRecommendations) * 100)
                        : 0;
                      return (
                        <BlockStack key={item.size} gap="100">
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" fontWeight="semibold" as="span">
                              Size {item.size}
                            </Text>
                            <Text variant="bodySm" tone="subdued" as="span">
                              {item.count} ({pct}%)
                            </Text>
                          </InlineStack>
                          <ProgressBar progress={pct} size="small" />
                        </BlockStack>
                      );
                    })}
                  </BlockStack>
                ) : (
                  <Box padding="400">
                    <Text variant="bodyMd" tone="subdued" as="p">
                      No size prediction data available yet.
                    </Text>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Grid.Cell>
        </Grid>
      </BlockStack>
    </Page>
  );
}
