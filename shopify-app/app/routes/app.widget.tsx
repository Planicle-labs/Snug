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
  TextField,
  Box,
  Badge,
  Grid,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, widgetConfigs } from "@conveaux/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { pushApiKeyToKV } from "../lib/kv.server";

const POSITION_OPTIONS = [
  { label: "Below size selector", value: "below_size_selector" },
  { label: "Below add to cart button", value: "below_add_to_cart" },
  { label: "Below product price", value: "below_price" },
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
      shop: session.shop,
    };
  }

  const [existingConfig] = await db
    .select()
    .from(widgetConfigs)
    .where(eq(widgetConfigs.orgId, org.id))
    .limit(1);

  return {
    widgetActive: org.widgetActive || false,
    brandSlug: org.brandSlug,
    config: existingConfig || null,
    shop: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.shop, shop))
    .limit(1);

  if (!org) {
    return { error: "Organization record not found." };
  }

  if (intent === "activate") {
    await db
      .update(organizations)
      .set({ widgetActive: true, updatedAt: new Date() })
      .where(eq(organizations.shop, shop));

    if (org.apiKey) {
      await pushApiKeyToKV({
        api_key: org.apiKey,
        org_id: org.id,
        shop: org.shop,
        plan_tier: org.planTier as "trial" | "paid",
        trial_requests_remaining: org.trialRequestsRemaining,
        widget_active: true,
      });
    }

    return { activated: true };
  }

  if (intent === "deactivate") {
    await db
      .update(organizations)
      .set({ widgetActive: false, updatedAt: new Date() })
      .where(eq(organizations.shop, shop));

    if (org.apiKey) {
      await pushApiKeyToKV({
        api_key: org.apiKey,
        org_id: org.id,
        shop: org.shop,
        plan_tier: org.planTier as "trial" | "paid",
        trial_requests_remaining: org.trialRequestsRemaining,
        widget_active: false,
      });
    }

    return { deactivated: true };
  }

  if (intent === "save-config") {
    const position = (formData.get("position") as string) || "below_add_to_cart";
    const buttonText = (formData.get("buttonText") as string) || "Find Your Size";
    const buttonColor = (formData.get("buttonColor") as string) || "#000000";
    const buttonTextColor = (formData.get("buttonTextColor") as string) || "#ffffff";
    const showConfidence = formData.get("showConfidence") === "on";
    const showReasoning = formData.get("showReasoning") === "on";

    const [existing] = await db
      .select()
      .from(widgetConfigs)
      .where(eq(widgetConfigs.orgId, org.id))
      .limit(1);

    const configData = {
      buttonText,
      buttonColor,
      buttonTextColor,
      showConfidence,
      showReasoning,
      primaryColor: buttonColor,
    };

    if (existing) {
      await db
        .update(widgetConfigs)
        .set({
          position,
          isEnabled: true,
          config: configData,
          updatedAt: new Date(),
        })
        .where(eq(widgetConfigs.orgId, org.id));
    } else {
      await db.insert(widgetConfigs).values({
        id: randomUUID(),
        orgId: org.id,
        position,
        isEnabled: true,
        config: configData,
      });
    }

    return { configSaved: true };
  }

  return { error: "Unknown action" };
};

export default function WidgetCustomizer() {
  const { widgetActive, brandSlug, config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const rawConfig = typeof config?.config === "object" && config?.config !== null ? config.config as any : {};

  const [position, setPosition] = useState(config?.position || "below_add_to_cart");
  const [buttonText, setButtonText] = useState(rawConfig.buttonText || "Find Your Size");
  const [buttonColor, setButtonColor] = useState(rawConfig.buttonColor || rawConfig.primaryColor || "#000000");
  const [buttonTextColor, setButtonTextColor] = useState(rawConfig.buttonTextColor || "#ffffff");
  const [showConfidence, setShowConfidence] = useState(rawConfig.showConfidence ?? true);
  const [showReasoning, setShowReasoning] = useState(rawConfig.showReasoning ?? true);
  const [previewTab, setPreviewTab] = useState<"standard" | "boundary">("boundary");

  return (
    <Page title="Storefront Widget Visual Customizer" subtitle="Customize button branding, colors, position, and prediction options">
      <Layout>
        <Layout.Section>
          {actionData?.error && (
            <Banner tone="critical" title="Error">
              <Text as="p" variant="bodyMd">{actionData.error}</Text>
            </Banner>
          )}

          {actionData?.activated && (
            <Banner tone="success" title="Widget Activated">
              <Text as="p" variant="bodyMd">
                The Snug widget is now active and enabled on your storefront.
              </Text>
            </Banner>
          )}

          {actionData?.deactivated && (
            <Banner tone="warning" title="Widget Deactivated">
              <Text as="p" variant="bodyMd">
                The Snug widget has been temporarily turned off.
              </Text>
            </Banner>
          )}

          {actionData?.configSaved && (
            <Banner tone="success" title="Settings Saved">
              <Text as="p" variant="bodyMd">
                Your visual customizer settings have been saved and pushed to edge KV.
              </Text>
            </Banner>
          )}
        </Layout.Section>

        {/* Status Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Widget Deployment Status</Text>
                <Badge tone={widgetActive ? "success" : "attention"}>
                  {widgetActive ? "Active on Storefront" : "Inactive"}
                </Badge>
              </InlineStack>

              {brandSlug ? (
                <Form method="post">
                  <input type="hidden" name="intent" value={widgetActive ? "deactivate" : "activate"} />
                  <InlineStack gap="300">
                    <Button
                      variant={widgetActive ? "secondary" : "primary"}
                      tone={widgetActive ? "critical" : undefined}
                      submit
                      loading={isSubmitting}
                    >
                      {widgetActive ? "Deactivate Storefront Widget" : "Activate Storefront Widget"}
                    </Button>
                  </InlineStack>
                </Form>
              ) : (
                <Banner tone="warning">
                  <Text as="p" variant="bodyMd">
                    Please complete your reference brand setup before activating the widget on product pages.
                  </Text>
                  <Box paddingBefore="200">
                    <Button url="/app/brand" variant="plain">
                      Go to Brand Setup
                    </Button>
                  </Box>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Settings & Live Preview Grid */}
        <Layout.Section>
          <Grid>
            {/* Left Column: Controls */}
            <Grid.Cell columnSpan={{ xs: 12, sm: 6, md: 6, lg: 6, xl: 6 }}>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Visual & Layout Settings</Text>

                  <Form method="post">
                    <input type="hidden" name="intent" value="save-config" />
                    <BlockStack gap="400">
                      <TextField
                        label="Button Label Text"
                        name="buttonText"
                        value={buttonText}
                        onChange={setButtonText}
                        autoComplete="off"
                        helpText="Text shown on the size recommender button"
                      />

                      <InlineStack gap="400">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Button Background"
                            name="buttonColor"
                            value={buttonColor}
                            onChange={setButtonColor}
                            autoComplete="off"
                            prefix="#"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Button Text Color"
                            name="buttonTextColor"
                            value={buttonTextColor}
                            onChange={setButtonTextColor}
                            autoComplete="off"
                            prefix="#"
                          />
                        </div>
                      </InlineStack>

                      <Select
                        label="Storefront Placement"
                        name="position"
                        options={POSITION_OPTIONS}
                        onChange={setPosition}
                        value={position}
                        helpText="Target anchor section on your shop's product detail page"
                      />

                      <Checkbox
                        label="Display confidence match indicators to shoppers"
                        checked={showConfidence}
                        onChange={setShowConfidence}
                      />

                      <Checkbox
                        label="Display calculation reasoning & fit details"
                        checked={showReasoning}
                        onChange={setShowReasoning}
                      />

                      <input type="hidden" name="showConfidence" value={showConfidence ? "on" : ""} />
                      <input type="hidden" name="showReasoning" value={showReasoning ? "on" : ""} />

                      <Box paddingBefore="200">
                        <Button variant="primary" submit loading={isSubmitting}>
                          Save Customizer Settings
                        </Button>
                      </Box>
                    </BlockStack>
                  </Form>
                </BlockStack>
              </Card>
            </Grid.Cell>

            {/* Right Column: Live Interactive Preview */}
            <Grid.Cell columnSpan={{ xs: 12, sm: 6, md: 6, lg: 6, xl: 6 }}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">Live Storefront Preview</Text>
                    <InlineStack gap="200">
                      <Button
                        size="micro"
                        pressed={previewTab === "standard"}
                        onClick={() => setPreviewTab("standard")}
                      >
                        Single Match
                      </Button>
                      <Button
                        size="micro"
                        pressed={previewTab === "boundary"}
                        onClick={() => setPreviewTab("boundary")}
                      >
                        Two-Size Boundary
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  {/* Mock Product Page Container */}
                  <div style={{
                    border: "1px solid #e1e3e5",
                    borderRadius: "8px",
                    padding: "20px",
                    background: "#ffffff",
                  }}>
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="p" color="subdued">
                        Mock Product Page
                      </Text>
                      
                      <div style={{ height: "1px", background: "#e1e3e5" }} />

                      {/* Mock Product Title & Price */}
                      <BlockStack gap="100">
                        <Text variant="headingLg" as="h3">Classic Cotton Crewneck</Text>
                        <Text variant="bodyLg" fontWeight="bold" as="p">₹1,999</Text>
                      </BlockStack>

                      {/* Position: below_price */}
                      {position === "below_price" && (
                        <div style={{ margin: "8px 0" }}>
                          <button
                            type="button"
                            style={{
                              backgroundColor: buttonColor,
                              color: buttonTextColor,
                              padding: "12px 20px",
                              borderRadius: "6px",
                              border: "none",
                              fontWeight: 600,
                              fontSize: "14px",
                              width: "100%",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "8px",
                            }}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10a2 2 0 002 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z"/>
                            </svg>
                            <span>{buttonText}</span>
                          </button>
                        </div>
                      )}

                      {/* Mock Size Selectors */}
                      <BlockStack gap="100">
                        <Text variant="bodySm" fontWeight="semibold" as="p">Select Size:</Text>
                        <InlineStack gap="200">
                          {["S", "M", "L", "XL"].map((sz) => (
                            <div key={sz} style={{
                              padding: "8px 16px",
                              border: sz === "M" ? "2px solid #000000" : "1px solid #d1d5db",
                              borderRadius: "4px",
                              fontWeight: sz === "M" ? "bold" : "normal",
                              fontSize: "13px",
                            }}>
                              {sz}
                            </div>
                          ))}
                        </InlineStack>
                      </BlockStack>

                      {/* Position: below_size_selector */}
                      {position === "below_size_selector" && (
                        <div style={{ margin: "8px 0" }}>
                          <button
                            type="button"
                            style={{
                              backgroundColor: buttonColor,
                              color: buttonTextColor,
                              padding: "12px 20px",
                              borderRadius: "6px",
                              border: "none",
                              fontWeight: 600,
                              fontSize: "14px",
                              width: "100%",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "8px",
                            }}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10a2 2 0 002 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z"/>
                            </svg>
                            <span>{buttonText}</span>
                          </button>
                        </div>
                      )}

                      {/* Mock Add to Cart Button */}
                      <button type="button" style={{
                        width: "100%",
                        padding: "14px",
                        background: "#111827",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "6px",
                        fontWeight: 700,
                        fontSize: "14px",
                      }}>
                        Add to Cart
                      </button>

                      {/* Position: below_add_to_cart */}
                      {position === "below_add_to_cart" && (
                        <div style={{ margin: "8px 0" }}>
                          <button
                            type="button"
                            style={{
                              backgroundColor: buttonColor,
                              color: buttonTextColor,
                              padding: "12px 20px",
                              borderRadius: "6px",
                              border: "none",
                              fontWeight: 600,
                              fontSize: "14px",
                              width: "100%",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "8px",
                            }}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10a2 2 0 002 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z"/>
                            </svg>
                            <span>{buttonText}</span>
                          </button>
                        </div>
                      )}

                      {/* Modal Prediction Result Card Preview */}
                      <div style={{
                        marginTop: "12px",
                        background: "#f9fafb",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        padding: "16px",
                        textAlign: "center",
                      }}>
                        {previewTab === "boundary" ? (
                          <BlockStack gap="200">
                            <Text variant="bodyMd" fontWeight="bold" as="p">
                              You sit right between two sizes!
                            </Text>
                            <Text variant="bodyXs" color="subdued" as="p">
                              Choose your preferred fit style:
                            </Text>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <div style={{
                                flex: 1,
                                border: "2px solid #2563eb",
                                borderRadius: "6px",
                                padding: "10px",
                                background: "#eff6ff",
                              }}>
                                <Text variant="headingMd" as="h4">M</Text>
                                <Text variant="bodyXs" color="subdued" as="p">Snug Fit</Text>
                              </div>
                              <div style={{
                                flex: 1,
                                border: "1px solid #e5e7eb",
                                borderRadius: "6px",
                                padding: "10px",
                                background: "#ffffff",
                              }}>
                                <Text variant="headingMd" as="h4">L</Text>
                                <Text variant="bodyXs" color="subdued" as="p">Relaxed Fit</Text>
                              </div>
                            </div>
                            {showConfidence && (
                              <Badge status="success">● High Confidence (88%)</Badge>
                            )}
                          </BlockStack>
                        ) : (
                          <BlockStack gap="100">
                            <Text variant="bodySm" color="subdued" as="p">
                              Recommended Size for You
                            </Text>
                            <div style={{
                              fontSize: "28px",
                              fontWeight: 800,
                              color: "#111827",
                              background: "#ffffff",
                              display: "inline-block",
                              padding: "6px 20px",
                              borderRadius: "6px",
                              border: "1px solid #e5e7eb",
                              margin: "6px auto",
                            }}>
                              M
                            </div>
                            {showReasoning && (
                              <Text variant="bodyXs" color="subdued" as="p">
                                Fits well based on chest measurement alignment
                              </Text>
                            )}
                            {showConfidence && (
                              <Badge status="success">● High Confidence Match</Badge>
                            )}
                          </BlockStack>
                        )}
                      </div>
                    </BlockStack>
                  </div>
                </BlockStack>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>
      </Layout>
    </Page>
  );
}