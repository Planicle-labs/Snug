# Module 03: Hono Middleware Lifecycle, Routing & Type-Safe Context Wiring

---

## 1. Hono vs. Express Architectural Comparison

### Web Standard Fetch API vs. Node.js Streams

Understanding why Hono behaves differently from legacy Node.js frameworks like Express requires examining the underlying runtime primitives:

```mermaid
graph TD
    subgraph Express["Express.js (Node.js HTTP Streams)"]
        NodeRes["res is a MUTABLE stream wrapper"]
        NodeBuf["res.setHeader() buffers headers in memory"]
        NodeNext["Middleware modifies res BEFORE calling next()"]
        NodeRes --> NodeBuf --> NodeNext
    end

    subgraph Hono["Hono (Web Standard Fetch API)"]
        FetchRes["c.res does NOT exist before route handler"]
        FetchNext["Middleware calls await next() first"]
        FetchMut["Route handler creates IMMUTABLE Response object"]
        FetchHeaders["Middleware appends headers to c.res AFTER await next()"]
        FetchNext --> FetchMut --> FetchHeaders
    end
```

---

## 2. The Hono Async Onion Model Lifecycle

Hono uses an **async onion middleware execution flow**. Execution flows down through pre-processing steps, executes the core route handler, and then flows back up through post-processing steps:

```mermaid
sequenceDiagram
    autonumber
    participant Req as Incoming Request (POST /v1/size)
    participant CORS as corsMiddleware
    participant Auth as authMiddleware
    participant Route as POST /v1/size Route Handler
    participant Res as Outgoing Response

    Req->>CORS: 1. OPTIONS check? (No)
    CORS->>Auth: 2. await next()
    Auth->>Auth: 3. Validate API key & Origin, ctx.set('org', record)
    Auth->>Route: 4. await next()
    Route->>Route: 5. Execute sizing algorithm, return c.json(...)
    Note over Route: Instantiates immutable c.res Response
    Route-->>Auth: 6. Hand control back
    Auth-->>CORS: 7. Hand control back
    CORS->>CORS: 8. Appends Access-Control-Allow-* headers onto c.res
    CORS-->>Res: 9. Return Response to shopper browser
```

---

## 3. Global vs. Path-Scoped Middleware Mounting

In `worker/src/index.ts`, we mount middlewares with explicit path scoping:

```typescript
// Global Middleware: Applies CORS to ALL routes (including /health)
app.use("*", corsMiddleware);

// Scoped Middleware: Applies auth ONLY to API endpoints under /v1/*
app.use("/v1/*", authMiddleware);
```

### Why `/health` Must Bypass `authMiddleware`

- **Uptime Monitoring**: Services like Cloudflare Health Checks, UptimeRobot, or Railway health probes call `GET /health` periodically to verify system operational status.
- If `authMiddleware` were mounted on `*`, `GET /health` would fail with `401 Unauthorized ("Missing API Key")` because external monitors do not possess a merchant API key.
- Scoping `authMiddleware` strictly to `/v1/*` keeps `/health` publicly accessible while securing all production API routes.

---

## 4. Type-Safe Hono Environment & Context Wiring

To give downstream route handlers TypeScript autocomplete for context variables (`c.var.org`), we define Hono's `AppEnv` generic interface:

```typescript
import type {
  KVNamespace,
  DurableObjectNamespace,
} from "@cloudflare/workers-types";
import type { MerchantKVRecord } from "./middleware/auth";

// Cloudflare Workers Environment Bindings
export interface Env {
  DATABASE_URL: string;
  ENVIRONMENT: string;
  KV: KVNamespace;
  USAGE_COUNTER: DurableObjectNamespace;
}

// Hono Application Environment Schema
export type AppEnv = {
  Bindings: Env;
  Variables: {
    org: MerchantKVRecord;
  };
};

const app = new Hono<AppEnv>();
```

---

## 5. Final Annotated Implementation of `worker/src/index.ts`

```typescript
import { Hono } from "hono";
import type {
  KVNamespace,
  DurableObjectNamespace,
} from "@cloudflare/workers-types";

import { corsMiddleware } from "./middleware/cors";
import { authMiddleware, type MerchantKVRecord } from "./middleware/auth";

// 1. Define Environment Bindings matching wrangler.toml
export interface Env {
  DATABASE_URL: string;
  ENVIRONMENT: string;
  KV: KVNamespace;
  USAGE_COUNTER: DurableObjectNamespace;
}

// 2. Define Type-Safe Context Schema
export type AppEnv = {
  Bindings: Env;
  Variables: {
    org: MerchantKVRecord;
  };
};

// 3. Initialize Hono App with AppEnv generic
const app = new Hono<AppEnv>();

// 4. Mount Global CORS Middleware (Applies to all routes including /health)
app.use("*", corsMiddleware);

// 5. Mount Auth Middleware (Scoped strictly to /v1/* endpoints)
app.use("/v1/*", authMiddleware);

// 6. Public Health Check Endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    environment: c.env.ENVIRONMENT,
  });
});

// 7. Export Durable Object class binding for Workers runtime
export { UsageCounter } from "./durable-objects/UsageCounter";

// 8. Default export Hono application fetch handler
export default app;
```
