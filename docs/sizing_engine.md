# Snug Sizing Recommendation Engine

> A precise, deterministic math-based system for translating a shopper's known reference brand size into the correct recommended size for a merchant's product.

---

## 1. The Problem We Are Solving

When a shopper visits a product page and sees `S / M / L / XL`, they have no idea if those labels map to their body. Every brand sizes differently. A size M at Uniqlo is not the same as a size M at Overlays, Zara, or H&M.

Snug solves this by asking standard constrained dropdown questions on the storefront widget:

> **"What brand, cut/fit, and size do you normally wear?"**

From that single constrained input (where reference brand measurements are fully seeded in Cloudflare KV), combined with the merchant's size chart data, Snug computes the exact recommended size in **under 10ms**.

---

## 2. Dual-Path Architecture: Fitted Match vs. Silhouette Match

> [!IMPORTANT]
> **DUAL-PATH ENGINE SELECTION**: Snug utilizes a **Dual-Path Recommendation Engine**. It runs both **Direct Garment-to-Garment Comparison** (Path A: Fitted Match) and **Ease-Recovery Body Anchor Comparison** (Path B: Silhouette Match) simultaneously in pure TypeScript.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  PATH A: FITTED MATCH (DIRECT GARMENT DELTA)                                    │
│  "What garment size is physically closest to what the user already wears?"       │
│  [Ref Garment Measurement]  ──►  Direct Delta Compare  ──►  [Target Garment]    │
│  (e.g. Polo M Chest: 99cm)                                  (Overlays S: 103cm)  │
└──────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────┐
│  PATH B: SILHOUETTE MATCH (BODY ANCHOR + TARGET EASE)                            │
│  "What size delivers the full intended silhouette experience of this brand?"     │
│  [Ref Garment: 99cm] ──► Subtract Ref Ease (-8cm) ──► [Body Chest: 91cm]         │
│  [Body Chest: 91cm]  ──► Add Target Ease (+19cm)  ──► [Target Garment: 110cm] (M)│
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

### Detailed Dual-Path Engine Breakdown

#### 🌟 Path A: Fitted Match (Direct Garment Delta)
Compares the reference garment's chest measurement against the merchant's target garment measurements to find the minimal delta.
* **Best for:** Same-fit comparisons (e.g. Regular T-Shirt → Regular T-Shirt) and shoppers who prefer an oversized style kept closer to their body ("fitted oversized").

#### 📐 Path B: Silhouette Match (Body Anchor + Target Ease)
Strips standard category ease (`TSHIRT_EASE`) from the reference garment to recover estimated body chest (`body_chest = ref_garment_mid - TSHIRT_EASE[ref_fit]`). Then adds target brand standard ease (`body_chest + TSHIRT_EASE[target_fit]`) to find the garment that delivers the intended silhouette (e.g., boxy, dropped shoulders).
* **Best for:** Cross-fit translations (e.g. Regular Polo shirt → Oversized Drop-shoulder Tee).

---

## 3. Standard T-Shirt Category Ease Matrix (`TSHIRT_EASE`)

Snug maintains an internal, calibrated ease matrix derived from **Winifred Aldrich's *Metric Pattern Cutting for Menswear*** and NIFT pattern standards. Merchants do **not** need to supply ease numbers.

```typescript
const TSHIRT_EASE: Record<FitType, number> = {
  slim:      5,   // 4–6 cm ease band midpoint
  regular:   8,   // 6–10 cm ease band midpoint (Polo shirt sits here)
  relaxed:   12,  // 10–14 cm ease band midpoint
  oversized: 19,  // 16–22 cm ease band midpoint (Streetwear/drop shoulder)
};
```

---

## 4. Data Schemas (Cloudflare KV)

### A. Reference Brand Chart (`brand:{slug}:{garment_type}`)
```json
{
  "brand": "polo_ralph_lauren",
  "garment_type": "tshirt",
  "fit_type": "regular",
  "sizes": {
    "S":  { "chest_min_cm": 90,  "chest_max_cm": 96 },
    "M":  { "chest_min_cm": 96,  "chest_max_cm": 102 },
    "L":  { "chest_min_cm": 102, "chest_max_cm": 108 },
    "XL": { "chest_min_cm": 108, "chest_max_cm": 114 }
  }
}
```

### B. Merchant Product Chart (`chart:{org_id}:{garment_type}`)
```json
{
  "org_id": "org_overlays",
  "garment_type": "tshirt",
  "fit_type": "oversized",
  "sizes": {
    "S":  { "chest_min_cm": 100, "chest_max_cm": 106 },
    "M":  { "chest_min_cm": 106, "chest_max_cm": 112 },
    "L":  { "chest_min_cm": 112, "chest_max_cm": 118 },
    "XL": { "chest_min_cm": 118, "chest_max_cm": 124 }
  }
}
```

---

## 5. The 9-Step Dual-Path Algorithm Execution

Pure TypeScript execution inside `worker/src/algorithm/sizing.ts`:

1. **Step 1: Recover Body Chest**  
   Deduct reference standard ease to get body chest: `body_chest = ref_garment_mid - TSHIRT_EASE[ref_fit]`.
2. **Step 2: Path A (Fitted Match)**  
   Find target size minimizing `|ref_garment_mid - target_garment_mid|`.
3. **Step 3: Path B (Silhouette Match)**  
   Target garment intent = `body_chest + TSHIRT_EASE[target_fit]`. Find target size minimizing `|target_intent - target_garment_mid|`.
4. **Step 4: Primary Selection & Dual Resolution**  
   If same-fit, Path A is primary. If cross-fit, Path B is primary unless explicit `fitIntent` (`fitted` vs `true_silhouette`) is provided.
5. **Step 5: Compute 5-Signal Confidence Score (0–100)**  
   Evaluates Delta Precision, Range Tightness, Data Freshness, Secondary Alignment (Shoulder/Length), and Fit Intent Clarity.
6. **Step 6: Cross-Fit Penalty Engine**  
   Deducts points for fit translations (`slim → oversized`: -15, `regular → oversized`: -10). Penalty is halved if user specifies `fitIntent`.
7. **Step 7: Boundary Proximity Detection**  
   If reference point sits within 2 cm of a size limit, sets `is_boundary_case: true` and includes adjacent size in `suggested_sizes`.
8. **Step 8: Construct Reasoning String**  
   Generates a transparent explanation detailing body chest estimation and silhouette guidance.
9. **Step 9: Assemble JSON Response**  
   Returns `predicted_size`, `fitted_size`, `silhouette_size`, `is_dual_recommendation`, `confidence`, `confidence_label`, and `reasoning`.

---

## 6. Business Risk Guardrails

1. **No Hallucinated Sizes:** Never recommend a size label not present in the merchant's size chart.
2. **Never Cache Low Confidence:** `confidence_label: "low"` outputs bypass KV cache to ensure fresh evaluation.
3. **Dual Recommendation Clarity:** When `fitted_size !== silhouette_size`, surfaces both options with clear intention guidance.
4. **Validation On Upload:** Merchant size charts are validated at upload time (ranges must be sequential and non-overlapping).
5. **Honest Confidence Scoring:** Confidence percentages are deterministic and cannot be overridden by merchants.

---

## 7. Head-to-Head Comparison: Snug vs. TrueFit

| Feature / Dimension | TrueFit (Enterprise ML) | Snug (Direct Math Engine) |
| :--- | :--- | :--- |
| **Core Engine** | Black-box ML on return history & body data | Deterministic Direct Garment Delta Math |
| **Shopper Friction** | High (5–8 fields: height, weight, belly shape) | **Ultra Low (1 question: brand + size worn)** |
| **Merchant Cost** | $1,000 - $5,000/month (Enterprise) | **₹0 – ₹999/month (SME / D2C Friendly)** |
| **Cold Start Problem** | **High Failure** (Needs months of return data) | **Zero Cold Start** (Accurate on Day 1) |
| **Indian Body Type Alignment** | Low (Calibrated on Western demographics) | **High (Calibrated on NIFT population baseline)** |
| **Latency** | 800 ms - 2500 ms | **< 2 ms (Cloudflare Worker Edge KV)** |
| **Explainability** | None (Opaque score) | **100% Transparent Reasoning** |

### Strategic Positioning
* **TrueFit** is enterprise ML software for global multi-nationals with massive returns data pipelines.
* **Snug** is the lightning-fast, zero-friction, accessible sizing layer built specifically for Indian D2C Shopify merchants.

---

*Document Owner: Priyanshu (Sizing Engine Workstream)*  
*Last Updated: August 2026*
