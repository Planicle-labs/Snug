import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Page, Layout, Card, BlockStack, Text, Button, Banner, InlineStack, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, fitSizeCharts, garmentMappings } from "../schema.server";
import { eq, sql } from "drizzle-orm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.shop, session.shop))
    .limit(1);

  if (!org) {
    return {
      hasSizeCharts: false,
      hasProductMappings: false,
      isWidgetActive: false,
      onboardingStep: 0,
    };
  }

  const [sizeChartCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(fitSizeCharts)
    .where(eq(fitSizeCharts.orgId, org.id))
    .limit(1);

  const hasSizeCharts = (sizeChartCount?.count ?? 0) > 0;

  const [mappingCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(garmentMappings)
    .where(eq(garmentMappings.orgId, org.id))
    .limit(1);

  const hasProductMappings = (mappingCount?.count ?? 0) > 0;
  
  const isWidgetActive = org.widgetActive && hasSizeCharts && hasProductMappings;

  let onboardingStep = 0;
  if (hasSizeCharts && hasProductMappings && isWidgetActive) {
    onboardingStep = 3;
  } else if (hasSizeCharts) {
    onboardingStep = 1;
  } else if (org.brandSlug) {
    onboardingStep = 0;
  }

  return {
    hasSizeCharts,
    hasProductMappings,
    isWidgetActive,
    onboardingStep,
  };
};

export default function Index() {
  const { hasSizeCharts, hasProductMappings, isWidgetActive, onboardingStep } = useLoaderData<typeof loader>();

  const fullySetUp = onboardingStep === 3;
  const inProgress = onboardingStep === 1;

  return (
    <Page title="Snug">
      <Layout>

        {fullySetUp && (
          <Layout.Section>
            <Banner
              title="Snug is live on your storefront"
              tone="success"
            >
              <Text as="p" variant="bodyMd">
                The sizing widget is active and serving recommendations to your shoppers.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {inProgress && !fullySetUp && (
          <Layout.Section>
            <Banner
              title="Almost there! Complete the remaining steps"
              tone="info"
            >
              <Text as="p" variant="bodyMd">
                Finish setting up to activate the sizing widget on your store.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {!inProgress && !fullySetUp && (
          <Layout.Section>
            <Banner
              title="Complete your setup to activate the sizing widget"
              tone="warning"
            >
              <Text as="p" variant="bodyMd">
                Follow the steps below to get Snug live on your storefront.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <BlockStack gap="400">

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Step 1 — Add Size Charts</Text>
                  {hasSizeCharts
                    ? <Badge tone="success">Done</Badge>
                    : <Badge tone="attention">Required</Badge>
                  }
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {hasSizeCharts
                    ? "Your size charts are uploaded and ready."
                    : "Upload your size charts via CSV or add them manually."
                  }
                </Text>
                <Button url="/app/size-charts" variant={hasSizeCharts ? "plain" : "primary"}>
                  {hasSizeCharts ? "View size charts" : "Add size charts"}
                </Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Step 2 — Tag Clothes</Text>
                  {hasProductMappings
                    ? <Badge tone="success">Done</Badge>
                    : hasSizeCharts
                      ? <Badge tone="attention">Required</Badge>
                      : <Badge>Disabled</Badge>
                  }
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {hasProductMappings
                    ? "Your products are mapped to size charts."
                    : "Connect your Shopify products to size charts for correct recommendations."
                  }
                </Text>
                <Button
                  url="/app/products"
                  variant={hasProductMappings ? "plain" : "primary"}
                  disabled={!hasSizeCharts}
                >
                  {hasProductMappings ? "View mappings" : "Tag products"}
                </Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Step 3 — Add Widget</Text>
                  {isWidgetActive
                    ? <Badge tone="success">Active</Badge>
                    : hasProductMappings
                      ? <Badge tone="attention">Required</Badge>
                      : <Badge>Disabled</Badge>
                  }
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {isWidgetActive
                    ? "The sizing widget is enabled in your Shopify theme."
                    : "Configure and activate the widget in your Shopify theme."
                  }
                </Text>
                <Button
                  url="/app/widget"
                  variant={isWidgetActive ? "plain" : "primary"}
                  disabled={!hasProductMappings}
                >
                  {isWidgetActive ? "Configure widget" : "Activate widget"}
                </Button>
              </BlockStack>
            </Card>

          </BlockStack>
        </Layout.Section>

      </Layout>
    </Page>
  );
}