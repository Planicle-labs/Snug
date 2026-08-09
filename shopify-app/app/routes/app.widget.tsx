import { useState, useCallback, useEffect } from "react";
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
  Divider,
  Tag,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, widgetConfigs } from "@snug/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { pushApiKeyToKV } from "../lib/kv.server";

const POSITION_OPTIONS = [
  { label: "Below size selector", value: "below_size_selector" },
  { label: "Below add to cart button", value: "below_add_to_cart" },
  { label: "Below product price", value: "below_price" },
];

const MODAL_POSITION_OPTIONS = [
  { label: "Center Overlay Modal", value: "center" },
  { label: "Bottom-Left Floating Modal", value: "bottom_left" },
];

interface MasterBrand {
  slug: string;
  name: string;
  color: string;
}

const DEFAULT_CONNECTED_BRANDS: MasterBrand[] = [
  { slug: "snitch", name: "Snitch", color: "#111827" },
  { slug: "bewakoof", name: "Bewakoof", color: "#EAB308" },
  { slug: "zara", name: "Zara", color: "#000000" },
  { slug: "hm", name: "H&M", color: "#DC2626" },
  { slug: "levis", name: "Levi's", color: "#B91C1C" },
  { slug: "nike", name: "Nike", color: "#0F172A" },
  { slug: "uniqlo", name: "Uniqlo", color: "#EF4444" },
  { slug: "roadster", name: "Roadster", color: "#1E293B" },
];

interface WidgetConfigValues {
  buttonText?: string;
  buttonColor?: string;
  buttonTextColor?: string;
  primaryColor?: string;
  modalPosition?: string;
  showConfidence?: boolean;
  showReasoning?: boolean;
}

function isWidgetConfig(value: unknown): value is WidgetConfigValues {
  return typeof value === "object" && value !== null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const dbClient = db as any;
  const orgTable = organizations as any;
  const widgetConfigsTable = widgetConfigs as any;

  const [org] = await dbClient
    .select()
    .from(orgTable)
    .where(eq(orgTable.shop, session.shop))
    .limit(1);

  if (!org) {
    return {
      widgetActive: false,
      brandSlug: null,
      config: null,
      shop: session.shop,
    };
  }

  const [existingConfig] = await dbClient
    .select()
    .from(widgetConfigsTable)
    .where(eq(widgetConfigsTable.orgId, org.id))
    .limit(1);

  return {
    widgetActive: Boolean(org.widgetActive),
    brandSlug: (org.brandSlug as string) || null,
    config: existingConfig ?? null,
    shop: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const dbClient = db as any;
  const orgTable = organizations as any;
  const widgetConfigsTable = widgetConfigs as any;

  const formData = await request.formData();
  const intent = formData.get("intent");

  const [org] = await dbClient
    .select()
    .from(orgTable)
    .where(eq(orgTable.shop, shop))
    .limit(1);

  if (!org) {
    return { error: "Organization record not found." };
  }

  if (intent === "activate") {
    await dbClient
      .update(orgTable)
      .set({ widgetActive: true, updatedAt: new Date() })
      .where(eq(orgTable.shop, shop));

    if (org.apiKey) {
      await pushApiKeyToKV({
        api_key: String(org.apiKey),
        org_id: String(org.id),
        shop: String(org.shop),
        plan_tier: (org.planTier || "trial") as "trial" | "paid",
        trial_requests_remaining: Number(org.trialRequestsRemaining ?? 1000),
        widget_active: true,
      });
    }

    return { activated: true };
  }

  if (intent === "deactivate") {
    await dbClient
      .update(orgTable)
      .set({ widgetActive: false, updatedAt: new Date() })
      .where(eq(orgTable.shop, shop));

    if (org.apiKey) {
      await pushApiKeyToKV({
        api_key: String(org.apiKey),
        org_id: String(org.id),
        shop: String(org.shop),
        plan_tier: (org.planTier || "trial") as "trial" | "paid",
        trial_requests_remaining: Number(org.trialRequestsRemaining ?? 1000),
        widget_active: false,
      });
    }

    return { deactivated: true };
  }

  if (intent === "save-config") {
    const position = (formData.get("position") as string) || "below_add_to_cart";
    const modalPosition = (formData.get("modalPosition") as string) || "center";
    const buttonText = (formData.get("buttonText") as string) || "Find Your Recommended Size";
    const buttonColor = (formData.get("buttonColor") as string) || "#008060";
    const buttonTextColor = (formData.get("buttonTextColor") as string) || "#ffffff";
    const showConfidence = formData.get("showConfidence") === "on";
    const showReasoning = formData.get("showReasoning") === "on";

    const [existing] = await dbClient
      .select()
      .from(widgetConfigsTable)
      .where(eq(widgetConfigsTable.orgId, org.id))
      .limit(1);

    const configData = {
      buttonText,
      buttonColor,
      buttonTextColor,
      modalPosition,
      showConfidence,
      showReasoning,
      primaryColor: buttonColor,
    };

    if (existing) {
      await dbClient
        .update(widgetConfigsTable)
        .set({
          position,
          isEnabled: true,
          config: configData,
          updatedAt: new Date(),
        })
        .where(eq(widgetConfigsTable.orgId, org.id));
    } else {
      await dbClient.insert(widgetConfigsTable).values({
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

  const rawConfig = isWidgetConfig(config?.config) ? config.config : {};

  // Merchant Customizer State
  const [position, setPosition] = useState(config?.position || "below_add_to_cart");
  const [modalPosition, setModalPosition] = useState(rawConfig.modalPosition || "center");
  const [buttonText, setButtonText] = useState(rawConfig.buttonText || "Find Your Recommended Size");
  const [buttonColor, setButtonColor] = useState(rawConfig.buttonColor || rawConfig.primaryColor || "#008060");
  const [buttonTextColor, setButtonTextColor] = useState(rawConfig.buttonTextColor || "#ffffff");
  const [showConfidence, setShowConfidence] = useState(rawConfig.showConfidence ?? true);
  const [showReasoning, setShowReasoning] = useState(rawConfig.showReasoning ?? true);

  // Storefront Sandbox State (State A: Uncalibrated vs State B: Calibrated)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<1 | 2 | 3>(1);
  const [shopperRef, setShopperRef] = useState<{
    brand: string;
    garment: string;
    size: string;
    fitPreference: string;
  } | null>(null);

  // Form inputs for 3-turn modal
  const [selectedRefBrand, setSelectedRefBrand] = useState("Snitch");
  const [selectedGarment, setSelectedGarment] = useState("T-Shirt");
  const [selectedRefSize, setSelectedRefSize] = useState("L");
  const [selectedFitPref, setSelectedFitPref] = useState("perfect");

  // Merchant's chosen reference brands list (local storage sync or default stub)
  const [connectedBrands, setConnectedBrands] = useState<MasterBrand[]>(DEFAULT_CONNECTED_BRANDS);

  // Local browser data saving stubs (matching app.brand.tsx pattern)
  const [isWidgetActiveLocal, setIsWidgetActiveLocal] = useState(widgetActive);
  const [mockSuccessBanner, setMockSuccessBanner] = useState(false);

  // TODO: Replace localStorage mock with production DB sync
  useEffect(() => {
    try {
      const savedBrands = localStorage.getItem("snug_selected_brands");
      if (savedBrands) {
        const parsed = JSON.parse(savedBrands);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const matched = DEFAULT_CONNECTED_BRANDS.filter((b) => parsed.includes(b.slug));
          if (matched.length > 0) setConnectedBrands(matched);
        }
      }

      const savedWidgetConfig = localStorage.getItem("snug_widget_config");
      if (savedWidgetConfig) {
        const parsedConfig = JSON.parse(savedWidgetConfig);
        if (parsedConfig.position) setPosition(parsedConfig.position);
        if (parsedConfig.modalPosition) setModalPosition(parsedConfig.modalPosition);
        if (parsedConfig.buttonText) setButtonText(parsedConfig.buttonText);
        if (parsedConfig.buttonColor) setButtonColor(parsedConfig.buttonColor);
        if (parsedConfig.buttonTextColor) setButtonTextColor(parsedConfig.buttonTextColor);
        if (typeof parsedConfig.showConfidence === "boolean") setShowConfidence(parsedConfig.showConfidence);
        if (typeof parsedConfig.showReasoning === "boolean") setShowReasoning(parsedConfig.showReasoning);
        if (typeof parsedConfig.isWidgetActive === "boolean") setIsWidgetActiveLocal(parsedConfig.isWidgetActive);
      }
    } catch (e) {
      console.warn("[WidgetCustomizer] localStorage read error:", e);
    }
  }, []);

  // TODO: Replace localStorage mock with production DB sync
  const handleSaveConfigMock = useCallback((e?: React.FormEvent) => {
    try {
      const payload = {
        position,
        modalPosition,
        buttonText,
        buttonColor,
        buttonTextColor,
        showConfidence,
        showReasoning,
        isWidgetActive: isWidgetActiveLocal,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem("snug_widget_config", JSON.stringify(payload));
      setMockSuccessBanner(true);
    } catch (err) {
      console.error("[WidgetCustomizer] localStorage save error:", err);
    }
  }, [position, modalPosition, buttonText, buttonColor, buttonTextColor, showConfidence, showReasoning, isWidgetActiveLocal]);

  // TODO: Replace localStorage mock with production DB sync
  const handleToggleActivationMock = useCallback(() => {
    const nextState = !isWidgetActiveLocal;
    setIsWidgetActiveLocal(nextState);
    try {
      const saved = localStorage.getItem("snug_widget_config");
      const existing = saved ? JSON.parse(saved) : {};
      localStorage.setItem("snug_widget_config", JSON.stringify({
        ...existing,
        isWidgetActive: nextState,
        updatedAt: new Date().toISOString(),
      }));
      setMockSuccessBanner(true);
    } catch (err) {
      console.error("[WidgetCustomizer] localStorage activation toggle error:", err);
    }
  }, [isWidgetActiveLocal]);

  // Complete modal flow -> Calibrate shopper reference
  const handleCalculateSize = useCallback(() => {
    setShopperRef({
      brand: selectedRefBrand,
      garment: selectedGarment,
      size: selectedRefSize,
      fitPreference: selectedFitPref,
    });
    setIsModalOpen(false);
  }, [selectedRefBrand, selectedGarment, selectedRefSize, selectedFitPref]);

  // Reset shopper calibration state in preview sandbox
  const handleResetShopperSandbox = useCallback(() => {
    setShopperRef(null);
    setModalStep(1);
    setIsModalOpen(false);
  }, []);

  return (
    <Page
      title="Storefront Widget Visual Customizer"
      subtitle="Configure how the Snug size recommendation widget renders on your product detail pages."
      compactTitle
    >
      <Layout>
        {/* Top Notifications */}
        {(actionData?.error || actionData?.configSaved || mockSuccessBanner) && (
          <Layout.Section>
            {actionData?.error && (
              <Banner tone="critical" title="Error">
                <Text as="p" variant="bodyMd">{actionData.error}</Text>
              </Banner>
            )}
            {(actionData?.configSaved || mockSuccessBanner) && (
              <Banner tone="success" title="Settings Saved" onDismiss={() => setMockSuccessBanner(false)}>
                <Text as="p" variant="bodyMd">
                  Your widget branding and layout settings have been saved to browser local storage.
                </Text>
              </Banner>
            )}
          </Layout.Section>
        )}

        {/* Settings & Live Interactive Sandbox Grid */}
        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))",
              gap: "20px",
              width: "100%",
              alignItems: "start",
            }}
          >
            {/* Left Column: Merchant Customizer Controls */}
            <div>
              <Card padding="500">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Widget Appearance & Position</Text>
                  <Divider />

                  <Form method="post" onSubmit={handleSaveConfigMock}>
                    <input type="hidden" name="intent" value="save-config" />
                    <BlockStack gap="400">
                      <TextField
                        label="Button Label Text (Uncalibrated State)"
                        name="buttonText"
                        value={buttonText}
                        onChange={setButtonText}
                        autoComplete="off"
                        helpText="Text shown on the initial 'Find Your Size' button before shopper enters reference"
                      />

                      <InlineStack gap="300">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Button Accent Color"
                            name="buttonColor"
                            value={buttonColor}
                            onChange={setButtonColor}
                            autoComplete="off"
                            prefix="#"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Text Color"
                            name="buttonTextColor"
                            value={buttonTextColor}
                            onChange={setButtonTextColor}
                            autoComplete="off"
                            prefix="#"
                          />
                        </div>
                      </InlineStack>

                      <Select
                        label="Product Page Button Position"
                        name="position"
                        options={POSITION_OPTIONS}
                        onChange={setPosition}
                        value={position}
                        helpText="Location of the trigger button on your Shopify product detail page"
                      />

                      <Select
                        label="Recommender Modal Overlay Position"
                        name="modalPosition"
                        options={MODAL_POSITION_OPTIONS}
                        onChange={setModalPosition}
                        value={modalPosition}
                        helpText="Choose where the 3-turn recommendation modal pops up on the shopper's screen"
                      />

                      <Divider />

                      <Text as="h3" variant="headingSm">Recommendation Options</Text>

                      <Checkbox
                        label="Display fit confidence match indicator (e.g. 98% Match)"
                        checked={showConfidence}
                        onChange={setShowConfidence}
                      />

                      <Checkbox
                        label="Display sizing calculation reasoning (e.g. chest ease details)"
                        checked={showReasoning}
                        onChange={setShowReasoning}
                      />

                      <input type="hidden" name="showConfidence" value={showConfidence ? "on" : ""} />
                      <input type="hidden" name="showReasoning" value={showReasoning ? "on" : ""} />

                      <Box paddingBlockStart="200">
                        <Button variant="primary" size="large" submit loading={isSubmitting} onClick={() => handleSaveConfigMock()}>
                          Save Customizer Settings
                        </Button>
                      </Box>
                    </BlockStack>
                  </Form>
                </BlockStack>
              </Card>
            </div>

            {/* Right Column: Live Interactive Storefront Sandbox & Deployment Status */}
            <div>
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="025">
                      <Text as="h2" variant="headingMd">Live Storefront Sandbox</Text>
                      <Text as="p" variant="bodyXs" tone="subdued">
                        Interactive preview of how shoppers experience the widget on your PDP.
                      </Text>
                    </BlockStack>

                    {shopperRef && (
                      <Button size="micro" variant="tertiary" onClick={handleResetShopperSandbox}>
                        Reset Sandbox
                      </Button>
                    )}
                  </InlineStack>

                  <Divider />

                  {/* Mock Product Page Container */}
                  <div
                    style={{
                      border: "1px solid #e1e3e5",
                      borderRadius: "12px",
                      padding: "16px 20px",
                      background: "#ffffff",
                      boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
                      position: "relative",
                    }}
                  >
                    <BlockStack gap="200">
                      {/* PDP Header Mock */}
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyXs" fontWeight="bold" tone="subdued" as="p">
                          SHOP STOREFRONT PREVIEW
                        </Text>
                        <Badge tone="success">In Stock</Badge>
                      </InlineStack>

                      <div style={{ height: "1px", background: "#f1f2f4" }} />

                      {/* Mock Product Title & Price */}
                      <BlockStack gap="025">
                        <Text variant="headingLg" as="h3">Heavyweight Oversized Cotton Tee</Text>
                        <Text variant="headingMd" fontWeight="bold" as="p" tone="success">
                          ₹1,899
                        </Text>
                      </BlockStack>

                      {/* Position: below_price */}
                      {position === "below_price" && (
                        <div style={{ margin: "4px 0" }}>
                          {renderWidgetContent()}
                        </div>
                      )}

                      {/* Mock Product Size Selector */}
                      <BlockStack gap="100">
                        <InlineStack align="space-between">
                          <Text variant="bodySm" fontWeight="semibold" as="p">Select Garment Size:</Text>
                          <Text variant="bodyXs" tone="subdued" as="span">Standard Fit</Text>
                        </InlineStack>
                        <InlineStack gap="150">
                          {["S", "M", "L", "XL"].map((sz) => {
                            const isRecommended = shopperRef?.size === sz || (!shopperRef && sz === "L");
                            return (
                              <div
                                key={sz}
                                style={{
                                  padding: "6px 16px",
                                  border: isRecommended ? "2px solid #008060" : "1px solid #d1d5db",
                                  background: isRecommended ? "#e4f5ea" : "#ffffff",
                                  borderRadius: "6px",
                                  fontWeight: isRecommended ? "bold" : "normal",
                                  fontSize: "13px",
                                  cursor: "pointer",
                                }}
                              >
                                {sz}
                              </div>
                            );
                          })}
                        </InlineStack>
                      </BlockStack>

                      {/* Position: below_size_selector */}
                      {position === "below_size_selector" && (
                        <div style={{ margin: "4px 0" }}>
                          {renderWidgetContent()}
                        </div>
                      )}

                      {/* Mock Add to Cart Button */}
                      <button
                        type="button"
                        style={{
                          width: "100%",
                          padding: "12px",
                          background: "#111827",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "8px",
                          fontWeight: 700,
                          fontSize: "14px",
                          cursor: "pointer",
                        }}
                      >
                        Add to Cart
                      </button>

                      {/* Position: below_add_to_cart */}
                      {position === "below_add_to_cart" && (
                        <div style={{ margin: "4px 0" }}>
                          {renderWidgetContent()}
                        </div>
                      )}

                      {/* Floating Modal Overlay inside Sandbox Preview */}
                      {isModalOpen && render3TurnShopperModal()}
                    </BlockStack>
                  </div>

                  <Divider />

                  {/* Widget Deployment Status Integrated Section */}
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingSm">Widget Deployment Status</Text>
                        <Badge tone={isWidgetActiveLocal ? "success" : "attention"}>
                          {isWidgetActiveLocal ? "Active on Storefront" : "Inactive"}
                        </Badge>
                      </InlineStack>
                    </InlineStack>

                    <Text as="p" variant="bodySm" tone="subdued">
                      {isWidgetActiveLocal
                        ? "The Snug recommendation widget is live and visible on your storefront product detail pages."
                        : "The Snug widget is currently turned off. Activate it to display size recommendations to shoppers."}
                    </Text>

                    {brandSlug || connectedBrands.length > 0 ? (
                      <Form method="post" onSubmit={handleToggleActivationMock}>
                        <input type="hidden" name="intent" value={isWidgetActiveLocal ? "deactivate" : "activate"} />
                        <Button
                          variant={isWidgetActiveLocal ? "secondary" : "primary"}
                          tone={isWidgetActiveLocal ? "critical" : undefined}
                          submit
                          loading={isSubmitting}
                          onClick={() => handleToggleActivationMock()}
                        >
                          {isWidgetActiveLocal ? "Deactivate Widget" : "Activate Widget"}
                        </Button>
                      </Form>
                    ) : (
                      <Button url="/app/brand" variant="plain">
                        Brand Setup →
                      </Button>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            </div>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );

  // Render Widget Indicator / Button (State A) OR Size Recommendation Card (State B)
  function renderWidgetContent() {
    // STATE B: Shopper reference added -> Show size recommendation card
    if (shopperRef) {
      return (
        <div
          style={{
            border: "1.5px solid #059669",
            background: "#e4f5ea",
            borderRadius: "12px",
            padding: "14px 16px",
            transition: "all 0.2s ease",
          }}
        >
          <BlockStack gap="150">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "6px",
                    background: "#008060",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                    fontSize: "13px",
                  }}
                >
                  📏
                </div>
                <InlineStack gap="150" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="bold">
                    {`Your Recommended Size: ${shopperRef.size}`}
                  </Text>
                  {showConfidence && <Badge tone="success">98% Fit Match</Badge>}
                </InlineStack>
              </InlineStack>

              <Button
                variant="plain"
                size="micro"
                onClick={() => {
                  setModalStep(1);
                  setIsModalOpen(true);
                }}
              >
                Change Reference
              </Button>
            </InlineStack>

            {showReasoning && (
              <Text as="p" variant="bodyXs" tone="subdued">
                Based on your <strong>{shopperRef.brand}</strong> {shopperRef.garment} (Size {shopperRef.size},{" "}
                {shopperRef.fitPreference === "perfect" ? "Fits Perfect" : shopperRef.fitPreference === "slim" ? "Runs Slim" : "Runs Oversized"}).
              </Text>
            )}
          </BlockStack>
        </div>
      );
    }

    const bgCol = buttonColor.startsWith("#") ? buttonColor : `#${buttonColor}`;
    const isLightBg = bgCol.toLowerCase() === "#ffffff" || bgCol.toLowerCase() === "#fff" || bgCol.toLowerCase() === "#f9fafb";
    const textCol = isLightBg ? "#111827" : (buttonTextColor.startsWith("#") ? buttonTextColor : `#${buttonTextColor}`);

    // STATE A: Shopper hasn't added reference -> Show "Find Your Recommended Size" button
    return (
      <button
        type="button"
        onClick={() => {
          setModalStep(1);
          setIsModalOpen(true);
        }}
        style={{
          backgroundColor: isLightBg ? "#f3f4f6" : bgCol,
          color: textCol,
          padding: "12px 20px",
          borderRadius: "8px",
          border: isLightBg ? "1px solid #d1d5db" : "none",
          fontWeight: 600,
          fontSize: "14px",
          width: "100%",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          transition: "all 0.15s ease",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10a2 2 0 002 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z" />
        </svg>
        <span>{buttonText}</span>
      </button>
    );
  }

  // Render 3-Turn Interactive Shopper Modal Overlay
  function render3TurnShopperModal() {
    const isBottomLeft = modalPosition === "bottom_left";

    return (
      <div
        style={{
          position: "absolute",
          top: isBottomLeft ? "auto" : "50%",
          bottom: isBottomLeft ? "16px" : "auto",
          left: isBottomLeft ? "16px" : "50%",
          transform: isBottomLeft ? "none" : "translate(-50%, -50%)",
          width: "90%",
          maxWidth: "420px",
          background: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)",
          zIndex: 100,
          padding: "20px",
          transition: "all 0.2s ease",
        }}
      >
        <BlockStack gap="300">
          {/* Modal Header */}
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="150" blockAlign="center">
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "6px",
                  background: "#008060",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                ✨
              </div>
              <Text as="h3" variant="headingSm">Find Your Recommended Size</Text>
            </InlineStack>

            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "18px",
                cursor: "pointer",
                color: "#6b7280",
              }}
            >
              ✕
            </button>
          </InlineStack>

          {/* Turn Progress Pills */}
          <InlineStack gap="100" blockAlign="center">
            {[1, 2, 3].map((stepNum) => (
              <div
                key={stepNum}
                style={{
                  flex: 1,
                  height: "4px",
                  borderRadius: "2px",
                  background: modalStep >= stepNum ? "#008060" : "#e5e7eb",
                  transition: "all 0.2s ease",
                }}
              />
            ))}
          </InlineStack>

          {/* TURN 1: Select Reference Brand */}
          {modalStep === 1 && (
            <BlockStack gap="200">
              <BlockStack gap="050">
                <Text as="h4" variant="bodyMd" fontWeight="bold">Turn 1 of 3: Select a Brand You Own</Text>
                <Text as="p" variant="bodyXs" tone="subdued">
                  Choose a brand from the merchant's verified baseline list:
                </Text>
              </BlockStack>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: "8px",
                  maxHeight: "200px",
                  overflowY: "auto",
                }}
              >
                {connectedBrands.map((b) => {
                  const isSel = selectedRefBrand === b.name;
                  return (
                    <div
                      key={b.slug}
                      onClick={() => setSelectedRefBrand(b.name)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: isSel ? "1.5px solid #059669" : "1px solid #e1e3e5",
                        background: isSel ? "#e4f5ea" : "#ffffff",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <div
                        style={{
                          width: "22px",
                          height: "22px",
                          borderRadius: "6px",
                          background: b.color || "#111827",
                          color: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                          fontWeight: "bold",
                        }}
                      >
                        {b.name.charAt(0)}
                      </div>
                      <Text as="span" variant="bodySm" fontWeight={isSel ? "bold" : "regular"}>
                        {b.name}
                      </Text>
                    </div>
                  );
                })}
              </div>

              <InlineStack align="end">
                <Button variant="primary" size="medium" onClick={() => setModalStep(2)}>
                  Next: Garment Type →
                </Button>
              </InlineStack>
            </BlockStack>
          )}

          {/* TURN 2: Select Garment Category */}
          {modalStep === 2 && (
            <BlockStack gap="200">
              <BlockStack gap="050">
                <Text as="h4" variant="bodyMd" fontWeight="bold">Turn 2 of 3: Select Garment Type</Text>
                <Text as="p" variant="bodyXs" tone="subdued">
                  Which item from {selectedRefBrand} do you wear?
                </Text>
              </BlockStack>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
                {[
                  { id: "T-Shirt", icon: "👕" },
                  { id: "Shirt", icon: "👔" },
                  { id: "Polo", icon: "👕" },
                  { id: "Hoodie", icon: "🧥" },
                  { id: "Jacket", icon: "🧥" },
                  { id: "Trousers", icon: "👖" },
                ].map((item) => {
                  const isSel = selectedGarment === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedGarment(item.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: isSel ? "1.5px solid #059669" : "1px solid #e1e3e5",
                        background: isSel ? "#e4f5ea" : "#ffffff",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span style={{ fontSize: "14px" }}>{item.icon}</span>
                      <Text as="span" variant="bodySm" fontWeight={isSel ? "bold" : "regular"}>
                        {item.id}
                      </Text>
                    </div>
                  );
                })}
              </div>

              <InlineStack align="space-between">
                <Button size="medium" variant="tertiary" onClick={() => setModalStep(1)}>
                  ← Back
                </Button>
                <Button variant="primary" size="medium" onClick={() => setModalStep(3)}>
                  Next: Size & Fit →
                </Button>
              </InlineStack>
            </BlockStack>
          )}

          {/* TURN 3: Select Size & Fit Preference */}
          {modalStep === 3 && (
            <BlockStack gap="200">
              <BlockStack gap="050">
                <Text as="h4" variant="bodyMd" fontWeight="bold">Turn 3 of 3: Size & Fit Preference</Text>
                <Text as="p" variant="bodyXs" tone="subdued">
                  Select your size in {selectedRefBrand} {selectedGarment}:
                </Text>
              </BlockStack>

              {/* Size Selector */}
              <InlineStack gap="150" align="center">
                {["XS", "S", "M", "L", "XL", "XXL"].map((sz) => {
                  const isSel = selectedRefSize === sz;
                  return (
                    <div
                      key={sz}
                      onClick={() => setSelectedRefSize(sz)}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "6px",
                        border: isSel ? "1.5px solid #059669" : "1px solid #d1d5db",
                        background: isSel ? "#e4f5ea" : "#ffffff",
                        fontWeight: isSel ? "bold" : "normal",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      {sz}
                    </div>
                  );
                })}
              </InlineStack>

              {/* Fit Preference Dropdown */}
              <Select
                label="How does this garment fit you?"
                options={[
                  { label: "🎯 Fits Perfect / Just Right", value: "perfect" },
                  { label: "🤏 Runs a Bit Tight / Slim", value: "slim" },
                  { label: "👕 Runs a Bit Loose / Oversized", value: "loose" },
                ]}
                value={selectedFitPref}
                onChange={setSelectedFitPref}
              />

              <InlineStack align="space-between">
                <Button size="medium" variant="tertiary" onClick={() => setModalStep(2)}>
                  ← Back
                </Button>
                <Button variant="primary" size="medium" onClick={handleCalculateSize}>
                  Calculate My Recommended Size ✨
                </Button>
              </InlineStack>
            </BlockStack>
          )}
        </BlockStack>
      </div>
    );
  }
}
