import { useState, useCallback, useMemo, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  useLoaderData,
  useActionData,
  Form,
  useNavigation,
} from "react-router";
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
  Badge,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, brandRequests } from "@snug/db";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { fetchDatabaseBrands, type MasterBrand } from "../lib/brands.server";

// Max reference brands allowed for widget baseline
const MAX_BRAND_SELECTION = 30;


export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const dbClient = db as any;
  const orgTable = organizations as any;
  const brandRequestsTable = brandRequests as any;

  const [org] = await dbClient
    .select()
    .from(orgTable)
    .where(eq(orgTable.shop, shop))
    .limit(1);

  let merchantRequests: Array<{
    id: string;
    brandName: string;
    brandWebsite: string | null;
    status: string;
    createdAt: Date;
  }> = [];

  if (org) {
    merchantRequests = await dbClient
      .select()
      .from(brandRequestsTable)
      .where(eq(brandRequestsTable.orgId, org.id))
      .orderBy(desc(brandRequestsTable.createdAt));
  }

  const brands = await fetchDatabaseBrands();
  const availableSlugs = new Set(brands.map((b) => b.slug));

  const savedSlugsRaw = org?.brandSlug ?? "";
  const selectedSlugs = savedSlugsRaw
    ? savedSlugsRaw
        .split(",")
        .map((s: string) => s.trim())
        .filter((s: string) => availableSlugs.has(s))
    : [];

  return {
    shop,
    currentBrandSlug: savedSlugsRaw,
    selectedSlugs,
    merchantRequests: merchantRequests.map((r) => ({
      ...r,
      createdAt: r.createdAt
        ? new Date(r.createdAt).toISOString()
        : new Date().toISOString(),
    })),
    org: org ? { id: org.id, widgetActive: Boolean(org.widgetActive) } : null,
    brands,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const dbClient = db as any;
  const orgTable = organizations as any;
  const brandRequestsTable = brandRequests as any;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-brands") {
    const brandSlugsRaw = (formData.get("brandSlugs") as string) || "";
    const allDbBrands = await fetchDatabaseBrands();
    const availableSlugs = new Set(allDbBrands.map((b) => b.slug));
    const slugsArray = Array.from(
      new Set(
        brandSlugsRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => availableSlugs.has(s))
      )
    );

    if (slugsArray.length === 0) {
      return {
        error: "Please select at least 1 brand for reference calibration.",
      };
    }

    if (slugsArray.length > MAX_BRAND_SELECTION) {
      return {
        error: `Maximum ${MAX_BRAND_SELECTION} reference brands allowed.`,
      };
    }

    const brandSlugString = slugsArray.join(",");

    const [existing] = await dbClient
      .select()
      .from(orgTable)
      .where(eq(orgTable.shop, shop))
      .limit(1);

    if (existing) {
      await dbClient
        .update(orgTable)
        .set({ brandSlug: brandSlugString, updatedAt: new Date() })
        .where(eq(orgTable.shop, shop));
    } else {
      await dbClient.insert(orgTable).values({
        shop,
        brandSlug: brandSlugString,
        apiKey: randomUUID(),
        planTier: "trial",
        trialRequestsRemaining: 1000,
        widgetActive: false,
      });
    }

    return {
      success: true,
      savedCount: slugsArray.length,
      savedSlugs: slugsArray,
    };
  }

  if (intent === "request-brand") {
    const brandName = formData.get("brandName") as string;
    const brandWebsite = formData.get("brandWebsite") as string;

    if (!brandName || brandName.trim().length < 2) {
      return { error: "Please enter a valid brand name." };
    }

    const [org] = await dbClient
      .select()
      .from(orgTable)
      .where(eq(orgTable.shop, shop))
      .limit(1);

    if (!org) {
      return {
        error: "Organization record not found. Please refresh the page.",
      };
    }

    await dbClient.insert(brandRequestsTable).values({
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

// SVG Icon Helpers
function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5c6ac4"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

export default function BrandSetup() {
  const { selectedSlugs: serverSelectedSlugs, merchantRequests, brands } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const isSaving =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "save-brands";
  const isSubmittingRequest =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "request-brand";

  // View mode: 'display' when configured, 'questionnaire' or 'selection' during setup
  const isAlreadyConfigured = serverSelectedSlugs.length > 0;
  const [viewMode, setViewMode] = useState<
    "display" | "questionnaire" | "selection"
  >(isAlreadyConfigured ? "display" : "questionnaire");

  // Questionnaire Answers
  const [answers, setAnswers] = useState({
    gender: "menswear",
    style: "casual",
    region: "india",
    tier: "mid",
  });

  // Selected Brands state (array of slugs, max 30)
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(
    serverSelectedSlugs.length > 0
      ? serverSelectedSlugs
      : (brands || []).filter((b) => b.verified).slice(0, 6).map((b) => b.slug),
  );

  // Search and Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [styleFilter, setStyleFilter] = useState<string>("all");
  const [showRequestModal, setShowRequestModal] = useState(false);

  useEffect(() => {
    if (serverSelectedSlugs && serverSelectedSlugs.length > 0) {
      setSelectedSlugs(serverSelectedSlugs);
      setViewMode("display");
    }
  }, [serverSelectedSlugs]);

  useEffect(() => {
    if (actionData?.success && actionData?.savedSlugs) {
      setSelectedSlugs(actionData.savedSlugs);
      setViewMode("display");
    }
  }, [actionData]);

  // Calculate Recommended Brand Slugs based on Questionnaire
  const recommendedSlugs = useMemo(() => {
    return (brands || []).filter((b) => {
      const matchesGender =
        b.gender.includes(answers.gender as any) || b.gender.includes("unisex");
      const matchesStyle = b.styles.includes(answers.style as any);
      const matchesRegion =
        answers.region === "both" ||
        b.region === "both" ||
        b.region === answers.region;
      return matchesGender || matchesStyle || matchesRegion;
    }).map((b) => b.slug);
  }, [answers, brands]);

  // Handle questionnaire completion
  const handleQuestionnaireSubmit = useCallback(() => {
    // Pre-select top recommended brands up to 15
    const initialRecommended = recommendedSlugs.slice(0, 15);
    const verifiedDefaults = (brands || []).filter((b) => b.verified).slice(0, 5).map((b) => b.slug);
    setSelectedSlugs(
      initialRecommended.length > 0
        ? initialRecommended
        : verifiedDefaults.length > 0
        ? verifiedDefaults
        : (brands || []).slice(0, 5).map((b) => b.slug),
    );
    setViewMode("selection");
  }, [recommendedSlugs, brands]);

  // Toggle brand selection with limit check
  const toggleBrand = useCallback((slug: string) => {
    setSelectedSlugs((prev) => {
      if (prev.includes(slug)) {
        return prev.filter((s) => s !== slug);
      } else {
        if (prev.length >= MAX_BRAND_SELECTION) {
          alert(`Maximum ${MAX_BRAND_SELECTION} reference brands allowed.`);
          return prev;
        }
        return [...prev, slug];
      }
    });
  }, []);

  // Filter master brands list based on search query & tag filter
  const filteredBrands = useMemo(() => {
    return (brands || []).filter((b) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        b.name.toLowerCase().includes(q) ||
        b.slug.toLowerCase().includes(q);
      const matchesCategoryFilter =
        styleFilter === "all" ||
        (styleFilter === "recommended" && recommendedSlugs.includes(b.slug)) ||
        b.styles.includes(styleFilter as any) ||
        (styleFilter === "india" && b.region === "india") ||
        (styleFilter === "global" && b.region === "global");
      return matchesSearch && matchesCategoryFilter;
    });
  }, [searchQuery, styleFilter, recommendedSlugs, brands]);

  // Active selected brands list for display view
  const activeBrands = useMemo(() => {
    const currentSlugs = actionData?.savedSlugs || serverSelectedSlugs;
    return (brands || []).filter((b) => currentSlugs.includes(b.slug));
  }, [actionData, serverSelectedSlugs, brands]);

  return (
    <Page
      title="Brand Setup"
      subtitle="Calibrate Snug's AI sizing engine against your target reference brands."
      backAction={{ url: "/app" }}
      compactTitle
    >
      <Layout>
        {/* Notifications */}
        <Layout.Section>
          <BlockStack gap="300">
            {actionData?.error && (
              <Banner tone="critical" title="Action failed">
                <Text as="p" variant="bodyMd">
                  {actionData.error}
                </Text>
              </Banner>
            )}

            {actionData?.success && (
              <Banner tone="success" title="Brand baseline saved successfully">
                <Text as="p" variant="bodyMd">
                  Connected{" "}
                  <strong>
                    {actionData?.savedCount || selectedSlugs.length} reference
                    brands
                  </strong>{" "}
                  to your store baseline.
                </Text>
              </Banner>
            )}

            {actionData?.requestSubmitted && (
              <Banner tone="success" title="Brand request submitted">
                <Text as="p" variant="bodyMd">
                  We've queued <strong>{actionData.brandName}</strong> for
                  scraping & calibration. It will be verified within 24–48
                  hours.
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Layout.Section>

        {/* MODE 1: QUESTIONNAIRE STEP */}
        {viewMode === "questionnaire" && (
          <Layout.Section>
            <Card padding="600">
              <BlockStack gap="500">
                <BlockStack gap="100">
                  <InlineStack align="space-between" blockAlign="center">
                    <Badge tone="info">Step 1 of 2 — Onboarding Wizard</Badge>
                    <Text as="span" variant="bodySm" tone="subdued">
                      Takes ~30 seconds
                    </Text>
                  </InlineStack>
                  <Text as="h2" variant="headingLg">
                    Tell us about your apparel store
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Answer a few quick questions so Snug can automatically
                    recommend the best reference brands for your sizing
                    baseline.
                  </Text>
                </BlockStack>

                <Divider />

                {/* Question 1: Demographic */}
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    1. Primary Target Demographic
                  </Text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "12px",
                    }}
                  >
                    {[
                      {
                        id: "menswear",
                        label: "Menswear",
                        desc: "Shirts, T-Shirts, Trousers",
                      },
                      {
                        id: "womenswear",
                        label: "Womenswear",
                        desc: "Tops, Dresses, Tees",
                      },
                      {
                        id: "unisex",
                        label: "Unisex / Gender-Neutral",
                        desc: "Oversized Streetwear & Tees",
                      },
                      {
                        id: "kids",
                        label: "Kids & Youth",
                        desc: "Boys & Girls Apparel",
                      },
                    ].map((opt) => (
                      <div
                        key={opt.id}
                        onClick={() =>
                          setAnswers({ ...answers, gender: opt.id })
                        }
                        style={{
                          padding: "16px",
                          borderRadius: "12px",
                          border:
                            answers.gender === opt.id
                              ? "1.5px solid #059669"
                              : "1px solid #e1e3e5",
                          background:
                            answers.gender === opt.id ? "#e4f5ea" : "#ffffff",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <Text as="h4" variant="headingSm">
                          {opt.label}
                        </Text>
                        <Text as="p" variant="bodyXs" tone="subdued">
                          {opt.desc}
                        </Text>
                      </div>
                    ))}
                  </div>
                </BlockStack>

                {/* Question 2: Garment Style */}
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    2. Apparel Aesthetic & Style
                  </Text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "12px",
                    }}
                  >
                    {[
                      {
                        id: "streetwear",
                        label: "Streetwear & Oversized",
                        desc: "Relaxed, Boxy Fits",
                      },
                      {
                        id: "casual",
                        label: "Casual & Everyday",
                        desc: "Regular Fit Tees & Shirts",
                      },
                      {
                        id: "formal",
                        label: "Formal & Tailored",
                        desc: "Slim & Workwear Fits",
                      },
                      {
                        id: "ethnic",
                        label: "Ethnic & Fusion",
                        desc: "Kurtas & Traditional",
                      },
                      {
                        id: "activewear",
                        label: "Activewear & Sports",
                        desc: "Performance & Athleisure",
                      },
                    ].map((opt) => (
                      <div
                        key={opt.id}
                        onClick={() =>
                          setAnswers({ ...answers, style: opt.id })
                        }
                        style={{
                          padding: "16px",
                          borderRadius: "12px",
                          border:
                            answers.style === opt.id
                              ? "1.5px solid #059669"
                              : "1px solid #e1e3e5",
                          background:
                            answers.style === opt.id ? "#e4f5ea" : "#ffffff",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <Text as="h4" variant="headingSm">
                          {opt.label}
                        </Text>
                        <Text as="p" variant="bodyXs" tone="subdued">
                          {opt.desc}
                        </Text>
                      </div>
                    ))}
                  </div>
                </BlockStack>

                {/* Question 3: Target Region */}
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    3. Target Market Region
                  </Text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: "12px",
                    }}
                  >
                    {[
                      {
                        id: "india",
                        label: "India D2C Focus",
                        desc: "Snitch, Bewakoof, Being Human, etc.",
                      },
                      {
                        id: "global",
                        label: "Global / Western Focus",
                        desc: "International reference curves",
                      },
                      {
                        id: "both",
                        label: "Hybrid (India + Global)",
                        desc: "Mix of local and international",
                      },
                    ].map((opt) => (
                      <div
                        key={opt.id}
                        onClick={() =>
                          setAnswers({ ...answers, region: opt.id })
                        }
                        style={{
                          padding: "16px",
                          borderRadius: "12px",
                          border:
                            answers.region === opt.id
                              ? "1.5px solid #059669"
                              : "1px solid #e1e3e5",
                          background:
                            answers.region === opt.id ? "#e4f5ea" : "#ffffff",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <Text as="h4" variant="headingSm">
                          {opt.label}
                        </Text>
                        <Text as="p" variant="bodyXs" tone="subdued">
                          {opt.desc}
                        </Text>
                      </div>
                    ))}
                  </div>
                </BlockStack>

                <InlineStack align="end" gap="300">
                  {isAlreadyConfigured && (
                    <Button
                      variant="tertiary"
                      onClick={() => setViewMode("display")}
                    >
                      Cancel & View Active Brands
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="large"
                    onClick={handleQuestionnaireSubmit}
                  >
                    Get Recommended Brands →
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* MODE 2: SELECTION & SELECTION EDITOR */}
        {viewMode === "selection" && (
          <Layout.Section>
            <Card padding="500">
              <BlockStack gap="400">
                {/* Step Header & Counter */}
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Select Reference Brands
                      </Text>
                      <Badge tone="info">Step 2 of 2</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Toggle brands to include in your sizing baseline. Select
                      up to <strong>{MAX_BRAND_SELECTION} brands</strong>.
                    </Text>
                  </BlockStack>

                  <InlineStack gap="200" blockAlign="center">
                    <Badge
                      tone={selectedSlugs.length > 0 ? "success" : "attention"}
                    >
                      {`${selectedSlugs.length} / ${MAX_BRAND_SELECTION} Selected`}
                    </Badge>
                    <Button
                      size="micro"
                      variant="tertiary"
                      onClick={() => setViewMode("questionnaire")}
                    >
                      Re-run Questionnaire
                    </Button>
                  </InlineStack>
                </InlineStack>

                <Divider />

                {/* Search Bar & Filter Chips */}
                <BlockStack gap="300">
                  <TextField
                    label="Search supported brands"
                    placeholder="e.g. Snitch, Bewakoof, Being Human..."
                    value={searchQuery}
                    onChange={(val) => setSearchQuery(val)}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setSearchQuery("")}
                  />

                  <InlineStack gap="150" wrap blockAlign="center">
                    <InlineStack gap="100" blockAlign="center">
                      <FilterIcon />
                      <Text as="span" variant="bodyXs" tone="subdued">
                        Filter by:
                      </Text>
                    </InlineStack>
                    {[
                      { id: "all", label: "All Brands" },
                      { id: "recommended", label: "Recommended for You" },
                      { id: "india", label: "India D2C" },
                      { id: "global", label: "Global Western" },
                      { id: "streetwear", label: "Streetwear" },
                      { id: "casual", label: "Casual" },
                      { id: "formal", label: "Formal" },
                    ].map((chip) => (
                      <Button
                        key={chip.id}
                        size="micro"
                        variant={
                          styleFilter === chip.id ? "primary" : "secondary"
                        }
                        onClick={() => setStyleFilter(chip.id)}
                      >
                        {chip.label}
                      </Button>
                    ))}
                  </InlineStack>
                </BlockStack>

                {/* Bulk Quick Actions */}
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyXs" tone="subdued">
                    Showing {filteredBrands.length} supported brands
                  </Text>
                  <InlineStack gap="200">
                    <Button
                      size="micro"
                      variant="tertiary"
                      onClick={() => {
                        const recs = recommendedSlugs.slice(
                          0,
                          MAX_BRAND_SELECTION,
                        );
                        setSelectedSlugs(recs);
                      }}
                    >
                      Select Top Recommended
                    </Button>
                    <Button
                      size="micro"
                      variant="tertiary"
                      onClick={() => setSelectedSlugs([])}
                    >
                      Clear All
                    </Button>
                  </InlineStack>
                </InlineStack>

                {/* Brands Selection Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: "12px",
                    maxHeight: "520px",
                    overflowY: "auto",
                    paddingRight: "4px",
                  }}
                >
                  {filteredBrands.map((brand) => {
                    const isSelected = selectedSlugs.includes(brand.slug);

                    return (
                      <div
                        key={brand.slug}
                        onClick={() => toggleBrand(brand.slug)}
                        style={{
                          border: isSelected
                            ? "1.5px solid #059669"
                            : "1px solid #e1e3e5",
                          borderRadius: "12px",
                          padding: "12px 16px",
                          background: isSelected ? "#e4f5ea" : "#ffffff",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          boxShadow: isSelected
                            ? "0 2px 8px rgba(0,128,96,0.12)"
                            : "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                        }}
                      >
                        <InlineStack gap="300" blockAlign="center">
                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "10px",
                              background: brand.color || "#111827",
                              color: "#ffffff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: "bold",
                              fontSize: "15px",
                              boxShadow: `0 2px 6px ${brand.color || "#000000"}33`,
                              flexShrink: 0,
                            }}
                          >
                            {brand.name.charAt(0).toUpperCase()}
                          </div>
                          <BlockStack gap="050">
                            <InlineStack gap="150" blockAlign="center">
                              <Text as="h4" variant="headingSm" fontWeight="bold">
                                {brand.name}
                              </Text>
                              {brand.verified && (
                                <Badge tone="success" size="small">
                                  Verified
                                </Badge>
                              )}
                            </InlineStack>
                            {brand.chartCount && brand.chartCount > 0 ? (
                              <Text as="p" variant="bodyXs" tone="subdued">
                                {brand.productCount && brand.productCount > 0
                                  ? `${brand.chartCount} charts · ${brand.productCount} items`
                                  : `${brand.chartCount} size charts in DB`}
                              </Text>
                            ) : null}
                          </BlockStack>
                        </InlineStack>

                        <div
                          style={{
                            width: "22px",
                            height: "22px",
                            borderRadius: "6px",
                            border: isSelected
                              ? "2px solid #008060"
                              : "2px solid #c9cccf",
                            background: isSelected ? "#008060" : "#ffffff",
                            color: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {isSelected && <CheckIcon />}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Form Submit Action */}
                <Form method="post">
                  <input type="hidden" name="intent" value="save-brands" />
                  <input
                    type="hidden"
                    name="brandSlugs"
                    value={selectedSlugs.join(",")}
                  />
                  <Divider />
                  <Box paddingBlockStart="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        {isAlreadyConfigured && (
                          <Button
                            variant="secondary"
                            onClick={() => setViewMode("display")}
                          >
                            Cancel
                          </Button>
                        )}
                        <Text as="p" variant="bodyLg" fontWeight="bold">
                          <strong>{selectedSlugs.length}</strong> reference{" "}
                          {selectedSlugs.length === 1 ? "brand" : "brands"}{" "}
                          ready to connect.
                        </Text>
                      </InlineStack>

                      <Button
                        variant="primary"
                        size="large"
                        submit
                        disabled={selectedSlugs.length === 0}
                        loading={isSaving}
                      >
                        Save & Connect Brands
                      </Button>
                    </InlineStack>
                  </Box>
                </Form>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* MODE 3: NORMAL DISPLAY SCREEN (Active / Configured State) */}
        {viewMode === "display" && (
          <>
            {/* Hero Summary Card */}
            <Layout.Section>
              <Card padding="500">
                <Box
                  padding="400"
                  borderRadius="300"
                  background="bg-surface-secondary"
                  borderStyle="solid"
                  borderWidth="025"
                  borderColor="border-success"
                >
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="300" blockAlign="center">
                        <div
                          style={{
                            width: "48px",
                            height: "48px",
                            borderRadius: "12px",
                            background:
                              "linear-gradient(135deg, #008060 0%, #004c3f 100%)",
                            color: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: "bold",
                            fontSize: "20px",
                            boxShadow: "0 2px 8px rgba(0, 128, 96, 0.25)",
                          }}
                        >
                          {activeBrands.length}
                        </div>
                        <BlockStack gap="050">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="h2" variant="headingLg">
                              {`${activeBrands.length} Reference Brands Connected`}
                            </Text>
                            <Badge tone="success">Active Baseline</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Sizing predictions benchmarked against your chosen
                            brand baselines.
                          </Text>
                        </BlockStack>
                      </InlineStack>

                      <InlineStack gap="200">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSelectedSlugs(activeBrands.map((b) => b.slug));
                            setViewMode("selection");
                          }}
                        >
                          Update Selection
                        </Button>
                        <Button
                          variant="tertiary"
                          onClick={() => setViewMode("questionnaire")}
                        >
                          Re-run Questionnaire
                        </Button>
                      </InlineStack>
                    </InlineStack>

                    <Divider />

                    <InlineStack
                      gap="400"
                      align="space-between"
                      blockAlign="center"
                    >
                      <InlineStack gap="200" blockAlign="center">
                        <SparklesIcon />
                        <Text as="p" variant="bodyMd" tone="subdued">
                          Snug cross-references your customer's size preferences
                          across these baseline brands to deliver high-precision
                          recommendations.
                        </Text>
                      </InlineStack>
                      <Badge tone="info">{`${activeBrands.length} / ${MAX_BRAND_SELECTION} Brands`}</Badge>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </Card>
            </Layout.Section>

            {/* Active Selected Brands Grid */}
            <Layout.Section>
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">
                        Connected Reference Brands
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Active brands powering recommendations on your
                        storefront widget.
                      </Text>
                    </BlockStack>
                    <Button
                      variant="plain"
                      onClick={() => {
                        setSelectedSlugs(activeBrands.map((b) => b.slug));
                        setViewMode("selection");
                      }}
                    >
                      Edit List
                    </Button>
                  </InlineStack>

                  <Divider />

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(240px, 1fr))",
                      gap: "14px",
                    }}
                  >
                    {activeBrands.map((brand) => (
                      <div
                        key={brand.slug}
                        style={{
                          border: "1px solid #e1e3e5",
                          borderRadius: "12px",
                          padding: "12px 16px",
                          background: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                        }}
                      >
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "10px",
                            background: brand.color || "#008060",
                            color: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: "bold",
                            fontSize: "15px",
                            boxShadow: `0 2px 6px ${brand.color || "#008060"}33`,
                            flexShrink: 0,
                          }}
                        >
                          {brand.name.charAt(0).toUpperCase()}
                        </div>
                        <BlockStack gap="050">
                          <InlineStack gap="150" blockAlign="center">
                            <Text as="h4" variant="headingSm" fontWeight="bold">
                              {brand.name}
                            </Text>
                            {brand.verified && (
                              <Badge tone="success" size="small">
                                Verified
                              </Badge>
                            )}
                          </InlineStack>
                          {brand.chartCount && brand.chartCount > 0 ? (
                            <Text as="p" variant="bodyXs" tone="subdued">
                              {brand.productCount && brand.productCount > 0
                                ? `${brand.chartCount} charts · ${brand.productCount} items`
                                : `${brand.chartCount} size charts`}
                            </Text>
                          ) : null}
                        </BlockStack>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Request Custom Brand Section */}
            <Layout.Section>
              <Card padding="500">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">
                        Can't find a specific brand?
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Request any brand not currently in our database and our
                        team will scrape and calibrate it within 24–48 hours.
                      </Text>
                    </BlockStack>
                    <Button
                      variant={showRequestModal ? "secondary" : "primary"}
                      onClick={() => setShowRequestModal(!showRequestModal)}
                    >
                      {showRequestModal
                        ? "Close Form"
                        : "Request Brand Addition"}
                    </Button>
                  </InlineStack>

                  {showRequestModal && (
                    <>
                      <Divider />
                      <Box
                        padding="400"
                        borderRadius="300"
                        borderStyle="dashed"
                        borderWidth="025"
                        borderColor="border-brand"
                      >
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="request-brand"
                          />
                          <BlockStack gap="300">
                            <TextField
                              label="Brand Name"
                              name="brandName"
                              placeholder="e.g. Rare Rabbit, Modern Crew, Rareism..."
                              autoComplete="off"
                              requiredIndicator
                            />
                            <TextField
                              label="Brand Website (Optional)"
                              name="brandWebsite"
                              placeholder="https://brandwebsite.com"
                              autoComplete="off"
                              helpText="Adding the store website helps us quickly extract the exact size charts."
                            />
                            <InlineStack align="end">
                              <Button
                                variant="primary"
                                submit
                                loading={isSubmittingRequest}
                              >
                                Submit Request
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Form>
                      </Box>
                    </>
                  )}

                  {/* Submitted Requests List */}
                  {merchantRequests && merchantRequests.length > 0 && (
                    <>
                      <Divider />
                      <Text as="h3" variant="headingSm">
                        Your Submitted Requests ({merchantRequests.length})
                      </Text>
                      <BlockStack gap="200">
                        {merchantRequests.map((reqItem) => (
                          <Box
                            key={reqItem.id}
                            padding="300"
                            borderRadius="200"
                            background="bg-surface-secondary"
                          >
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                            >
                              <BlockStack gap="050">
                                <Text
                                  as="p"
                                  variant="bodyMd"
                                  fontWeight="semibold"
                                >
                                  {reqItem.brandName}
                                </Text>
                                {reqItem.brandWebsite && (
                                  <InlineStack gap="100" blockAlign="center">
                                    <GlobeIcon />
                                    <Text
                                      as="span"
                                      variant="bodyXs"
                                      tone="subdued"
                                    >
                                      {reqItem.brandWebsite}
                                    </Text>
                                  </InlineStack>
                                )}
                              </BlockStack>
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" variant="bodyXs" tone="subdued">
                                  {new Date(
                                    reqItem.createdAt,
                                  ).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}
                                </Text>
                                {reqItem.status === "pending" ? (
                                  <InlineStack gap="050" blockAlign="center">
                                    <ClockIcon />
                                    <Badge tone="attention">
                                      Pending Review
                                    </Badge>
                                  </InlineStack>
                                ) : (
                                  <Badge tone="success">
                                    Added to Database
                                  </Badge>
                                )}
                              </InlineStack>
                            </InlineStack>
                          </Box>
                        ))}
                      </BlockStack>
                    </>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
