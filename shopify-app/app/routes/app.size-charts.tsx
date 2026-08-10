import { useMemo, useState, type ChangeEvent } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, Form } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, fitSizeCharts } from "@snug/db";
import { and, eq } from "drizzle-orm";
import { pushChartToKV } from "../lib/kv.server";
import styles from "../styles/size-charts.module.css";

const GENDERS = [
  { label: "Men", value: "men", description: "Sizing for men’s garments", mark: "M" },
  { label: "Women", value: "women", description: "Sizing for women’s garments", mark: "W" },
  { label: "Unisex", value: "unisex", description: "One guide for every shopper", mark: "U" },
] as const;

const GARMENT_TYPES = [
  { label: "T-shirt", value: "tshirt", description: "Everyday tees and knit tops" },
  { label: "Shirt", value: "shirt", description: "Button-down and formal shirts" },
  { label: "Polo", value: "polo", description: "Collared knit polos" },
  { label: "Sweatshirt", value: "sweatshirt", description: "Crewneck sweatshirts" },
  { label: "Hoodie", value: "hoodie", description: "Hooded sweatshirts" },
  { label: "Jacket", value: "jacket", description: "Outerwear and jackets" },
  { label: "Kurta", value: "kurta", description: "Kurtas and long tops" },
  { label: "Top", value: "top", description: "Other tops" },
] as const;

const FIT_TYPES = [
  { label: "Slim", value: "slim", description: "Closer to the body" },
  { label: "Regular", value: "regular", description: "Balanced everyday fit" },
  { label: "Oversized", value: "oversized", description: "Extra room and drape" },
];

const DEFAULT_EASE: Record<string, number> = {
  slim: 5,
  regular: 8,
  oversized: 19,
};

type Gender = (typeof GENDERS)[number]["value"];

type DraftSize = {
  id: string;
  sizeLabel: string;
  chest: string;
  length: string;
  shoulder: string;
};

type MeasurementUnit = "cm" | "in";

function convertMeasurement(value: string, from: MeasurementUnit, to: MeasurementUnit) {
  if (!value || from === to) return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const converted = from === "cm" ? number / 2.54 : number * 2.54;
  return String(Math.round(converted * 100) / 100);
}

function newSizeRow(sizeLabel = ""): DraftSize {
  return { id: crypto.randomUUID(), sizeLabel, chest: "", length: "", shoulder: "" };
}

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeCsvHeader(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function columnIndex(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.includes(normalizeCsvHeader(header)));
}

function parseSizeCsv(source: string): DraftSize[] {
  const rows = parseCsvRows(source);
  if (rows.length < 2) throw new Error("Your CSV needs a header row and at least one size.");

  const headers = rows[0];
  const sizeColumn = columnIndex(headers, ["size", "sizelabel"]);
  const chestColumn = columnIndex(headers, ["chest", "chestcm"]);
  const lengthColumn = columnIndex(headers, ["length", "lengthcm"]);
  const shoulderColumn = columnIndex(headers, ["shoulder", "shouldercm"]);

  if (sizeColumn < 0 || chestColumn < 0 || lengthColumn < 0) {
    throw new Error("Use the Size, Chest, and Length column headings from the Snug template.");
  }

  const sizes = rows.slice(1).map((row) => ({
    id: crypto.randomUUID(),
    sizeLabel: row[sizeColumn]?.trim().toUpperCase() ?? "",
    chest: row[chestColumn]?.trim() ?? "",
    length: row[lengthColumn]?.trim() ?? "",
    shoulder: shoulderColumn < 0 ? "" : row[shoulderColumn]?.trim() ?? "",
  }));

  if (!sizes.length || sizes.some((size) => !size.sizeLabel || !size.chest || !size.length)) {
    throw new Error("Every imported row needs a size, chest, and length measurement.");
  }
  return sizes;
}

function guideGender(value: unknown): Gender {
  if (typeof value === "object" && value !== null && "guideGender" in value) {
    const gender = (value as { guideGender?: unknown }).guideGender;
    if (gender === "men" || gender === "women" || gender === "unisex") return gender;
  }
  return "unisex";
}

function titleForGuide(gender: Gender, garmentType: string) {
  const genderLabel = GENDERS.find((item) => item.value === gender)?.label ?? "Unisex";
  const garmentLabel = GARMENT_TYPES.find((item) => item.value === garmentType)?.label ?? garmentType;
  return `${genderLabel}’s ${garmentLabel}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const dbClient = db as any;

  const [org] = await dbClient
    .select()
    .from(organizations as any)
    .where(eq((organizations as any).shop, session.shop))
    .limit(1);

  if (!org) return { sizeCharts: [], hasOrg: false };

  const sizeCharts = await dbClient
    .select()
    .from(fitSizeCharts as any)
    .where(eq((fitSizeCharts as any).orgId, org.id));

  return { sizeCharts, hasOrg: true };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const dbClient = db as any;

  if (intent === "save-guide") {
    const gender = formData.get("gender");
    const garmentType = formData.get("garmentType");
    const fitType = formData.get("fitType");
    const useManualEase = formData.get("useManualEase") === "true";
    const manualEase = formData.get("easeValue");
    const measurementUnit = formData.get("measurementUnit");
    const rawSizes = formData.get("sizes");

    if (
      (gender !== "men" && gender !== "women" && gender !== "unisex") ||
      !GARMENT_TYPES.some((item) => item.value === garmentType) ||
      !FIT_TYPES.some((item) => item.value === fitType) ||
      (measurementUnit !== "cm" && measurementUnit !== "in") ||
      typeof rawSizes !== "string"
    ) {
      return { error: "Choose a gender, garment type, fit, and at least one valid size." };
    }

    let sizes: DraftSize[];
    try {
      sizes = JSON.parse(rawSizes) as DraftSize[];
    } catch {
      return { error: "We could not read your size rows. Please try again." };
    }

    const parsedSizes = sizes.map((size) => ({
      sizeLabel: typeof size.sizeLabel === "string" ? size.sizeLabel.trim().toUpperCase() : "",
      chest: Number(size.chest) * (measurementUnit === "in" ? 2.54 : 1),
      length: Number(size.length) * (measurementUnit === "in" ? 2.54 : 1),
      shoulder: size.shoulder === "" ? null : Number(size.shoulder) * (measurementUnit === "in" ? 2.54 : 1),
    }));

    if (
      parsedSizes.length === 0 ||
      parsedSizes.some((size) => !size.sizeLabel || !Number.isFinite(size.chest) || size.chest <= 0 || !Number.isFinite(size.length) || size.length <= 0 || (size.shoulder !== null && (!Number.isFinite(size.shoulder) || size.shoulder <= 0))) ||
      new Set(parsedSizes.map((size) => size.sizeLabel)).size !== parsedSizes.length
    ) {
      return { error: "Every size needs a unique label plus valid chest and length measurements." };
    }

    const easeValue = useManualEase ? Number(manualEase) * (measurementUnit === "in" ? 2.54 : 1) : DEFAULT_EASE[String(fitType)] ?? 0;
    if (!Number.isFinite(easeValue) || easeValue <= 0) {
      return { error: "Enter a valid ease value, or turn off advanced fit settings." };
    }

    const [org] = await dbClient
      .select()
      .from(organizations as any)
      .where(eq((organizations as any).shop, session.shop))
      .limit(1);

    if (!org) return { error: "Organization not found. Please reinstall the app." };

    try {
      await dbClient.insert(fitSizeCharts as any).values(
        parsedSizes.map((size) => ({
          id: crypto.randomUUID(),
          orgId: org.id,
          garmentType,
          sizeLabel: size.sizeLabel,
          fitType,
          chestMinCm: String(size.chest),
          chestMaxCm: String(size.chest),
          lengthMinCm: String(size.length),
          lengthMaxCm: String(size.length),
          shoulderMinCm: size.shoulder === null ? null : String(size.shoulder),
          shoulderMaxCm: size.shoulder === null ? null : String(size.shoulder),
          easeValueCm: String(easeValue),
          easeSource: useManualEase ? "explicit" : "inferred",
          extraMeasurements: { guideGender: gender, showOnStorefront: false },
        })),
      );
      await pushChartToKV(org.id, garmentType as string);
      return { success: true, guideTitle: titleForGuide(gender, garmentType as string) };
    } catch {
      return { error: "We could not save this guide. Check that these sizes have not already been added." };
    }
  }

  if (intent === "delete") {
    const chartId = formData.get("chartId") as string;
    if (!chartId) return { error: "Choose a size row to remove." };

    const [chart] = await dbClient
      .select()
      .from(fitSizeCharts as any)
      .where(eq((fitSizeCharts as any).id, chartId))
      .limit(1);

    if (chart) {
      await dbClient.delete(fitSizeCharts as any).where(eq((fitSizeCharts as any).id, chartId));
      await pushChartToKV(chart.orgId, chart.garmentType);
    }
    return { deleted: true };
  }

  if (intent === "toggle-storefront-guide") {
    const gender = formData.get("gender");
    const garmentType = formData.get("garmentType");
    const showOnStorefront = formData.get("showOnStorefront") === "true";

    if (
      (gender !== "men" && gender !== "women" && gender !== "unisex") ||
      !GARMENT_TYPES.some((item) => item.value === garmentType)
    ) return { error: "We could not find that size guide." };

    const [org] = await dbClient.select().from(organizations as any).where(eq((organizations as any).shop, session.shop)).limit(1);
    if (!org) return { error: "Organization not found. Please reinstall the app." };

    const guideRows = await dbClient.select().from(fitSizeCharts as any).where(
      and(eq((fitSizeCharts as any).orgId, org.id), eq((fitSizeCharts as any).garmentType, garmentType)),
    );
    const matchingRows = guideRows.filter((row: any) => guideGender(row.extraMeasurements) === gender);
    if (!matchingRows.length) return { error: "We could not find that size guide." };

    await Promise.all(matchingRows.map((row: any) => {
      const existingMetadata = typeof row.extraMeasurements === "object" && row.extraMeasurements !== null ? row.extraMeasurements : {};
      return dbClient.update(fitSizeCharts as any)
        .set({ extraMeasurements: { ...existingMetadata, guideGender: gender, showOnStorefront }, updatedAt: new Date() })
        .where(eq((fitSizeCharts as any).id, row.id));
    }));
    await pushChartToKV(org.id, garmentType as string);
    return { storefrontGuideUpdated: true, showOnStorefront, guideTitle: titleForGuide(gender, garmentType as string) };
  }

  return { error: "Unknown action." };
};

export default function SizeCharts() {
  const { sizeCharts, hasOrg } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [gender, setGender] = useState<Gender | null>(null);
  const [garmentType, setGarmentType] = useState<string | null>(null);
  const [fitType, setFitType] = useState("regular");
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>("cm");
  const [useManualEase, setUseManualEase] = useState(false);
  const [easeValue, setEaseValue] = useState("");
  const [sizes, setSizes] = useState<DraftSize[]>([newSizeRow(), newSizeRow(), newSizeRow()]);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);

  const isSubmitting = navigation.state === "submitting";
  const guideTitle = gender && garmentType ? titleForGuide(gender, garmentType) : "";
  const savedGuides = useMemo(() => {
    const groups = new Map<string, typeof sizeCharts>();
    sizeCharts.forEach((chart: any) => {
      const chartGender = guideGender(chart.extraMeasurements);
      const key = `${chartGender}:${chart.garmentType}`;
      groups.set(key, [...(groups.get(key) ?? []), chart]);
    });
    return [...groups.entries()].map(([key, charts]) => ({
      key,
      charts,
      gender: guideGender(charts[0].extraMeasurements),
      garmentType: charts[0].garmentType,
      showOnStorefront: charts.some((chart: any) => Boolean(chart.extraMeasurements?.showOnStorefront)),
    }));
  }, [sizeCharts]);

  function updateSize(id: string, field: keyof Omit<DraftSize, "id">, value: string) {
    setSizes((rows) => rows.map((row) => row.id === id ? { ...row, [field]: value } : row));
  }

  function changeMeasurementUnit(nextUnit: MeasurementUnit) {
    if (nextUnit === measurementUnit) return;
    setSizes((rows) => rows.map((row) => ({
      ...row,
      chest: convertMeasurement(row.chest, measurementUnit, nextUnit),
      length: convertMeasurement(row.length, measurementUnit, nextUnit),
      shoulder: convertMeasurement(row.shoulder, measurementUnit, nextUnit),
    })));
    setEaseValue((value) => convertMeasurement(value, measurementUnit, nextUnit));
    setMeasurementUnit(nextUnit);
  }

  function downloadTemplate() {
    const file = new Blob(["Size,Chest,Length,Shoulder\nS,50,68,42\nM,53,70,44\nL,56,72,46\n"], { type: "text/csv" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "snug-size-guide-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setCsvMessage("Choose a CSV file to import.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseSizeCsv(String(reader.result ?? ""));
        setSizes(imported);
        setMeasurementUnit("cm");
        setCsvMessage(`${imported.length} sizes imported. Review them before saving.`);
      } catch (error) {
        setCsvMessage(error instanceof Error ? error.message : "We could not read that CSV.");
      }
    };
    reader.onerror = () => setCsvMessage("We could not read that file. Please try again.");
    reader.readAsText(file);
  }

  return (
    <Page title="Size guides" subtitle="Create clear, reliable product measurements for your shoppers." backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          {!hasOrg && (
            <Banner tone="critical" title="Organization not found">
              <Text as="p" variant="bodyMd">Please reinstall the app to continue.</Text>
            </Banner>
          )}
          {actionData?.error && (
            <Banner tone="critical" title="Check your guide">
              <Text as="p" variant="bodyMd">{actionData.error}</Text>
            </Banner>
          )}
          {actionData?.success && (
            <Banner tone="success" title={`${actionData.guideTitle} is ready`}>
              <Text as="p" variant="bodyMd">Your size guide is saved and ready to use in Snug recommendations.</Text>
            </Banner>
          )}
          {actionData?.deleted && (
            <Banner tone="success" title="Size row removed">
              <Text as="p" variant="bodyMd">The guide has been updated.</Text>
            </Banner>
          )}
          {actionData?.storefrontGuideUpdated && (
            <Banner tone="success" title={`${actionData.guideTitle} is ${actionData.showOnStorefront ? "visible" : "hidden"} on your storefront`}>
              <Text as="p" variant="bodyMd">{actionData.showOnStorefront ? "Shoppers can now open this guide from mapped product pages." : "Shoppers will no longer see this guide on mapped product pages."}</Text>
            </Banner>
          )}
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingLg">Create a size guide</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">Add the essentials first. You can fine-tune details whenever you need to.</Text>
                </BlockStack>
                <Badge tone="info">{`Step ${step} of 3`}</Badge>
              </InlineStack>

              <div className={styles.progressTrack} aria-label={`Step ${step} of 3`}>
                {[1, 2, 3].map((number) => <span key={number} className={number <= step ? styles.progressActive : styles.progressItem} />)}
              </div>

              {step === 1 && (
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingMd">Who is this guide for?</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">Choose the audience first, then we’ll tailor the guide setup.</Text>
                  </BlockStack>
                  <div className={styles.selectionGrid}>
                    {GENDERS.map((item) => (
                      <button key={item.value} type="button" className={styles.selectionTile} onClick={() => { setGender(item.value); setStep(2); }}>
                        <span className={styles.tileMark} aria-hidden="true">{item.mark}</span>
                        <span className={styles.tileCopy}><strong>{item.label}</strong><small>{item.description}</small></span>
                      </button>
                    ))}
                  </div>
                </BlockStack>
              )}

              {step === 2 && gender && (
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <BlockStack gap="100"><Text as="h3" variant="headingMd">What are you measuring?</Text><Text as="p" variant="bodyMd" tone="subdued">Your {GENDERS.find((item) => item.value === gender)?.label.toLowerCase()} collection can have more guides later.</Text></BlockStack>
                    <Button variant="plain" onClick={() => setStep(1)}>Change gender</Button>
                  </InlineStack>
                  <div className={styles.garmentGrid}>
                    {GARMENT_TYPES.map((item) => (
                      <button key={item.value} type="button" className={styles.garmentTile} onClick={() => { setGarmentType(item.value); setStep(3); }}>
                        <strong>{item.label}</strong><span>{item.description}</span>
                      </button>
                    ))}
                  </div>
                </BlockStack>
              )}

              {step === 3 && gender && garmentType && (
                <Form method="post">
                  <input type="hidden" name="intent" value="save-guide" />
                  <input type="hidden" name="gender" value={gender} />
                  <input type="hidden" name="garmentType" value={garmentType} />
                  <input type="hidden" name="useManualEase" value={String(useManualEase)} />
                  <input type="hidden" name="measurementUnit" value={measurementUnit} />
                  <input type="hidden" name="sizes" value={JSON.stringify(sizes)} />
                  <BlockStack gap="500">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100"><Text as="h3" variant="headingMd">{guideTitle}</Text><Text as="p" variant="bodyMd" tone="subdued">Enter garment measurements in centimetres. Chest and length are required.</Text></BlockStack>
                      <Button variant="plain" onClick={() => setStep(2)}>Change garment</Button>
                    </InlineStack>

                    <div className={styles.importBar}>
                      <BlockStack gap="050"><Text as="h3" variant="headingSm">Already have a spreadsheet?</Text><Text as="p" variant="bodySm" tone="subdued">Import a simple CSV, then review every measurement in the table below.</Text></BlockStack>
                      <InlineStack gap="200" blockAlign="center">
                        <Button variant="plain" onClick={downloadTemplate}>Download template</Button>
                        <label className={styles.uploadButton}><span>Upload CSV</span><input type="file" accept=".csv,text/csv" onChange={importCsv} /></label>
                      </InlineStack>
                    </div>
                    {csvMessage && <Banner tone={csvMessage.includes("imported") ? "success" : "warning"} onDismiss={() => setCsvMessage(null)}>{csvMessage}</Banner>}

                    <input type="hidden" name="fitType" value={fitType} />
                    <div className={styles.fitSection}>
                      <div><Text as="h3" variant="headingSm">Fit</Text><Text as="p" variant="bodySm" tone="subdued">This sets Snug’s default ease.</Text></div>
                      <div className={styles.fitPicker} role="radiogroup" aria-label="Fit">
                        {FIT_TYPES.map((fit) => <button key={fit.value} type="button" role="radio" aria-checked={fitType === fit.value} className={fitType === fit.value ? styles.fitOptionActive : styles.fitOption} onClick={() => setFitType(fit.value)}><strong>{fit.label}</strong><span>{fit.description}</span></button>)}
                      </div>
                    </div>

                    <div className={styles.measurementHeading}>
                      <BlockStack gap="050"><Text as="h3" variant="headingSm">Measurements</Text><Text as="p" variant="bodySm" tone="subdued">All values update automatically when you switch units.</Text></BlockStack>
                      <div className={styles.unitToggle} role="group" aria-label="Measurement unit"><button type="button" className={measurementUnit === "cm" ? styles.unitActive : styles.unitOption} onClick={() => changeMeasurementUnit("cm")}>CM</button><button type="button" className={measurementUnit === "in" ? styles.unitActive : styles.unitOption} onClick={() => changeMeasurementUnit("in")}>IN</button></div>
                    </div>

                    <div className={styles.measurementTable}>
                      <div className={`${styles.tableRow} ${styles.tableHeader}`}><span>Size</span><span>{`Chest (${measurementUnit})`}</span><span>{`Length (${measurementUnit})`}</span><span>{`Shoulder (${measurementUnit})`}</span><span aria-label="Actions" /></div>
                      {sizes.map((size, index) => (
                        <div className={styles.tableRow} key={size.id}>
                          <TextField label={`Size ${index + 1}`} labelHidden value={size.sizeLabel} onChange={(value) => updateSize(size.id, "sizeLabel", value)} autoComplete="off" placeholder={["S", "M", "L", "XL", "2XL", "3XL"][index] ?? "Size"} />
                          <TextField label={`Chest for ${size.sizeLabel || `size ${index + 1}`}`} labelHidden type="number" value={size.chest} onChange={(value) => updateSize(size.id, "chest", value)} autoComplete="off" placeholder="50" />
                          <TextField label={`Length for ${size.sizeLabel || `size ${index + 1}`}`} labelHidden type="number" value={size.length} onChange={(value) => updateSize(size.id, "length", value)} autoComplete="off" placeholder="70" />
                          <TextField label={`Shoulder for ${size.sizeLabel || `size ${index + 1}`}`} labelHidden type="number" value={size.shoulder} onChange={(value) => updateSize(size.id, "shoulder", value)} autoComplete="off" placeholder="Optional" />
                          <Button accessibilityLabel={`Remove size row ${index + 1}`} variant="plain" tone="critical" disabled={sizes.length === 1} onClick={() => setSizes((rows) => rows.filter((row) => row.id !== size.id))}>Remove</Button>
                        </div>
                      ))}
                    </div>

                    <Button variant="plain" onClick={() => setSizes((rows) => [...rows, newSizeRow()])}>Add another size</Button>

                    <Divider />
                    <div className={styles.advancedPanel}>
                      <div><Text as="h3" variant="headingSm">Advanced fit settings</Text><Text as="p" variant="bodySm" tone="subdued">Snug uses the selected fit by default. Turn this on only when you know the garment’s ease.</Text></div>
                      <Checkbox label="Use custom ease" checked={useManualEase} onChange={setUseManualEase} />
                    </div>
                    {useManualEase && <TextField label={`Ease (${measurementUnit})`} name="easeValue" type="number" value={easeValue} onChange={setEaseValue} autoComplete="off" helpText="Extra room built into the garment beyond the body measurement." />}

                    <div className={styles.actionBar}><Button variant="plain" onClick={() => setStep(2)}>Back</Button><Button variant="primary" submit loading={isSubmitting}>Save {guideTitle}</Button></div>
                  </BlockStack>
                </Form>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between"><Text as="h2" variant="headingMd">Your size guides</Text><Badge>{`${savedGuides.length} saved`}</Badge></InlineStack>
              {savedGuides.length === 0 ? (
                <div className={styles.emptyState}><Text as="h3" variant="headingSm">Your first guide starts here</Text><Text as="p" variant="bodyMd" tone="subdued">Add a complete Men’s T-shirt guide and your next onboarding step will unlock.</Text></div>
              ) : (
                <BlockStack gap="300">
                  {savedGuides.map((guide) => (
                    <div className={styles.savedGuide} key={guide.key}>
                      <InlineStack align="space-between" blockAlign="start"><BlockStack gap="100"><Text as="h3" variant="headingSm">{titleForGuide(guide.gender, guide.garmentType)}</Text><Text as="p" variant="bodySm" tone="subdued">{guide.charts.length} size{guide.charts.length === 1 ? "" : "s"} · Chest and length included</Text></BlockStack><Badge tone={guide.showOnStorefront ? "success" : undefined}>{guide.showOnStorefront ? "Shown on storefront" : "Saved"}</Badge></InlineStack>
                      <div className={styles.savedSizes}>{guide.charts.map((chart: any) => <span key={chart.id}>{chart.sizeLabel}</span>)}</div>
                      <Form method="post"><input type="hidden" name="intent" value="toggle-storefront-guide" /><input type="hidden" name="gender" value={guide.gender} /><input type="hidden" name="garmentType" value={guide.garmentType} /><input type="hidden" name="showOnStorefront" value={String(!guide.showOnStorefront)} /><Button variant={guide.showOnStorefront ? "secondary" : "primary"} submit>{guide.showOnStorefront ? "Hide size guide from storefront" : "Show size guide on storefront"}</Button></Form>
                      <BlockStack gap="100">{guide.charts.map((chart: any) => <InlineStack key={chart.id} align="space-between"><Text as="span" variant="bodySm">{chart.sizeLabel} · Chest {chart.chestMinCm} cm · Length {chart.lengthMinCm} cm</Text><Form method="post"><input type="hidden" name="intent" value="delete" /><input type="hidden" name="chartId" value={chart.id} /><Button variant="plain" tone="critical" submit>Remove</Button></Form></InlineStack>)}</BlockStack>
                    </div>
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
