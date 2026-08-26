# Module 04: Defensive Edge Engineering Patterns

---

## 1. Safe JSON Parsing in Edge Workers (`.catch(() => null)`)

### The Vulnerability: Uncaught Syntax Errors
When an endpoint handler parses an incoming JSON request body using `await ctx.req.json()`, sending malformed JSON, empty payloads, or invalid content-type headers throws an uncaught JavaScript `SyntaxError`.

In Hono, an uncaught `SyntaxError` bypasses custom JSON error formatting and returns a generic 500 Internal Server Error to the shopper browser.

### The Defensive Pattern
Always attach `.catch(() => null)` to `ctx.req.json()` calls:

```typescript
// Safe: Catch malformed JSON syntax errors gracefully
const body = await ctx.req.json<PredictRequestBody>().catch(() => null);

if (!body) {
  return ctx.json(
    { error: "Bad Request", message: "Invalid or missing JSON payload" },
    400
  );
}
```

---

## 2. KV Key Sanitization & Case Normalization

### The Bug Scenario: Case-Sensitive Binary Keys
In Cloudflare KV, storage keys are **strictly case-sensitive binary strings**:
- `brand:uniqlo:tshirt` <-> `brand:Uniqlo:TShirt` (Different keys!)

If a storefront widget sends `{ ref_brand: "Uniqlo", ref_garment: "TShirt" }`, querying KV directly with raw strings results in a `404 Not Found` error even though the size chart exists in lowercase.

### The Defensive Pattern
Always sanitize and normalize user input keys using `.trim().toLowerCase()` before building KV keys:

```typescript
// Guaranteed case-insensitive key resolution
const refBrand = body.ref_brand.trim().toLowerCase();
const refGarment = body.ref_garment.trim().toLowerCase();
const kvKey = `brand:${refBrand}:${refGarment}`;

const refChart = await ctx.env.KV.get(kvKey, "json");
```

---

## 3. Defensive Error Isolation in `waitUntil()` Tasks

### The Risk: Uncaught Background Promise Rejections
When passing a background task to `ctx.executionCtx.waitUntil(promise)`, if the background task throws an uncaught exception (e.g. database network timeout or connection drop), the HTTP response to the client has already succeeded.

However, the Cloudflare Workers host runtime logs unhandled promise rejections as **Unhandled Exception Errors**, causing false alert spikes in monitoring dashboards.

### The Defensive Pattern
Always wrap background `waitUntil` tasks in internal `try / catch` blocks so background failures log cleanly to worker logs without triggering unhandled promise rejections:

```typescript
async function logUsageEvent(databaseUrl: string, details: Record<string, any>) {
  try {
    // Database write or HTTP log flush
    await sendLogToDB(databaseUrl, details);
  } catch (err) {
    // Log to Worker console silently so runtime metrics stay clean
    console.error("[Background Analytics Error] Failed to write log:", err);
  }
}
```
