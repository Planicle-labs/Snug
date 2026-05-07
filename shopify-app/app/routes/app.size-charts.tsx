import { useState } from "react";
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
    Select,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, fitSizeCharts } from "@snug/db";
import { eq } from "drizzle-orm";
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

const FIT_TYPES = [
    { label: "Slim", value: "slim" },
    { label: "Regular", value: "regular" },
    { label: "Oversized", value: "oversized" },
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
        return { sizeCharts: [], hasOrg: false };
    }

    const sizeCharts = await db
        .select()
        .from(fitSizeCharts)
        .where(eq(fitSizeCharts.orgId, org.id));

    return { sizeCharts, hasOrg: true };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "add-size") {
        const garmentType = formData.get("garmentType") as string;
        const sizeLabel = formData.get("sizeLabel") as string;
        const fitType = formData.get("fitType") as string;
        const chestMin = formData.get("chestMin") as string;
        const chestMax = formData.get("chestMax") as string;
        const lengthMin = formData.get("lengthMin") as string;
        const lengthMax = formData.get("lengthMax") as string;
        const shoulderMin = formData.get("shoulderMin") as string;
        const shoulderMax = formData.get("shoulderMax") as string;
        const easeValue = formData.get("easeValue") as string;

        if (!garmentType || !sizeLabel || !fitType || !chestMin || !chestMax || !easeValue) {
            return { error: "Please fill in all required fields." };
        }

        const [org] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.shop, shop))
            .limit(1);

        if (!org) {
            return { error: "Organization not found. Please reinstall the app." };
        }

        try {
            await db.insert(fitSizeCharts).values({
                id: randomUUID(),
                orgId: org.id,
                garmentType,
                sizeLabel,
                fitType,
                chestMinCm: chestMin,
                chestMaxCm: chestMax,
                lengthMinCm: lengthMin || null,
                lengthMaxCm: lengthMax || null,
                shoulderMinCm: shoulderMin || null,
                shoulderMaxCm: shoulderMax || null,
                easeValueCm: easeValue,
                easeSource: "explicit",
            });
            return { success: true };
        } catch {
            return { error: "Failed to add size chart. It may already exist." };
        }
    }

    if (intent === "delete") {
        const chartId = formData.get("chartId") as string;
        
        if (chartId) {
            await db.delete(fitSizeCharts).where(eq(fitSizeCharts.id, chartId));
            return { deleted: true };
        }
    }

    return { error: "Unknown action" };
};

export default function SizeCharts() {
    const { sizeCharts, hasOrg } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    const [selectedGarmentType, setSelectedGarmentType] = useState("tshirt");
    const [sizeLabel, setSizeLabel] = useState("");
    const [fitType, setFitType] = useState("regular");
    const [chestMin, setChestMin] = useState("");
    const [chestMax, setChestMax] = useState("");
    const [lengthMin, setLengthMin] = useState("");
    const [lengthMax, setLengthMax] = useState("");
    const [shoulderMin, setShoulderMin] = useState("");
    const [shoulderMax, setShoulderMax] = useState("");
    const [easeValue, setEaseValue] = useState("");

    return (
        <Page
            title="Size Charts"
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

                    {actionData?.error && (
                        <Banner tone="critical" title="Error">
                            <Text as="p" variant="bodyMd">{actionData.error}</Text>
                        </Banner>
                    )}

                    {actionData?.success && (
                        <Banner tone="success" title="Size chart added">
                            <Text as="p" variant="bodyMd">
                                The size chart has been added successfully.
                            </Text>
                        </Banner>
                    )}

                    {actionData?.deleted && (
                        <Banner tone="success" title="Size chart deleted">
                            <Text as="p" variant="bodyMd">
                                The size chart has been deleted.
                            </Text>
                        </Banner>
                    )}

                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">Add Size Chart</Text>
                                <Text as="p" variant="bodyMd" tone="subdued">
                                    Add a single size entry. You will add more sizes for the same garment type.
                                </Text>
                            </BlockStack>

                            <Form method="post">
                                <input type="hidden" name="intent" value="add-size" />
                                <BlockStack gap="300">
                                    <InlineStack gap="300">
                                        <Select
                                            label="Garment Type"
                                            name="garmentType"
                                            options={GARMENT_TYPES}
                                            onChange={setSelectedGarmentType}
                                            value={selectedGarmentType}
                                        />
                                        <TextField
                                            label="Size Label"
                                            name="sizeLabel"
                                            placeholder="S, M, L, XL, 38, 40, etc."
                                            value={sizeLabel}
                                            onChange={setSizeLabel}
                                            autoComplete="off"
                                        />
                                        <Select
                                            label="Fit Type"
                                            name="fitType"
                                            options={FIT_TYPES}
                                            onChange={setFitType}
                                            value={fitType}
                                        />
                                    </InlineStack>
                                    <InlineStack gap="300">
                                        <TextField
                                            label="Chest Min (cm)"
                                            name="chestMin"
                                            type="number"
                                            value={chestMin}
                                            onChange={setChestMin}
                                            autoComplete="off"
                                        />
                                        <TextField
                                            label="Chest Max (cm)"
                                            name="chestMax"
                                            type="number"
                                            value={chestMax}
                                            onChange={setChestMax}
                                            autoComplete="off"
                                        />
                                        <TextField
                                            label="Ease Value (cm)"
                                            name="easeValue"
                                            type="number"
                                            value={easeValue}
                                            onChange={setEaseValue}
                                            autoComplete="off"
                                            helpText="Extra fabric beyond body measurement"
                                        />
                                    </InlineStack>
                                </BlockStack>
                                
                                <Divider />
                                
                                <BlockStack gap="200">
                                    <Text as="h3" variant="headingSm">Optional Measurements</Text>
                                    <InlineStack gap="300">
                                        <TextField
                                            label="Length Min (cm)"
                                            name="lengthMin"
                                            type="number"
                                            value={lengthMin}
                                            onChange={setLengthMin}
                                            autoComplete="off"
                                        />
                                        <TextField
                                            label="Length Max (cm)"
                                            name="lengthMax"
                                            type="number"
                                            value={lengthMax}
                                            onChange={setLengthMax}
                                            autoComplete="off"
                                        />
                                    </InlineStack>
                                    <InlineStack gap="300">
                                        <TextField
                                            label="Shoulder Min (cm)"
                                            name="shoulderMin"
                                            type="number"
                                            value={shoulderMin}
                                            onChange={setShoulderMin}
                                            autoComplete="off"
                                        />
                                        <TextField
                                            label="Shoulder Max (cm)"
                                            name="shoulderMax"
                                            type="number"
                                            value={shoulderMax}
                                            onChange={setShoulderMax}
                                            autoComplete="off"
                                        />
                                    </InlineStack>
                                </BlockStack>

                                <div style={{ marginTop: "16px" }}>
                                    <InlineStack align="end">
                                        <Button
                                            variant="primary"
                                            submit
                                            loading={isSubmitting}
                                        >
                                            Add Size
                                        </Button>
                                    </InlineStack>
                                </div>
                            </Form>

                        </BlockStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="300">
                            <Text as="h2" variant="headingMd">Your Size Charts</Text>
                            
                            {sizeCharts.length === 0 ? (
                                <Text as="p" variant="bodyMd" tone="subdued">
                                    No size charts yet. Add your first size above.
                                </Text>
                            ) : (
                                <BlockStack gap="200">
                                    {sizeCharts.map((chart) => (
                                        <InlineStack key={chart.id} align="space-between">
                                            <InlineStack gap="200">
                                                <Text as="span" fontWeight="medium">{chart.garmentType}</Text>
                                                <Text as="span">— {chart.sizeLabel}</Text>
                                                <Text as="span" tone="subdued">{chart.fitType}</Text>
                                                <Text as="span" tone="subdued">
                                                    Chest: {chart.chestMinCm} - {chart.chestMaxCm}cm
                                                </Text>
                                                <Text as="span" tone="subdued">
                                                    Ease: {chart.easeValueCm}cm
                                                </Text>
                                            </InlineStack>
                                            <Form method="post">
                                                <input type="hidden" name="intent" value="delete" />
                                                <input type="hidden" name="chartId" value={chart.id} />
                                                <Button variant="plain" submit>Delete</Button>
                                            </Form>
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