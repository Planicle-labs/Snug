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
    Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, brandRequests } from "../schema.server";
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
        currentBrandSlug: org?.brandSlug ?? null,
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "search") {
        const brandName = formData.get("brandName") as string;
        
        if (!brandName || brandName.trim().length < 2) {
            return { error: "Please enter at least 2 characters to search." };
        }

        const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
        if (!workerUrl) {
            return { error: "Worker not configured. Please set CLOUDFLARE_WORKER_URL." };
        }

        try {
            const response = await fetch(`${workerUrl}/v1/brands/search?q=${encodeURIComponent(brandName.trim())}`, {
                headers: { " Accept": "application/json" },
            });
            
            if (!response.ok) {
                return { error: "Unable to search brands. Please try again." };
            }

            const data = await response.json();
            return { searchResults: data.brands || [] };
        } catch (err) {
            return { error: "Failed to search brands. Please try again." };
        }
    }

    if (intent === "save-brand") {
        const brandSlug = formData.get("brandSlug") as string;
        const brandName = formData.get("brandName") as string;

        if (!brandSlug || !brandName) {
            return { error: "Please select a brand." };
        }

        const [existing] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.shop, shop))
            .limit(1);

        if (existing) {
            await db
                .update(organizations)
                .set({ brandSlug, updatedAt: new Date() })
                .where(eq(organizations.shop, shop));
        } else {
            await db.insert(organizations).values({
                shop,
                brandSlug,
                apiKey: randomUUID(),
                planTier: "free",
                usageRemaining: 500,
                widgetActive: false,
            });
        }

        return { success: true, brandSlug, brandName };
    }

    if (intent === "request-brand") {
        const brandName = formData.get("brandName") as string;
        const brandWebsite = formData.get("brandWebsite") as string;

        if (!brandName) {
            return { error: "Please enter the brand name." };
        }

        const [org] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.shop, shop))
            .limit(1);

        if (!org) {
            return { error: "Organization not found. Please reinstall the app." };
        }

        await db.insert(brandRequests).values({
            id: randomUUID(),
            orgId: org.id,
            brandName: brandName.trim(),
            brandWebsite: brandWebsite?.trim() || null,
            status: "pending",
        });

        return { requestSubmitted: true, brandName };
    }

    return { error: "Unknown action" };
};

export default function BrandSetup() {
    const { currentBrandSlug } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";
    
    const [brandName, setBrandName] = useState("");
    const [selectedBrand, setSelectedBrand] = useState<{slug: string; name: string} | null>(null);
    const [showRequestForm, setShowRequestForm] = useState(false);
    const [searchPerformed, setSearchPerformed] = useState(false);

    const handleBrandNameChange = useCallback((value: string) => setBrandName(value), []);
    const handleSearch = useCallback(() => {
        setSearchPerformed(true);
        setSelectedBrand(null);
        setShowRequestForm(false);
    }, []);

    const searchResults = actionData?.searchResults as Array<{slug: string; name: string}> | undefined;
    const hasResults = searchResults && searchResults.length > 0;

    return (
        <Page
            title="Brand Setup"
            backAction={{ url: "/app" }}
        >
            <Layout>
                <Layout.Section>

                    {currentBrandSlug && !actionData?.success && (
                        <Banner tone="success" title="Brand connected">
                            <Text as="p" variant="bodyMd">
                                Your store is connected to <strong>{currentBrandSlug}</strong>.
                            </Text>
                        </Banner>
                    )}

                    {actionData?.error && (
                        <Banner tone="critical" title="Error">
                            <Text as="p" variant="bodyMd">{actionData.error}</Text>
                        </Banner>
                    )}

                    {actionData?.success && (
                        <Banner tone="success" title="Brand saved">
                            <Text as="p" variant="bodyMd">
                                Your store is now connected to <strong>{actionData.brandSlug}</strong>.
                            </Text>
                        </Banner>
                    )}

                    {actionData?.requestSubmitted && (
                        <Banner tone="success" title="Request submitted">
                            <Text as="p" variant="bodyMd">
                                We have received your request for <strong>{actionData.brandName}</strong>. 
                                We will add it to our database within 48 hours.
                            </Text>
                        </Banner>
                    )}

                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">Search your brand</Text>
                                <Text as="p" variant="bodyMd" tone="subdued">
                                    Enter your brand name to search the Snug database. 
                                    If found, you can connect it for size recommendations.
                                </Text>
                            </BlockStack>

                            <Form method="post">
                                <input type="hidden" name="intent" value="search" />
                                <BlockStack gap="300">
                                    <TextField
                                        label="Brand name"
                                        name="brandName"
                                        placeholder="e.g. snitch, bewakoof, zara"
                                        value={brandName}
                                        onChange={handleBrandNameChange}
                                        autoComplete="off"
                                        helpText="Enter your brand name in lowercase."
                                    />
                                    <InlineStack align="end">
                                        <Button
                                            variant="primary"
                                            submit
                                            loading={isSubmitting}
                                            onClick={handleSearch}
                                        >
                                            Search
                                        </Button>
                                    </InlineStack>
                                </BlockStack>
                            </Form>

                            {hasResults && (
                                <>
                                    <Divider />
                                    <BlockStack gap="200">
                                        <Text as="h3" variant="headingSm">Select your brand</Text>
                                        <Form method="post">
                                            <input type="hidden" name="intent" value="save-brand" />
                                            {searchResults.map((brand) => (
                                                <input
                                                    key={brand.slug}
                                                    type="radio"
                                                    name="brandSlug"
                                                    value={brand.slug}
                                                    checked={selectedBrand?.slug === brand.slug}
                                                    onChange={() => {
                                                        setSelectedBrand({ slug: brand.slug, name: brand.name });
                                                        setBrandName(brand.name);
                                                    }}
                                                />
                                            ))}
                                            <div style={{ marginTop: "12px" }}>
                                                <input type="hidden" name="brandName" value={selectedBrand?.name || brandName} />
                                                <Button
                                                    variant="primary"
                                                    submit
                                                    disabled={!selectedBrand}
                                                    loading={isSubmitting}
                                                >
                                                    Connect Brand
                                                </Button>
                                            </div>
                                        </Form>
                                    </BlockStack>
                                </>
                            )}

                            {searchPerformed && !hasResults && !showRequestForm && (
                                <>
                                    <Divider />
                                    <BlockStack gap="300">
                                        <Text as="p" variant="bodyMd" tone="subdued">
                                            Your brand was not found. Would you like to request it?
                                        </Text>
                                        <Button variant="plain" onClick={() => setShowRequestForm(true)}>
                                            Request this brand
                                        </Button>
                                    </BlockStack>
                                </>
                            )}

                            {showRequestForm && (
                                <>
                                    <Divider />
                                    <BlockStack gap="200">
                                        <Text as="h3" variant="headingSm">Request a brand</Text>
                                        <Form method="post">
                                            <input type="hidden" name="intent" value="request-brand" />
                                            <BlockStack gap="300">
                                                <TextField
                                                    label="Brand name"
                                                    name="brandName"
                                                    value={brandName}
                                                    onChange={handleBrandNameChange}
                                                    autoComplete="off"
                                                />
                                                <TextField
                                                    label="Brand website (optional)"
                                                    name="brandWebsite"
                                                    placeholder="https://yourbrand.com"
                                                    autoComplete="off"
                                                />
                                                <InlineStack align="end">
                                                    <Button
                                                        variant="primary"
                                                        submit
                                                        loading={isSubmitting}
                                                    >
                                                        Submit Request
                                                    </Button>
                                                </InlineStack>
                                            </BlockStack>
                                        </Form>
                                    </BlockStack>
                                </>
                            )}

                        </BlockStack>
                    </Card>
                </Layout.Section>

            </Layout>
        </Page>
    );
}