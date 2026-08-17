import { useState, useMemo, useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Badge,
  TextField,
  Select,
  Modal,
  Divider,
  Box,
  EmptyState,
  Tooltip,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, fitSizeCharts, garmentMappings } from "@snug/db";
import { and, eq, inArray } from "drizzle-orm";
import { pushMappingsToKV } from "../lib/kv.server";

// Standard Garment Categories
export const GARMENT_TYPES = [
  { label: "T-shirt", value: "tshirt", description: "Everyday tees and knit tops" },
  { label: "Polo", value: "polo", description: "Collared knit polos" },
];

const FIT_TYPES = [
  { label: "Slim", value: "slim" },
  { label: "Regular", value: "regular" },
  { label: "Oversized", value: "oversized" },
];

export interface CatalogProduct {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  imageUrl?: string;
  price?: string;
}

// Fallback demo products for testing when Shopify GraphQL catalog is empty or running locally
const MOCK_PRODUCTS: CatalogProduct[] = [
  {
    id: "gid://shopify/Product/819203918201",
    title: "Heavyweight Oversized Cotton Tee",
    handle: "heavyweight-oversized-cotton-tee",
    vendor: "Snug Athletics",
    imageUrl: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png",
    price: "₹1,899",
  },
  {
    id: "gid://shopify/Product/819203918202",
    title: "Relaxed Fit Linen Casual Shirt",
    handle: "relaxed-fit-linen-casual-shirt",
    vendor: "Snug Studio",
    imageUrl: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png",
    price: "₹2,499",
  },
  {
    id: "gid://shopify/Product/819203918203",
    title: "Classic Pique Cotton Polo",
    handle: "classic-pique-cotton-polo",
    vendor: "Snug Athletics",
    imageUrl: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png",
    price: "₹1,599",
  },
  {
    id: "gid://shopify/Product/819203918204",
    title: "Vintage Wash Denim Jacket",
    handle: "vintage-wash-denim-jacket",
    vendor: "Snug Supply",
    imageUrl: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png",
    price: "₹4,299",
  },
  {
    id: "gid://shopify/Product/819203918205",
    title: "Essential Pullover Fleece Hoodie",
    handle: "essential-pullover-fleece-hoodie",
    vendor: "Snug Athletics",
    imageUrl: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png",
    price: "₹2,999",
  },
  {
    id: "gid://shopify/Product/819203918206",
    title: "Handspun Cotton Casual Kurta",
    handle: "handspun-cotton-casual-kurta",
    vendor: "Snug Heritage",
    imageUrl: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png",
    price: "₹2,199",
  },
];

// Custom high-contrast, accessible button-based checkbox with SVG checkmark
function SelectionCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (newChecked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      style={{
        width: "22px",
        height: "22px",
        minWidth: "22px",
        minHeight: "22px",
        borderRadius: "5px",
        border: checked ? "2px solid #008060" : "2px solid #8c9196",
        backgroundColor: checked ? "#008060" : "#ffffff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        padding: 0,
        margin: 0,
        boxSizing: "border-box",
        flexShrink: 0,
        outline: "none",
        transition: "all 0.15s ease",
      }}
    >
      {checked && (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: "block" }}
        >
          <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      )}
    </button>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const dbClient = db as any;
  const orgTable = organizations as any;
  const fitSizeChartsTable = fitSizeCharts as any;
  const garmentMappingsTable = garmentMappings as any;

  // 1. Fetch organization
  const [org] = await dbClient
    .select()
    .from(orgTable)
    .where(eq(orgTable.shop, shop))
    .limit(1);

  if (!org) {
    return {
      hasOrg: false,
      products: MOCK_PRODUCTS,
      mappings: [],
      sizeCharts: [],
      garmentTypes: GARMENT_TYPES,
    };
  }

  // 2. Fetch existing mappings for org
  const dbMappings = await dbClient
    .select()
    .from(garmentMappingsTable)
    .where(eq(garmentMappingsTable.orgId, org.id));

  // 3. Fetch size charts created for org to allow chart-level overrides
  const dbCharts = await dbClient
    .select()
    .from(fitSizeChartsTable)
    .where(eq(fitSizeChartsTable.orgId, org.id));

  // 4. Query products from Shopify Admin GraphQL API
  let fetchedProducts: CatalogProduct[] = [];
  try {
    const response = await admin.graphql(`
      query getCatalogProducts {
        products(first: 100) {
          nodes {
            id
            title
            handle
            vendor
            featuredImage {
              url
              altText
            }
            variants(first: 1) {
              nodes {
                price
              }
            }
          }
        }
      }
    `);

    const json = await response.json();
    const nodes = json?.data?.products?.nodes;
    if (Array.isArray(nodes) && nodes.length > 0) {
      fetchedProducts = nodes.map((node: any) => ({
        id: node.id,
        title: node.title,
        handle: node.handle,
        vendor: node.vendor || "Default Vendor",
        imageUrl: node.featuredImage?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png",
        price: node.variants?.nodes?.[0]?.price ? `₹${node.variants.nodes[0].price}` : undefined,
      }));
    }
  } catch (err) {
    console.warn("[Products Loader] Shopify GraphQL fetch warning, using fallback list:", err);
  }

  // Combine live store products or fall back to mock catalog
  const productsList = fetchedProducts.length > 0 ? fetchedProducts : MOCK_PRODUCTS;

  return {
    hasOrg: true,
    products: productsList,
    mappings: dbMappings,
    sizeCharts: dbCharts,
    garmentTypes: GARMENT_TYPES,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const dbClient = db as any;
  const orgTable = organizations as any;
  const garmentMappingsTable = garmentMappings as any;

  const formData = await request.formData();
  const intent = formData.get("intent");

  const [org] = await dbClient
    .select()
    .from(orgTable)
    .where(eq(orgTable.shop, shop))
    .limit(1);

  if (!org) {
    return { error: "Organization not found. Please reinstall app." };
  }

  try {
    // Intent 1: Map single product
    if (intent === "map-product") {
      const productId = formData.get("productId") as string;
      const garmentType = formData.get("garmentType") as string;
      const fitType = (formData.get("fitType") as string) || "regular";

      if (!productId || !garmentType) {
        return { error: "Please select both a product and a garment category." };
      }
      if (!FIT_TYPES.some((fit) => fit.value === fitType)) {
        return { error: "Choose slim, regular, or oversized fit." };
      }

      const [existing] = await dbClient
        .select()
        .from(garmentMappingsTable)
        .where(
          and(
            eq(garmentMappingsTable.orgId, org.id),
            eq(garmentMappingsTable.shopifyProductId, productId)
          )
        )
        .limit(1);

      if (existing) {
        await dbClient
          .update(garmentMappingsTable)
          .set({
            garmentType,
            fitType,
            updatedAt: new Date(),
          })
          .where(eq(garmentMappingsTable.id, existing.id));
      } else {
        await dbClient.insert(garmentMappingsTable).values({
          orgId: org.id,
          shopifyProductId: productId,
          garmentType,
          fitType,
        });
      }

      try {
        await pushMappingsToKV(org.id);
      } catch (kvErr) {
        console.warn("[Products Action] KV sync notice:", kvErr);
      }

      return { success: true, message: "Product mapped successfully!" };
    }

    // Intent 2: Bulk map products
    if (intent === "bulk-map") {
      const productIdsRaw = formData.get("productIds") as string;
      const garmentType = formData.get("garmentType") as string;
      const fitType = (formData.get("fitType") as string) || "regular";

      if (!productIdsRaw || !garmentType) {
        return { error: "Please select products and a garment category for bulk mapping." };
      }
      if (!FIT_TYPES.some((fit) => fit.value === fitType)) {
        return { error: "Choose slim, regular, or oversized fit." };
      }

      let productIds: string[] = [];
      try {
        productIds = JSON.parse(productIdsRaw);
      } catch {
        return { error: "Invalid product selection data." };
      }

      if (!Array.isArray(productIds) || productIds.length === 0) {
        return { error: "No products selected for mapping." };
      }

      for (const pid of productIds) {
        const [existing] = await dbClient
          .select()
          .from(garmentMappingsTable)
          .where(
            and(
              eq(garmentMappingsTable.orgId, org.id),
              eq(garmentMappingsTable.shopifyProductId, pid)
            )
          )
          .limit(1);

        if (existing) {
          await dbClient
            .update(garmentMappingsTable)
            .set({
              garmentType,
              fitType,
              updatedAt: new Date(),
            })
            .where(eq(garmentMappingsTable.id, existing.id));
        } else {
          await dbClient.insert(garmentMappingsTable).values({
            orgId: org.id,
            shopifyProductId: pid,
            garmentType,
            fitType,
          });
        }
      }

      try {
        await pushMappingsToKV(org.id);
      } catch (kvErr) {
        console.warn("[Products Action] KV sync notice:", kvErr);
      }

      return { success: true, message: `${productIds.length} products mapped successfully!` };
    }

    // Intent 3: Delete single product mapping
    if (intent === "delete-mapping") {
      const productId = formData.get("productId") as string;
      if (productId) {
        await dbClient
          .delete(garmentMappingsTable)
          .where(
            and(
              eq(garmentMappingsTable.orgId, org.id),
              eq(garmentMappingsTable.shopifyProductId, productId)
            )
          );

        try {
          await pushMappingsToKV(org.id);
        } catch (kvErr) {
          console.warn("[Products Action] KV sync notice:", kvErr);
        }

        return { deleted: true, message: "Product mapping removed." };
      }
      return { error: "Missing product ID for removal." };
    }

    // Intent 4: Bulk delete product mappings
    if (intent === "bulk-delete-mapping") {
      const productIdsRaw = formData.get("productIds") as string;
      if (productIdsRaw) {
        let productIds: string[] = [];
        try {
          productIds = JSON.parse(productIdsRaw);
        } catch {
          return { error: "Invalid product deletion payload." };
        }

        if (Array.isArray(productIds) && productIds.length > 0) {
          await dbClient
            .delete(garmentMappingsTable)
            .where(
              and(
                eq(garmentMappingsTable.orgId, org.id),
                inArray(garmentMappingsTable.shopifyProductId, productIds)
              )
            );

          try {
            await pushMappingsToKV(org.id);
          } catch (kvErr) {
            console.warn("[Products Action] KV sync notice:", kvErr);
          }

          return { deleted: true, message: `Removed mappings for ${productIds.length} products.` };
        }
      }
      return { error: "No products specified for bulk deletion." };
    }
  } catch (err: any) {
    console.error("[Products Action Error]", err);
    return { error: err?.message || "An unexpected error occurred." };
  }

  return { error: "Unknown action" };
};

export default function ProductMappingPage() {
  const { hasOrg, products, mappings: initialMappings, sizeCharts, garmentTypes } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Local optimistic state for mappings so updates feel instant
  const [localMappings, setLocalMappings] = useState<any[]>(initialMappings || []);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Keep localMappings synced with loader data revalidation
  useEffect(() => {
    setLocalMappings(initialMappings || []);
  }, [initialMappings]);

  // Modal State for Single Mapping Edit (Mapped Products)
  const [editModalProduct, setEditModalProduct] = useState<CatalogProduct | null>(null);
  const [selectedGarmentType, setSelectedGarmentType] = useState<string>("tshirt");
  const [selectedFitType, setSelectedFitType] = useState<string>("regular");

  // Modal State for Bulk Mapping
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkGarmentType, setBulkGarmentType] = useState<string>("tshirt");
  const [bulkFitType, setBulkFitType] = useState<string>("regular");

  // Modal State for Storefront Recommender Preview
  const [previewProduct, setPreviewProduct] = useState<CatalogProduct | null>(null);

  // Map of productId -> mapping object
  const mappingMap = useMemo(() => {
    const map = new Map<string, any>();
    localMappings.forEach((m) => map.set(m.shopifyProductId, m));
    return map;
  }, [localMappings]);

  // Group size charts by garment type for easy selection
  const chartsByGarment = useMemo(() => {
    const map: Record<string, any[]> = {};
    (sizeCharts || []).forEach((chart: any) => {
      const g = chart.garmentType || "other";
      if (!map[g]) map[g] = [];
      map[g].push(chart);
    });
    return map;
  }, [sizeCharts]);

  // Filtered products list based on search and filters
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const mapping = mappingMap.get(p.id);
      const matchesSearch =
        p.title.toLowerCase().includes(searchValue.toLowerCase()) ||
        p.vendor.toLowerCase().includes(searchValue.toLowerCase()) ||
        p.id.toLowerCase().includes(searchValue.toLowerCase());

      if (!matchesSearch) return false;

      // Status Filter
      if (statusFilter === "mapped" && !mapping) return false;
      if (statusFilter === "unmapped" && mapping) return false;
      if (statusFilter === "needs_chart") {
        if (!mapping) return false;
        const availableCharts = (chartsByGarment[mapping.garmentType] || []).filter(
          (chart: any) => chart.fitType === mapping.fitType,
        );
        if (availableCharts.length > 0) return false;
      }

      // Category Filter (only filters mapped products when category is selected)
      if (categoryFilter !== "all") {
        if (mapping && mapping.garmentType !== categoryFilter) return false;
        if (!mapping && statusFilter === "mapped") return false;
      }

      return true;
    });
  }, [products, mappingMap, searchValue, statusFilter, categoryFilter, chartsByGarment]);

  // Derived 2-column split lists
  const unmappedProductsList = useMemo(() => {
    return filteredProducts.filter((p) => !mappingMap.has(p.id));
  }, [filteredProducts, mappingMap]);

  const mappedProductsList = useMemo(() => {
    return filteredProducts.filter((p) => {
      const mapping = mappingMap.get(p.id);
      if (!mapping) return false;
      if (categoryFilter !== "all" && mapping.garmentType !== categoryFilter) return false;
      return true;
    });
  }, [filteredProducts, mappingMap, categoryFilter]);

  // Metrics
  const mappedCount = useMemo(() => {
    return products.filter((p) => mappingMap.has(p.id)).length;
  }, [products, mappingMap]);

  const unmappedCount = products.length - mappedCount;
  const configuredChartsCount = (sizeCharts || []).length;

  // Stable toggle handler for selection
  const toggleProductSelection = useCallback((productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  }, []);

  // Open single edit mapping modal (for mapped products)
  const handleOpenEditModal = useCallback((product: CatalogProduct) => {
    const existing = mappingMap.get(product.id);
    setEditModalProduct(product);
    setSelectedGarmentType(existing?.garmentType || "tshirt");
    setSelectedFitType(existing?.fitType || "regular");
  }, [mappingMap]);

  // Submit Single Product Mapping
  const handleSaveSingleMapping = () => {
    if (!editModalProduct) return;

    const formData = new FormData();
    formData.set("intent", "map-product");
    formData.set("productId", editModalProduct.id);
    formData.set("garmentType", selectedGarmentType);
    formData.set("fitType", selectedFitType);

    // Optimistic local update
    setLocalMappings((prev) => {
      const filtered = prev.filter((m) => m.shopifyProductId !== editModalProduct.id);
      return [
        ...filtered,
        {
          id: String(Date.now() + Math.random()),
          shopifyProductId: editModalProduct.id,
          garmentType: selectedGarmentType,
          fitType: selectedFitType,
        },
      ];
    });

    submit(formData, { method: "post" });
    setEditModalProduct(null);
  };

  // Submit Single Product Unmap
  const handleRemoveSingleMapping = (product: CatalogProduct) => {
    const formData = new FormData();
    formData.set("intent", "delete-mapping");
    formData.set("productId", product.id);

    setLocalMappings((prev) => prev.filter((m) => m.shopifyProductId !== product.id));
    submit(formData, { method: "post" });
  };

  // Submit Bulk Mapping
  const handleSaveBulkMapping = () => {
    if (selectedProductIds.length === 0) return;

    const formData = new FormData();
    formData.set("intent", "bulk-map");
    formData.set("productIds", JSON.stringify(selectedProductIds));
    formData.set("garmentType", bulkGarmentType);
    formData.set("fitType", bulkFitType);

    // Optimistic update
    const selectedSet = new Set(selectedProductIds);
    setLocalMappings((prev) => {
      const remaining = prev.filter((m) => !selectedSet.has(m.shopifyProductId));
      const added = selectedProductIds.map((pid) => ({
        id: String(Date.now() + Math.random()),
        shopifyProductId: pid,
        garmentType: bulkGarmentType,
        fitType: bulkFitType,
      }));
      return [...remaining, ...added];
    });

    submit(formData, { method: "post" });
    setIsBulkModalOpen(false);
    setSelectedProductIds([]);
  };

  // Submit Bulk Unmap
  const handleBulkUnmap = () => {
    if (selectedProductIds.length === 0) return;

    const formData = new FormData();
    formData.set("intent", "bulk-delete-mapping");
    formData.set("productIds", JSON.stringify(selectedProductIds));

    const selectedSet = new Set(selectedProductIds);
    setLocalMappings((prev) => prev.filter((m) => !selectedSet.has(m.shopifyProductId)));
    submit(formData, { method: "post" });
    setSelectedProductIds([]);
  };

  // Select/Deselect all visible unmapped products
  const handleToggleSelectAllUnmapped = useCallback(() => {
    const unmappedIds = unmappedProductsList.map((p) => p.id);
    const allSelected = unmappedIds.length > 0 && unmappedIds.every((id) => selectedProductIds.includes(id));
    if (allSelected) {
      setSelectedProductIds((prev) => prev.filter((id) => !unmappedIds.includes(id)));
    } else {
      setSelectedProductIds((prev) => Array.from(new Set([...prev, ...unmappedIds])));
    }
  }, [unmappedProductsList, selectedProductIds]);

  const isAllUnmappedSelected = useMemo(() => {
    return (
      unmappedProductsList.length > 0 &&
      unmappedProductsList.every((p) => selectedProductIds.includes(p.id))
    );
  }, [unmappedProductsList, selectedProductIds]);

  return (
    <Page
      title="Product Size Chart Mapping"
      subtitle="Select products below and click Map Selected to connect them to your fit size charts."
      compactTitle
    >
      <Layout>
        {/* Critical Banners Only */}
        {(!hasOrg || actionData?.error) && (
          <Layout.Section>
            <BlockStack gap="300">
              {!hasOrg && (
                <Banner tone="critical" title="Organization Not Found">
                  <Text as="p" variant="bodyMd">
                    Please reinstall the Snug app to configure product size mappings.
                  </Text>
                </Banner>
              )}

              {actionData?.error && (
                <Banner tone="critical" title="Action Error">
                  <Text as="p" variant="bodyMd">{actionData.error}</Text>
                </Banner>
              )}
            </BlockStack>
          </Layout.Section>
        )}

        {/* Summary Metrics Bar */}
        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
            }}
          >
            <Card padding="400">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">Catalog Products</Text>
                <Text as="h2" variant="headingLg">{products.length}</Text>
              </BlockStack>
            </Card>

            <Card padding="400">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">Mapped to Recommender</Text>
                <InlineStack gap="150" blockAlign="center">
                  <Text as="h2" variant="headingLg">{mappedCount}</Text>
                  <Badge tone="success">{`${Math.round((mappedCount / (products.length || 1)) * 100)}%`}</Badge>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card padding="400">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">Unmapped Products</Text>
                <Text as="h2" variant="headingLg" tone={unmappedCount > 0 ? "caution" : undefined}>
                  {unmappedCount}
                </Text>
              </BlockStack>
            </Card>

            <Card padding="400">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">Active Size Charts</Text>
                <InlineStack gap="150" blockAlign="center">
                  <Text as="h2" variant="headingLg">{configuredChartsCount}</Text>
                  <Button variant="plain" url="/app/size-charts">Manage →</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* Search & Filter Bar */}
        <Layout.Section>
          <Card padding="400">
            <InlineStack align="space-between" blockAlign="center" gap="400">
              <div style={{ flex: 2, minWidth: "240px" }}>
                <TextField
                  label="Search products"
                  labelHidden
                  placeholder="Search catalog products..."
                  value={searchValue}
                  onChange={setSearchValue}
                  clearButton
                  onClearButtonClick={() => setSearchValue("")}
                  autoComplete="off"
                />
              </div>

              <InlineStack gap="300" blockAlign="center">
                <Select
                  label="Status"
                  labelHidden
                  options={[
                    { label: "All Statuses", value: "all" },
                    { label: "Unmapped Only", value: "unmapped" },
                    { label: "Mapped Only", value: "mapped" },
                    { label: "Needs Size Chart", value: "needs_chart" },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />

                <Select
                  label="Garment Category"
                  labelHidden
                  options={[
                    { label: "All Garment Types", value: "all" },
                    ...garmentTypes.map((g) => ({ label: g.label, value: g.value })),
                  ]}
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                />
              </InlineStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* 2-Column Split: Unmapped Products (Left) vs Mapped Products (Right) */}
        <Layout.Section>
          <style>{`
            .snug-column-card {
              min-height: 580px;
              max-height: 580px;
              display: flex;
              flex-direction: column;
            }
            .snug-product-scroll-container {
              flex: 1;
              max-height: 440px;
              overflow-y: auto;
              padding-right: 4px;
            }
            .snug-product-scroll-container::-webkit-scrollbar {
              width: 6px;
            }
            .snug-product-scroll-container::-webkit-scrollbar-track {
              background: #f1f2f3;
              border-radius: 4px;
            }
            .snug-product-scroll-container::-webkit-scrollbar-thumb {
              background: #c9cccf;
              border-radius: 4px;
            }
            .snug-product-scroll-container::-webkit-scrollbar-thumb:hover {
              background: #a4a9ad;
            }
            .snug-product-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              padding: 10px 12px;
              border-bottom: 1px solid #e1e3e5;
              border-radius: 8px;
              cursor: pointer;
              transition: background-color 0.15s ease;
              box-sizing: border-box;
              width: 100%;
              user-select: none;
            }
            .snug-product-row:hover {
              background-color: #f6f6f7;
            }
            .snug-product-row-selected {
              background-color: #f0f7f5 !important;
            }
          `}</style>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
              gap: "20px",
              width: "100%",
              alignItems: "stretch",
            }}
          >
            {/* COLUMN 1: UNMAPPED PRODUCTS */}
            <div className="snug-column-card">
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">Unmapped Products</Text>
                      <Badge tone="info">{`${unmappedProductsList.length}`}</Badge>
                    </InlineStack>

                    <InlineStack gap="200" blockAlign="center">
                      {unmappedProductsList.length > 0 && (
                        <Button
                          size="slim"
                          variant="tertiary"
                          onClick={handleToggleSelectAllUnmapped}
                        >
                          {isAllUnmappedSelected ? "Deselect All" : `Select All (${unmappedProductsList.length})`}
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        size="slim"
                        disabled={selectedProductIds.length === 0}
                        onClick={() => setIsBulkModalOpen(true)}
                      >
                        {selectedProductIds.length > 0 ? `Map ${selectedProductIds.length} Selected` : "Map Selected"}
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  <Text as="p" variant="bodyXs" tone="subdued">
                    Select clothes below, then click Map Selected to choose a size chart.
                  </Text>

                  <Divider />

                  <div className="snug-product-scroll-container">
                    {unmappedProductsList.length === 0 ? (
                      <EmptyState
                        heading="All Products Mapped! 🎉"
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <Text as="p" variant="bodySm">
                          Every product in this view has been connected to a size chart.
                        </Text>
                      </EmptyState>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {unmappedProductsList.map((product) => {
                          const isSelected = selectedProductIds.includes(product.id);
                          return (
                            <div
                              key={product.id}
                              className={`snug-product-row ${isSelected ? "snug-product-row-selected" : ""}`}
                              onClick={() => toggleProductSelection(product.id)}
                            >
                              {/* Left Section: Checkbox + Image + Title/Vendor */}
                              <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flex: 1 }}>
                                <SelectionCheckbox
                                  label={`Select ${product.title}`}
                                  checked={isSelected}
                                  onChange={() => toggleProductSelection(product.id)}
                                />
                                <div
                                  style={{
                                    width: "40px",
                                    height: "40px",
                                    minWidth: "40px",
                                    flexShrink: 0,
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    border: "1px solid #e1e3e5",
                                    backgroundColor: "#f6f6f7",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <img
                                    src={product.imageUrl || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"}
                                    alt={product.title}
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                </div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div
                                    style={{
                                      fontSize: "14px",
                                      fontWeight: 600,
                                      color: "#202223",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {product.title}
                                  </div>
                                  <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>
                                    Vendor: {product.vendor}
                                  </div>
                                </div>
                              </div>

                              {/* Right Section: Badge Only */}
                              <div style={{ flexShrink: 0, marginLeft: "8px" }}>
                                <Badge tone="info">Unmapped</Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </BlockStack>
              </Card>
            </div>

            {/* COLUMN 2: MAPPED PRODUCTS */}
            <div className="snug-column-card">
              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">Mapped Products</Text>
                      <Badge tone="success">{`${mappedProductsList.length}`}</Badge>
                    </InlineStack>
                  </InlineStack>

                  <Text as="p" variant="bodyXs" tone="subdued">
                    Products connected to Snug size charts and receiving storefront recommendations.
                  </Text>

                  <Divider />

                  <div className="snug-product-scroll-container">
                    {mappedProductsList.length === 0 ? (
                      <EmptyState
                        heading="No Mapped Products Yet"
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <Text as="p" variant="bodySm">
                          Select products from the unmapped column and click Map Selected to start.
                        </Text>
                      </EmptyState>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {mappedProductsList.map((product) => {
                          const mapping = mappingMap.get(product.id);
                          const garmentLabel = garmentTypes.find((g) => g.value === mapping?.garmentType)?.label || mapping?.garmentType;
                          const fitLabel = FIT_TYPES.find((fit) => fit.value === mapping?.fitType)?.label || mapping?.fitType;
                          const availableCharts = mapping
                            ? (chartsByGarment[mapping.garmentType] || []).filter((chart: any) => chart.fitType === mapping.fitType)
                            : [];

                          let statusBadge = (
                            <Badge tone="success">Ready</Badge>
                          );
                          if (availableCharts.length === 0) {
                            statusBadge = <Badge tone="attention">Needs Chart</Badge>;
                          }

                          return (
                            <div
                              key={product.id}
                              className="snug-product-row"
                              style={{ cursor: "default" }}
                            >
                              {/* Left: Image + Title + Category Badges */}
                              <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    width: "40px",
                                    height: "40px",
                                    minWidth: "40px",
                                    flexShrink: 0,
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    border: "1px solid #e1e3e5",
                                    backgroundColor: "#f6f6f7",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <img
                                    src={product.imageUrl || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"}
                                    alt={product.title}
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                </div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div
                                    style={{
                                      fontSize: "14px",
                                      fontWeight: 600,
                                      color: "#202223",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {product.title}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
                                    <Badge tone="info">{garmentLabel}</Badge>
                                    {fitLabel && <Badge>{fitLabel}</Badge>}
                                  </div>
                                </div>
                              </div>

                              {/* Right: Readiness + Action Buttons */}
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                                {statusBadge}

                                <Tooltip content="Edit garment category & size chart">
                                  <Button
                                    size="micro"
                                    variant="secondary"
                                    onClick={() => handleOpenEditModal(product)}
                                  >
                                    Edit
                                  </Button>
                                </Tooltip>

                                <Tooltip content="Preview size recommender widget on PDP">
                                  <Button
                                    size="micro"
                                    variant="tertiary"
                                    onClick={() => setPreviewProduct(product)}
                                  >
                                    👁️ Preview
                                  </Button>
                                </Tooltip>

                                <Button
                                  size="micro"
                                  variant="plain"
                                  tone="critical"
                                  onClick={() => handleRemoveSingleMapping(product)}
                                >
                                  Unmap
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </BlockStack>
              </Card>
            </div>
          </div>
        </Layout.Section>
      </Layout>

      {/* SINGLE PRODUCT MAPPING / EDIT MODAL */}
      {editModalProduct && (
        <Modal
          open={Boolean(editModalProduct)}
          onClose={() => setEditModalProduct(null)}
          title={`Edit Mapping: ${editModalProduct.title}`}
          primaryAction={{
            content: "Save Mapping",
            onAction: handleSaveSingleMapping,
            loading: isSubmitting,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setEditModalProduct(null),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "6px",
                    overflow: "hidden",
                    border: "1px solid #e1e3e5",
                    backgroundColor: "#f6f6f7",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <img
                    src={editModalProduct.imageUrl || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"}
                    alt={editModalProduct.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
                <BlockStack gap="025">
                  <Text as="p" variant="bodyLg" fontWeight="bold">{editModalProduct.title}</Text>
                  <Text as="p" variant="bodyXs" tone="subdued">Vendor: {editModalProduct.vendor}</Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              <Select
                label="Garment Category"
                options={garmentTypes.map((g) => ({
                  label: `${g.label} — (${g.description})`,
                  value: g.value,
                }))}
                value={selectedGarmentType}
                onChange={setSelectedGarmentType}
                helpText="Select the clothing category for this product so Snug calculates body ease correctly."
              />

              <Select
                label="Fit"
                options={FIT_TYPES.map((fit) => ({ label: fit.label, value: fit.value }))}
                value={selectedFitType}
                onChange={setSelectedFitType}
                helpText="Which of your size charts this product uses. Regular and oversized t-shirts are different charts."
              />

              {(chartsByGarment[selectedGarmentType] || []).filter((chart: any) => chart.fitType === selectedFitType).length === 0 && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    No {selectedFitType} size chart for <strong>{selectedGarmentType}</strong> yet. You can save this mapping now and add charts in <Button url="/app/size-charts" variant="plain">Size Charts</Button> later.
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* BULK SIZE CHARTS MAPPING MODAL */}
      {isBulkModalOpen && (
        <Modal
          open={isBulkModalOpen}
          onClose={() => setIsBulkModalOpen(false)}
          title={`Map ${selectedProductIds.length} Selected Products to Size Chart`}
          primaryAction={{
            content: `Save Mapping for ${selectedProductIds.length} Products`,
            onAction: handleSaveBulkMapping,
            loading: isSubmitting,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setIsBulkModalOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd">
                Assign a garment category and size chart guide to <strong>{selectedProductIds.length} selected clothing items</strong>:
              </Text>

              <Select
                label="Garment Category"
                options={garmentTypes.map((g) => ({
                  label: `${g.label} — (${g.description})`,
                  value: g.value,
                }))}
                value={bulkGarmentType}
                onChange={setBulkGarmentType}
                helpText="Select the garment type so Snug calculates body ease correctly."
              />

              <Select
                label="Fit"
                options={FIT_TYPES.map((fit) => ({ label: fit.label, value: fit.value }))}
                value={bulkFitType}
                onChange={setBulkFitType}
                helpText="Which size chart these products use."
              />

              {(chartsByGarment[bulkGarmentType] || []).filter((chart: any) => chart.fitType === bulkFitType).length === 0 && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    No {bulkFitType} size chart for <strong>{bulkGarmentType}</strong> yet in <Button url="/app/size-charts" variant="plain">Size Charts</Button>.
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* STOREFRONT RECOMMENDER PREVIEW MODAL */}
      {previewProduct && (
        <Modal
          open={Boolean(previewProduct)}
          onClose={() => setPreviewProduct(null)}
          title={`PDP Size Recommender Preview — ${previewProduct.title}`}
          primaryAction={{
            content: "Close Preview",
            onAction: () => setPreviewProduct(null),
          }}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p" variant="bodySm" tone="subdued">
                Live storefront preview of how shoppers experience the calibrated size recommendation widget on this product page.
              </Text>

              <div
                style={{
                  border: "1px solid #e1e3e5",
                  borderRadius: "14px",
                  padding: "24px",
                  background: "#ffffff",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
                }}
              >
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="bodyXs" fontWeight="bold" tone="subdued" as="p">
                      PRODUCT DETAIL PAGE
                    </Text>
                    <Badge tone="success">In Stock</Badge>
                  </InlineStack>

                  <Divider />

                  <BlockStack gap="050">
                    <Text variant="headingLg" as="h3">{previewProduct.title}</Text>
                    <InlineStack gap="150" blockAlign="center">
                      <Text variant="headingMd" fontWeight="bold" as="p" tone="success">
                        {previewProduct.price || "₹1,899"}
                      </Text>
                      {mappingMap.get(previewProduct.id) && (
                        <Badge tone="info">
                          {garmentTypes.find((g) => g.value === mappingMap.get(previewProduct.id)?.garmentType)?.label || "Garment"}
                        </Badge>
                      )}
                    </InlineStack>
                  </BlockStack>

                  {/* Size Selector Mock */}
                  <BlockStack gap="150">
                    <Text variant="bodySm" fontWeight="semibold" as="p">Select Garment Size:</Text>
                    <InlineStack gap="150">
                      {["S", "M", "L", "XL"].map((sz) => (
                        <div
                          key={sz}
                          style={{
                            padding: "8px 18px",
                            border: sz === "L" ? "2px solid #008060" : "1px solid #d1d5db",
                            background: sz === "L" ? "#e4f5ea" : "#ffffff",
                            borderRadius: "6px",
                            fontWeight: sz === "L" ? "bold" : "normal",
                            fontSize: "13px",
                          }}
                        >
                          {sz}
                        </div>
                      ))}
                    </InlineStack>
                  </BlockStack>

                  {/* Add to Cart */}
                  <button
                    type="button"
                    style={{
                      width: "100%",
                      padding: "14px",
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

                  {/* Calibrated Recommendation Card Mock */}
                  <div
                    style={{
                      border: "1.5px solid #059669",
                      background: "#e4f5ea",
                      borderRadius: "12px",
                      padding: "14px 16px",
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
                            }}
                          >
                            📏
                          </div>
                          <Text as="span" variant="bodyMd" fontWeight="bold">
                            Your Recommended Size: L
                          </Text>
                          <Badge tone="success">98% Fit Match</Badge>
                        </InlineStack>
                        <Button variant="plain" size="micro">Change Reference</Button>
                      </InlineStack>
                      <Text as="p" variant="bodyXs" tone="subdued">
                        Based on your Snitch T-Shirt Size L (Fits Perfect), Size L in this item provides an ideal regular fit with calibrated ease.
                      </Text>
                    </BlockStack>
                  </div>
                </BlockStack>
              </div>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
