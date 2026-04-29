import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    TextField,
    Button,
    Banner,
    InlineStack,
    Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations } from "../schema.server";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

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
        currentBrandId: org?.brandId ?? null,
        currentBrandName: org?.brandName ?? null,
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const brandId = formData.get("brandId") as string;
    const brandName = formData.get("brandName") as string;

    if (!brandId || !brandName) {
        return { error: "Please enter a valid brand name." };
    }

    const [existing] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.shop, shop))
        .limit(1);

    if (existing) {
        await db
            .update(organizations)
            .set({ brandId, brandName, updatedAt: new Date() })
            .where(eq(organizations.shop, shop));
    } else {
        await db.insert(organizations).values({
            id: randomUUID(),
            shop,
            brandId,
            brandName,
            isWidgetActive: false,
        });
    }

    return { success: true, brandName };
};

export default function BrandSetup() {
    const { currentBrandName } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";
    const [brandName, setBrandName] = useState(currentBrandName ?? "");
    const handleBrandNameChange = useCallback((value: string) => setBrandName(value), []);

    return (
        <Page
            title="Brand Setup"
            backAction={{ url: "/app" }}
        >
            <Layout>
                <Layout.Section>

                    {currentBrandName && (
                        <Banner tone="success" title="Brand connected">
                            <Text as="p" variant="bodyMd">
                                Your store is currently connected to <strong>{currentBrandName}</strong>.
                            </Text>
                        </Banner>
                    )}

                    {actionData?.error && (
                        <Banner tone="critical" title="Something went wrong">
                            <Text as="p" variant="bodyMd">{actionData.error}</Text>
                        </Banner>
                    )}

                    {actionData?.success && (
                        <Banner tone="success" title="Brand saved">
                            <Text as="p" variant="bodyMd">
                                Your store is now connected to <strong>{actionData.brandName}</strong>.
                            </Text>
                        </Banner>
                    )}

                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">Connect your brand</Text>
                                <Text as="p" variant="bodyMd" tone="subdued">
                                    Enter the brand name exactly as it appears in the Snug database.
                                    This is used to match your size charts to shopper references.
                                </Text>
                            </BlockStack>

                            <Form method="post">
                                <BlockStack gap="400">
                                    <TextField
                                        label="Brand name"
                                        name="brandName"
                                        placeholder="e.g. snitch, bewakoof, zara"
                                        value={brandName}
                                        onChange={handleBrandNameChange}
                                        autoComplete="off"
                                        helpText="Use lowercase. This must match the brand slug in the Snug database."
                                    />
                                    <input type="hidden" name="brandId" value="placeholder" />
                                    <InlineStack align="end">
                                        <Button
                                            variant="primary"
                                            submit
                                            loading={isSubmitting}
                                        >
                                            {currentBrandName ? "Update brand" : "Save brand"}
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
                            <Text as="h2" variant="headingMd">Brand not in the database?</Text>
                            <Text as="p" variant="bodyMd" tone="subdued">
                                If your brand is not yet in the Snug database, submit a request
                                and we will add your size charts within 48 hours.
                            </Text>
                            <Button
                                url="mailto:brands@snug.app?subject=Brand request"
                                external
                                variant="plain"
                            >
                                Request your brand
                            </Button>
                        </BlockStack>
                    </Card>
                </Layout.Section>

            </Layout>
        </Page>
    );
}