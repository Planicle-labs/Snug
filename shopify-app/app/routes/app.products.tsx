import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    Button,
    Banner,
    InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, fitSizeCharts, garmentMappings } from "@snug/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

const GARMENT_TYPES = [
    { label: "T-Shirt", value: "tshirt" },
    { label: "Shirt", value: "shirt" },
    { label: "Polo", value: "polo" },
    { label: "Sweatshirt", value: "sweatshirt" },
    { label: "Hoodie", value: "hoodie" },
    { label: "Jacket", value: "jacket" },
    { label: "Kurta", value: "kurta" },
    { label: "Top", value: "top" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.shop, shop))
        .limit(1);

    if (!org) {
        return { mappings: [], garmentTypes: [], hasOrg: false, hasSizeCharts: false };
    }

    const [chartCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(fitSizeCharts)
        .where(eq(fitSizeCharts.orgId, org.id))
        .limit(1);

    const hasSizeCharts = (chartCount?.count ?? 0) > 0;

    const mappings = await db
        .select()
        .from(garmentMappings)
        .where(eq(garmentMappings.orgId, org.id));
    
    return { 
        mappings, 
        garmentTypes: GARMENT_TYPES,
        hasOrg: true,
        hasSizeCharts,
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "map-product") {
        const productId = formData.get("productId") as string;
        const garmentType = formData.get("garmentType") as string;

        if (!productId || !garmentType) {
            return { error: "Please select a product and garment type." };
        }

        const [org] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.shop, shop))
            .limit(1);

        if (!org) {
            return { error: "Organization not found." };
        }

        const [existing] = await db
            .select()
            .from(garmentMappings)
            .where(eq(garmentMappings.shopifyProductId, productId))
            .limit(1);

        if (existing) {
            await db
                .update(garmentMappings)
                .set({ garmentType, updatedAt: new Date() })
                .where(eq(garmentMappings.shopifyProductId, productId));
        } else {
            await db.insert(garmentMappings).values({
                id: randomUUID(),
                orgId: org.id,
                shopifyProductId: productId,
                garmentType,
            });
        }

        return { success: true };
    }

    if (intent === "delete-mapping") {
        const mappingId = formData.get("mappingId") as string;
        
        if (mappingId) {
            await db.delete(garmentMappings).where(eq(garmentMappings.id, mappingId));
            return { deleted: true };
        }
    }

    return { error: "Unknown action" };
};

export default function Products() {
    const { mappings, garmentTypes, hasOrg, hasSizeCharts } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();

    return (
        <Page
            title="Tag Clothes"
            backAction={{ url: "/app" }}
        >
            <Layout>
                <Layout.Section>

                    {!hasOrg && (
                        <Banner tone="critical" title="Organization not found">
                            <Text as="p" variant="bodyMd">
                                Please reinstall the app to continue.
                            </Text>
                        </Banner>
                    )}

                    {!hasSizeCharts && (
                        <Banner tone="warning" title="Add size charts first">
                            <Text as="p" variant="bodyMd">
                                You need to add size charts before mapping products.
                            </Text>
                            <Button url="/app/size-charts" variant="plain">
                                Add size charts
                            </Button>
                        </Banner>
                    )}

                    {actionData?.error && (
                        <Banner tone="critical" title="Error">
                            <Text as="p" variant="bodyMd">{actionData.error}</Text>
                        </Banner>
                    )}

                    {actionData?.success && (
                        <Banner tone="success" title="Product mapped">
                            <Text as="p" variant="bodyMd">
                                The product has been mapped successfully.
                            </Text>
                        </Banner>
                    )}

                    {actionData?.deleted && (
                        <Banner tone="success" title="Mapping removed">
                            <Text as="p" variant="bodyMd">
                                The product mapping has been removed.
                            </Text>
                        </Banner>
                    )}

                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">Map Products</Text>
                                <Text as="p" variant="bodyMd" tone="subdued">
                                    Connect your Shopify products to garment types for correct size recommendations.
                                </Text>
                            </BlockStack>

                            <Form method="post">
                                <input type="hidden" name="intent" value="map-product" />
                                <BlockStack gap="300">
                                    <Text as="p" variant="bodyMd">
                                        Enter product ID and select garment type:
                                    </Text>
                                    <InlineStack gap="300">
                                        <input 
                                            type="text" 
                                            name="productId" 
                                            placeholder="gid://shopify/Product/1234567890"
                                            style={{ width: "100%", padding: "8px" }}
                                        />
                                        <select 
                                            name="garmentType"
                                            style={{ padding: "8px" }}
                                        >
                                            {garmentTypes.map(gt => (
                                                <option key={gt.value} value={gt.value}>
                                                    {gt.label}
                                                </option>
                                            ))}
                                        </select>
                                    </InlineStack>
                                    <InlineStack align="end">
                                        <Button
                                            variant="primary"
                                            submit
                                            disabled={!hasSizeCharts}
                                        >
                                            Map Product
                                        </Button>
                                    </InlineStack>
                                </BlockStack>
                            </Form>

                        </BlockStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="300">
                            <Text as="h2" variant="headingMd">Your Product Mappings</Text>
                            
                            {mappings.length === 0 ? (
                                <Text as="p" variant="bodyMd" tone="subdued">
                                    No product mappings yet. Map your first product above.
                                </Text>
                            ) : (
                                <BlockStack gap="200">
                                    {mappings.map((row) => (
                                        <InlineStack key={row.id} align="space-between">
                                            <Text as="span">{row.shopifyProductId}</Text>
                                            <InlineStack gap="200">
                                                <Text as="span" tone="subdued">
                                                    {GARMENT_TYPES.find(g => g.value === row.garmentType)?.label || row.garmentType}
                                                </Text>
                                                <Form method="post">
                                                    <input type="hidden" name="intent" value="delete-mapping" />
                                                    <input type="hidden" name="mappingId" value={row.id} />
                                                    <Button variant="plain" submit>Remove</Button>
                                                </Form>
                                            </InlineStack>
                                        </InlineStack>
                                    ))}
                                </BlockStack>
                            )}
                        </BlockStack>
                    </Card>
                </Layout.Section>

            </Layout>
        </Page>
    );
}