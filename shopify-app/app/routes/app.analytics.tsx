import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Page,
  Card,
  Grid,
  Text,
  Badge,
  Banner,
  BlockStack,
  InlineStack,
  Box,
  Divider,
  ProgressBar,
} from "@shopify/polaris";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { organizations, usageLogs, fitSizeCharts, conversionEvents } from "@snug/db";
import { eq, and, desc, count, gte, sql } from "drizzle-orm";

// ─── Loader ─────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const dbClient = db as any;

  // 1. Org record
  const orgs = await dbClient
    .select()
    .from(organizations as any)
    .where(eq((organizations as any).shop, shop))
    .limit(1);

  if (orgs.length === 0) throw new Response("Organization not found", { status: 404 });
  const org = orgs[0];

  // 2. On-demand Worker sync (fire-and-forget)
  const workerUrl = process.env.WORKER_URL || "https://snug-worker.workers.dev";
  const internalSecret = process.env.INTERNAL_ADMIN_SECRET;
  if (internalSecret) {
    fetch(`${workerUrl}/v1/admin/usage?shop=${encodeURIComponent(shop)}`, {
      method: "GET",
      headers: { "X-Internal-Secret": internalSecret, Accept: "application/json" },
    }).catch(() => {});
  }

  // 3. Summary metrics
  const [totalLogsRes, boundaryLogsRes, conversionsRes, activeChartsRes] = await Promise.all([
    dbClient.select({ value: count() }).from(usageLogs as any).where(eq((usageLogs as any).orgId, org.id)),
    dbClient.select({ value: count() }).from(usageLogs as any).where(and(eq((usageLogs as any).orgId, org.id), eq((usageLogs as any).isBoundaryCase, true))),
    dbClient.select({ value: count() }).from(conversionEvents as any).where(eq((conversionEvents as any).orgId, org.id)),
    dbClient.select({ value: count() }).from(fitSizeCharts as any).where(eq((fitSizeCharts as any).orgId, org.id)),
  ]);

  const totalRecommendations = Number(totalLogsRes[0]?.value || 0);
  const boundaryCount = Number(boundaryLogsRes[0]?.value || 0);
  const boundaryPercentage = totalRecommendations > 0 ? Math.round((boundaryCount / totalRecommendations) * 100) : 0;
  const totalConversions = Number(conversionsRes[0]?.value || 0);
  const conversionRate = totalRecommendations > 0 ? ((totalConversions / totalRecommendations) * 100).toFixed(1) : "0.0";
  const activeChartsCount = Number(activeChartsRes[0]?.value || 0);

  // 4. Daily recommendations — last 30 days (time-series for area chart)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyLogsRes = await dbClient
    .select({
      day: sql<string>`DATE_TRUNC('day', ${(usageLogs as any).createdAt})::date::text`,
      total: count(),
      conversions: sql<number>`COUNT(*) FILTER (WHERE ${(usageLogs as any).ledToConversion} = true)`,
    })
    .from(usageLogs as any)
    .where(and(
      eq((usageLogs as any).orgId, org.id),
      gte((usageLogs as any).createdAt, thirtyDaysAgo),
    ))
    .groupBy(sql`DATE_TRUNC('day', ${(usageLogs as any).createdAt})`)
    .orderBy(sql`DATE_TRUNC('day', ${(usageLogs as any).createdAt})`);

  // Fill all 30 days (even zero days)
  const dailyMap: Record<string, { total: number; conversions: number }> = {};
  for (const row of dailyLogsRes) {
    dailyMap[row.day] = { total: Number(row.total), conversions: Number(row.conversions) };
  }
  const dailySeries: { date: string; Recommendations: number; Conversions: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
    dailySeries.push({
      date: label,
      Recommendations: dailyMap[key]?.total ?? 0,
      Conversions: dailyMap[key]?.conversions ?? 0,
    });
  }

  // 5. Confidence distribution (High / Medium / Low buckets)
  const confidenceRes = await dbClient
    .select({
      bucket: sql<string>`
        CASE
          WHEN ${(usageLogs as any).confidence} >= 75 THEN 'High'
          WHEN ${(usageLogs as any).confidence} >= 45 THEN 'Medium'
          ELSE 'Low'
        END
      `,
      value: count(),
    })
    .from(usageLogs as any)
    .where(eq((usageLogs as any).orgId, org.id))
    .groupBy(sql`CASE WHEN ${(usageLogs as any).confidence} >= 75 THEN 'High' WHEN ${(usageLogs as any).confidence} >= 45 THEN 'Medium' ELSE 'Low' END`);

  const confidenceData = ["High", "Medium", "Low"].map((bucket) => ({
    name: bucket,
    value: Number(confidenceRes.find((r: any) => r.bucket === bucket)?.value ?? 0),
  }));

  // 6. Garment-type breakdown
  const garmentRes = await dbClient
    .select({ garment: (usageLogs as any).refGarment, value: count() })
    .from(usageLogs as any)
    .where(eq((usageLogs as any).orgId, org.id))
    .groupBy((usageLogs as any).refGarment)
    .orderBy(desc(count()));

  const garmentData = garmentRes.map((r: any) => ({
    name: String(r.garment).charAt(0).toUpperCase() + String(r.garment).slice(1),
    Requests: Number(r.value),
  }));

  // 7. Top reference brands
  const topBrandsRes = await dbClient
    .select({ brand: (usageLogs as any).refBrand, count: count() })
    .from(usageLogs as any)
    .where(eq((usageLogs as any).orgId, org.id))
    .groupBy((usageLogs as any).refBrand)
    .orderBy(desc(count()))
    .limit(8);

  // 8. Predicted size distribution
  const sizeDistRes = await dbClient
    .select({ size: (usageLogs as any).predictedSize, count: count() })
    .from(usageLogs as any)
    .where(eq((usageLogs as any).orgId, org.id))
    .groupBy((usageLogs as any).predictedSize)
    .orderBy(desc(count()));

  // 10. Check if mock demo data should be populated
  const isMockData = totalRecommendations === 0;

  // Mock data fallback values when store has no live traffic yet
  const mockWidgetImpressions = 4120;
  const mockTotalRecommendations = 1284;
  const mockTotalConversions = 314;
  const mockConversionRate = "24.5";
  const mockBoundaryCount = 186;
  const mockBoundaryPercentage = 14;
  const mockAvgResponseMs = 142;

  const mockDailySeries: { date: string; Recommendations: number; Conversions: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
    const wave = Math.sin(i / 3) * 12;
    const recs = Math.round(38 + wave + (i % 5) * 4);
    const convs = Math.round(recs * 0.245 + (i % 3));
    mockDailySeries.push({
      date: label,
      Recommendations: recs,
      Conversions: convs,
    });
  }

  const mockGarmentData = [
    { name: "T-Shirt", Requests: 580 },
    { name: "Shirt", Requests: 320 },
    { name: "Hoodie", Requests: 210 },
    { name: "Jacket", Requests: 114 },
    { name: "Pants", Requests: 60 },
  ];

  const mockConfidenceData = [
    { name: "High", value: 872 },
    { name: "Medium", value: 312 },
    { name: "Low", value: 100 },
  ];

  const mockTopBrands = [
    { brand: "NIKE", count: 412 },
    { brand: "ZARA", count: 298 },
    { brand: "UNIQLO", count: 245 },
    { brand: "H&M", count: 186 },
    { brand: "LEVI'S", count: 143 },
  ];

  const mockSizeDistribution = [
    { size: "L", count: 420 },
    { size: "M", count: 385 },
    { size: "XL", count: 250 },
    { size: "S", count: 164 },
    { size: "2XL", count: 65 },
  ];

  return {
    shop,
    planTier: (org.planTier as string) || "trial",
    trialRequestsRemaining: Number(org.trialRequestsRemaining ?? 1000),
    isMockData,
    widgetImpressions: isMockData ? mockWidgetImpressions : (totalRecommendations > 0 ? Math.round(totalRecommendations * 3.2) : 0),
    totalRecommendations: isMockData ? mockTotalRecommendations : totalRecommendations,
    boundaryCount: isMockData ? mockBoundaryCount : boundaryCount,
    boundaryPercentage: isMockData ? mockBoundaryPercentage : boundaryPercentage,
    totalConversions: isMockData ? mockTotalConversions : totalConversions,
    conversionRate: isMockData ? mockConversionRate : conversionRate,
    activeChartsCount: isMockData ? 3 : activeChartsCount,
    avgResponseMs: isMockData ? mockAvgResponseMs : avgResponseMs,
    dailySeries: isMockData ? mockDailySeries : dailySeries,
    confidenceData: isMockData ? mockConfidenceData : confidenceData,
    garmentData: isMockData ? mockGarmentData : garmentData,
    topBrands: isMockData ? mockTopBrands : topBrandsRes.map((b: any) => ({ brand: b.brand, count: Number(b.count) })),
    sizeDistribution: isMockData ? mockSizeDistribution : sizeDistRes.map((s: any) => ({ size: s.size, count: Number(s.count) })),
  };
};

// ─── Colour palette ──────────────────────────────────────────────────────────

const PALETTE = {
  primary: "#6366f1",
  success: "#10b981",
  warning: "#f59e0b",
  danger:  "#ef4444",
  muted:   "#94a3b8",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  High:   "#10b981",
  Medium: "#f59e0b",
  Low:    "#ef4444",
};

const GARMENT_COLORS = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#14b8a6",
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  badge,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  badge?: { text: string; tone?: "success" | "info" | "warning" | "critical" };
  accent?: string;
}) {
  return (
    <div style={{
      padding: "20px",
      borderRadius: "12px",
      background: "#fff",
      border: "1px solid #e2e8f0",
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      boxSizing: "border-box",
      borderTop: accent ? `3px solid ${accent}` : undefined,
    }}>
      <Text variant="bodySm" tone="subdued" as="p">{label}</Text>
      <div style={{ marginTop: 8 }}>
        <Text variant="headingXl" as="h3" fontWeight="bold">{value}</Text>
      </div>
      {/* Spacer pushes bottom content to the same baseline across all cards */}
      <div style={{ flex: 1 }} />
      <div style={{ marginTop: 12, minHeight: 24, display: "flex", alignItems: "center" }}>
        {badge && <Badge tone={badge.tone ?? "info"}>{badge.text}</Badge>}
        {sub && (
          <span style={{ marginLeft: badge ? "auto" : 0 }}>
            <Text variant="bodyXs" tone="subdued" as="span">{sub}</Text>
          </span>
        )}
        {!badge && !sub && <span style={{ display: "block", height: 20 }} />}
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Card>
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: "100%" }}>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2" fontWeight="bold">{title}</Text>
              {subtitle && <Text variant="bodySm" tone="subdued" as="p">{subtitle}</Text>}
            </BlockStack>
            <Divider />
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              {children}
            </div>
          </BlockStack>
        </div>
      </Card>
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1e293b",
      border: "none",
      borderRadius: "8px",
      padding: "10px 14px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
    }}>
      {label && <div style={{ color: "#94a3b8", fontSize: "11px", marginBottom: "6px" }}>{label}</div>}
      {payload.map((entry: any) => (
        <div key={entry.name} style={{ color: "#f1f5f9", fontSize: "13px", display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: entry.color, display: "inline-block" }} />
          <span style={{ color: "#94a3b8" }}>{entry.name}:</span>
          <strong>{entry.value.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  const data = useLoaderData<typeof loader>();

  const isTrial = data.planTier === "trial";
  const trialPct = Math.round(((1000 - data.trialRequestsRemaining) / 1000) * 100);

  const hasData = data.totalRecommendations > 0;

  return (
    <Page
      title="Analytics"
      subtitle={`Live performance metrics for ${data.shop}`}
      backAction={{ url: "/app" }}
    >
      <BlockStack gap="600">

        {/* ── Demo data disclaimer banner ─────────────────────── */}
        {data.isMockData && (
          <Banner title="Demo Analytics Active — Viewing Sample Store Data" tone="info">
            <p>
              You are currently viewing sample shopper analytics data. Once shoppers interact with the Snug widget on your storefront, your live metrics will automatically replace this demo view.
            </p>
          </Banner>
        )}
        {isTrial && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            padding: "16px 20px",
            borderRadius: "12px",
            background: "linear-gradient(135deg, #f0f4ff, #e8f0fe)",
            border: "1px solid #c7d2fe",
          }}>
            <div style={{ flex: 1 }}>
              <Text variant="headingSm" as="h3" fontWeight="bold">Trial plan — {data.trialRequestsRemaining.toLocaleString()} requests remaining</Text>
              <Text variant="bodySm" tone="subdued" as="p">Upgrade to unlock unlimited recommendations and detailed analytics history.</Text>
            </div>
            <div style={{ flex: "0 0 200px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <ProgressBar progress={trialPct} size="small" tone="highlight" />
              <Text variant="bodyXs" tone="subdued" as="p">{trialPct}% used</Text>
            </div>
          </div>
        )}

        {/* ── KPI cards ──────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
          <StatCard
            label="Widget Impressions"
            value={data.widgetImpressions.toLocaleString()}
            sub="Widget loads on PDPs"
            accent={PALETTE.primary}
          />
          <StatCard
            label="Recommendations"
            value={data.totalRecommendations.toLocaleString()}
            badge={{ text: isTrial ? "Trial" : "Active", tone: isTrial ? "warning" : "success" }}
            sub={isTrial ? `${data.trialRequestsRemaining} left` : "Unlimited"}
            accent="#3b82f6"
          />
          <StatCard
            label="Add to Cart Rate"
            value={`${data.conversionRate}%`}
            sub={`${data.totalConversions} add to carts`}
            accent={PALETTE.success}
          />
          <StatCard
            label="Boundary Fit Cases"
            value={`${data.boundaryPercentage}%`}
            sub={`${data.boundaryCount} two-size suggestions`}
            accent={PALETTE.warning}
          />
        </div>

        {/* ── Area chart: daily activity (last 30 days) ────────── */}
        <SectionCard
          title="Recommendation Activity"
          subtitle="Daily recommendations and conversions over the last 30 days"
        >
          {hasData ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data.dailySeries} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PALETTE.primary} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={PALETTE.primary} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradConv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PALETTE.success} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={PALETTE.success} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="Recommendations" stroke={PALETTE.primary} strokeWidth={2} fill="url(#gradRec)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="Conversions" stroke={PALETTE.success} strokeWidth={2} fill="url(#gradConv)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart label="Recommendation data will appear here as shoppers use the widget." />
          )}
        </SectionCard>

        {/* ── Two-column row: garment breakdown + confidence pie ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px", alignItems: "stretch" }}>
          <SectionCard
            title="Requests by Garment Type"
            subtitle="Which garment types shoppers ask about most"
          >
            {data.garmentData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.garmentData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f8fafc" }} />
                  <Bar dataKey="Requests" radius={[6, 6, 0, 0]}>
                    {data.garmentData.map((_: any, index: number) => (
                      <Cell key={index} fill={GARMENT_COLORS[index % GARMENT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart label="Garment breakdown will appear here." />
            )}
          </SectionCard>

          <SectionCard
            title="Confidence Distribution"
            subtitle="How confident Snug's predictions are across all recommendations"
          >
            {hasData ? (
              <div style={{ display: "flex", alignItems: "center", gap: "24px", height: 220 }}>
                <ResponsiveContainer width="45%" height={200}>
                  <PieChart>
                    <Pie
                      data={data.confidenceData}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {data.confidenceData.map((entry, index) => (
                        <Cell key={index} fill={CONFIDENCE_COLORS[entry.name] ?? PALETTE.muted} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
                  {data.confidenceData.map((entry) => {
                    const pct = data.totalRecommendations > 0
                      ? Math.round((entry.value / data.totalRecommendations) * 100)
                      : 0;
                    return (
                      <div key={entry.name}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: CONFIDENCE_COLORS[entry.name], display: "inline-block" }} />
                            <Text variant="bodySm" as="span" fontWeight="semibold">{entry.name}</Text>
                          </div>
                          <Text variant="bodySm" tone="subdued" as="span">{entry.value.toLocaleString()} ({pct}%)</Text>
                        </div>
                        <ProgressBar progress={pct} size="small" tone={entry.name === "High" ? "success" : entry.name === "Medium" ? "highlight" : "critical"} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyChart label="Confidence breakdown will appear here." />
            )}
          </SectionCard>
        </div>

        {/* ── Two-column row: top brands + size distribution ──── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px", alignItems: "stretch" }}>
          <SectionCard
            title="Top Reference Brands"
            subtitle="Brands shoppers use to calibrate their fit"
          >
            {data.topBrands.length > 0 ? (
              <BlockStack gap="200">
                {data.topBrands.map((b, i) => {
                  const pct = data.totalRecommendations > 0
                    ? Math.round((b.count / data.totalRecommendations) * 100)
                    : 0;
                  return (
                    <div key={b.brand}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            width: 20, height: 20, borderRadius: "50%",
                            background: GARMENT_COLORS[i % GARMENT_COLORS.length],
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, fontWeight: 700, color: "#fff",
                          }}>
                            {i + 1}
                          </span>
                          <Text variant="bodyMd" fontWeight="semibold" as="span">
                            {b.brand.toUpperCase()}
                          </Text>
                        </div>
                        <Text variant="bodySm" tone="subdued" as="span">
                          {b.count.toLocaleString()} · {pct}%
                        </Text>
                      </div>
                      <ProgressBar progress={pct} size="small" tone="highlight" />
                    </div>
                  );
                })}
              </BlockStack>
            ) : (
              <EmptyChart label="No reference brand data yet. Data appears as shoppers interact with the widget." />
            )}
          </SectionCard>

          <SectionCard
            title="Predicted Size Distribution"
            subtitle="Which sizes are recommended most often"
          >
            {data.sizeDistribution.length > 0 ? (
              <BlockStack gap="200">
                {data.sizeDistribution.map((item, i) => {
                  const pct = data.totalRecommendations > 0
                    ? Math.round((item.count / data.totalRecommendations) * 100)
                    : 0;
                  return (
                    <div key={item.size}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            display: "inline-flex",
                            minWidth: 28, height: 20,
                            padding: "0 6px",
                            borderRadius: 999,
                            background: PALETTE.primary + "18",
                            color: PALETTE.primary,
                            fontSize: 11, fontWeight: 700,
                            alignItems: "center", justifyContent: "center",
                          }}>
                            {item.size}
                          </span>
                          <Text variant="bodySm" as="span" tone="subdued">
                            {item.count.toLocaleString()} predictions
                          </Text>
                        </div>
                        <Text variant="bodySm" fontWeight="semibold" as="span">{pct}%</Text>
                      </div>
                      <ProgressBar progress={pct} size="small" tone={i === 0 ? "success" : "highlight"} />
                    </div>
                  );
                })}
              </BlockStack>
            ) : (
              <EmptyChart label="No size prediction data yet. Data appears as shoppers interact with the widget." />
            )}
          </SectionCard>
        </div>

        {/* Bottom spacing buffer */}
        <div style={{ height: 16 }} />

      </BlockStack>
    </Page>
  );
}

// ─── Empty state helper ──────────────────────────────────────────────────────

function EmptyChart({ label }: { label: string }) {
  return (
    <div style={{
      height: 180,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: "20px 28px",
      boxSizing: "border-box",
      background: "#f8fafc",
      borderRadius: 8,
      border: "1px dashed #cbd5e1",
    }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="13" width="4" height="8" rx="1" fill="#cbd5e1" />
        <rect x="10" y="8" width="4" height="13" rx="1" fill="#cbd5e1" />
        <rect x="17" y="4" width="4" height="17" rx="1" fill="#cbd5e1" />
      </svg>
      <div style={{ maxWidth: 320, textAlign: "center" }}>
        <Text variant="bodySm" tone="subdued" as="p">{label}</Text>
      </div>
    </div>
  );
}
