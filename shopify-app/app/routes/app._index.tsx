import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Page, Layout, Card, BlockStack, Text, Button, Banner, InlineStack, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations } from "../schema.server";
import { eq } from "drizzle-orm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.shop, shop))
    .limit(1);

  return {
    shop,
    brandName: org?.brandName ?? null,
    isWidgetActive: org?.isWidgetActive ?? false,
  };
};

export default function Index() {
  const { shop, brandName, isWidgetActive } = useLoaderData<typeof loader>();

  const brandConfigured = brandName !== null;
  const fullySetUp = brandConfigured && isWidgetActive;

  return (
    <Page title="Snug">
      <Layout>

        {!fullySetUp && (
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

        <Layout.Section>
          <BlockStack gap="400">

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Step 1 — Connect your brand</Text>
                  {brandConfigured
                    ? <Badge tone="success">Done</Badge>
                    : <Badge tone="attention">Required</Badge>
                  }
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {brandConfigured
                    ? `Your store is connected to ${brandName} in the Snug database.`
                    : "Tell Snug which brand you are so we can match your size charts to shopper references."
                  }
                </Text>
                <Button url="/app/brand" variant={brandConfigured ? "plain" : "primary"}>
                  {brandConfigured ? "Change brand" : "Connect your brand"}
                </Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Step 2 — Activate the widget</Text>
                  {isWidgetActive
                    ? <Badge tone="success">Active</Badge>
                    : <Badge tone="attention">Required</Badge>
                  }
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {isWidgetActive
                    ? "The sizing widget is enabled in your Shopify theme."
                    : "Enable the Snug widget in your Shopify theme editor. Takes one click."
                  }
                </Text>
                <Button
                  url={`https://${shop}/admin/themes/current/editor?context=apps`}
                  external
                  variant={isWidgetActive ? "plain" : "primary"}
                  disabled={!brandConfigured}
                >
                  {isWidgetActive ? "Open theme editor" : "Activate in theme editor"}
                </Button>
              </BlockStack>
            </Card>

          </BlockStack>
        </Layout.Section>

      </Layout>
    </Page>
  );
}