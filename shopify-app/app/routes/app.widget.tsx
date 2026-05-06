import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    Button,
    Banner,
    InlineStack,
    Select,
    Checkbox,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, widgetConfigs } from "../schema.server";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const POSITION_OPTIONS = [
    { label: "Below size selector", value: "below_size_selector" },
    { label: "Below add to cart", value: "below_add_to_cart" },
    { label: "Below price", value: "below_price" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);

    const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.shop, session.shop))
        .limit(1);

    if (!org) {
        return { 
            widgetActive: false, 
            brandSlug: null,
            config: null,
        };
    }

    const [config] = await db
        .select()
        .from(widgetConfigs)
        .where(eq(widgetConfigs.orgId, org.id))
        .limit(1);

    return { 
        widgetActive: org.widgetActive || false,
        brandSlug: org.brandSlug,
        config: config || null,
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "activate") {
        const [org] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.shop, shop))
            .limit(1);

        if (org) {
            await db
                .update(organizations)
                .set({ widgetActive: true, updatedAt: new Date() })
                .where(eq(organizations.shop, shop));
        }

        return { activated: true };
    }

    if (intent === "deactivate") {
        const [org] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.shop, shop))
            .limit(1);

        if (org) {
            await db
                .update(organizations)
                .set({ widgetActive: false, updatedAt: new Date() })
                .where(eq(organizations.shop, shop));
        }

        return { deactivated: true };
    }

    if (intent === "save-config") {
        const position = formData.get("position") as string;
        const showConfidence = formData.get("showConfidence") === "on";
        const showReasoning = formData.get("showReasoning") === "on";

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
            .from(widgetConfigs)
            .where(eq(widgetConfigs.orgId, org.id))
            .limit(1);

        const config = {
            showConfidence,
            showReasoning,
            primaryColor: "#000000",
            buttonText: "Find my size",
        };

        if (existing) {
            await db
                .update(widgetConfigs)
                .set({ 
                    position, 
                    isEnabled: true,
                    config,
                    updatedAt: new Date() 
                })
                .where(eq(widgetConfigs.orgId, org.id));
        } else {
            await db.insert(widgetConfigs).values({
                id: randomUUID(),
                orgId: org.id,
                position,
                isEnabled: true,
                config,
            });
        }

        return { configSaved: true };
    }

    return { error: "Unknown action" };
};

export default function Widget() {
    const { widgetActive, brandSlug, config } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    const [position, setPosition] = useState(config?.position || "below_add_to_cart");
    const [showConfidence, setShowConfidence] = useState(
        typeof config?.config === "object" && config?.config !== null 
            ? (config.config as {showConfidence?: boolean}).showConfidence ?? true 
            : true
    );
    const [showReasoning, setShowReasoning] = useState(
        typeof config?.config === "object" && config?.config !== null
            ? (config.config as {showReasoning?: boolean}).showReasoning ?? false
            : false
    );

    return (
        <Page
            title="Widget"
            backAction={{ url: "/app" }}
        >
            <Layout>
                <Layout.Section>

                    {actionData?.error && (
                        <Banner tone="critical" title="Error">
                            <Text as="p" variant="bodyMd">{actionData.error}</Text>
                        </Banner>
                    )}

                    {actionData?.activated && (
                        <Banner tone="success" title="Widget activated">
                            <Text as="p" variant="bodyMd">
                                The widget is now active on your store.
                            </Text>
                        </Banner>
                    )}

                    {actionData?.deactivated && (
                        <Banner tone="warning" title="Widget deactivated">
                            <Text as="p" variant="bodyMd">
                                The widget has been turned off.
                            </Text>
                        </Banner>
                    )}

                    {actionData?.configSaved && (
                        <Banner tone="success" title="Settings saved">
                            <Text as="p" variant="bodyMd">
                                Your widget settings have been saved.
                            </Text>
                        </Banner>
                    )}

                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <InlineStack align="space-between">
                                <Text as="h2" variant="headingMd">Widget Status</Text>
                                <Text as="span" tone={widgetActive ? "success" : undefined}>
                                    {widgetActive ? "Active" : "Inactive"}
                                </Text>
                            </InlineStack>
                            
                            {brandSlug ? (
                                <Form method="post">
                                    <input type="hidden" name="intent" value={widgetActive ? "deactivate" : "activate"} />
                                    <InlineStack gap="300">
                                        <Button
                                            variant="primary"
                                            submit
                                            loading={isSubmitting}
                                        >
                                            {widgetActive ? "Deactivate Widget" : "Activate Widget"}
                                        </Button>
                                    </InlineStack>
                                </Form>
                            ) : (
                                <Banner tone="warning">
                                    <Text as="p" variant="bodyMd">
                                        Set up your brand before activating the widget.
                                    </Text>
                                    <Button url="/app/brand" variant="plain">
                                        Go to Brand Setup
                                    </Button>
                                </Banner>
                            )}
                        </BlockStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">Widget Settings</Text>
                            
                            <Form method="post">
                                <input type="hidden" name="intent" value="save-config" />
                                <BlockStack gap="300">
                                    <Select
                                        label="Widget Position"
                                        name="position"
                                        options={POSITION_OPTIONS}
                                        onChange={setPosition}
                                        value={position}
                                        helpText="Where the widget appears on product pages"
                                    />
                                    
                                    <Checkbox
                                        label="Show confidence score to shoppers"
                                        checked={showConfidence}
                                        onChange={setShowConfidence}
                                    />
                                    
                                    <Checkbox
                                        label="Show How did we calculate this? link"
                                        checked={showReasoning}
                                        onChange={setShowReasoning}
                                    />

                                    <input type="hidden" name="showConfidence" value={showConfidence ? "on" : ""} />
                                    <input type="hidden" name="showReasoning" value={showReasoning ? "on" : ""} />

                                    <InlineStack align="end">
                                        <Button
                                            variant="primary"
                                            submit
                                            loading={isSubmitting}
                                        >
                                            Save Settings
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
                            <Text as="h2" variant="headingMd">Preview</Text>
                            <Text as="p" variant="bodyMd" tone="subdued">
                                This is how the widget will appear on your product pages:
                            </Text>
                            
                            <div style={{ 
                                border: "1px solid #e1e3e5", 
                                borderRadius: "8px", 
                                padding: "16px",
                                background: "#f6f6f7",
                            }}>
                                <BlockStack gap="200">
                                    <Text as="p" variant="headingSm">
                                        What size should I buy?
                                    </Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        Tell us what you wear in another brand
                                    </Text>
                                    
                                    <div style={{ 
                                        display: "grid", 
                                        gap: "8px",
                                        marginTop: "8px",
                                    }}>
                                        <select disabled style={{ padding: "8px", borderRadius: "4px" }}>
                                            <option>Select brand...</option>
                                        </select>
                                        <select disabled style={{ padding: "8px", borderRadius: "4px" }}>
                                            <option>Select garment...</option>
                                        </select>
                                        <select disabled style={{ padding: "8px", borderRadius: "4px" }}>
                                            <option>Select size...</option>
                                        </select>
                                    </div>
                                    
                                    <Button variant="primary" disabled>
                                        Find my size
                                    </Button>
                                </BlockStack>
                            </div>
                        </BlockStack>
                    </Card>
                </Layout.Section>

            </Layout>
        </Page>
    );
}