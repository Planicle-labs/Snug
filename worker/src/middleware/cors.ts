import { createMiddleware } from "hono/factory";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Snug-Key, X-Shop-Domain, Origin, Accept",
  // maximum caching age for the preflight response (in seconds)
  "Access-Control-Max-Age": "86400",
}

export const corsMiddleware = createMiddleware(async (ctx, next) => {
  if (ctx.req.method === "OPTIONS") {
    /*
    204 No Content status code means that the server successfully processed the client's request,
    but there is no data to return in the response body.
    It is a success status code indicating that the action was completed and the client does not need
    to reload or navigate away from the current page.
    */
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  try {
    await next()
  } finally {
    if (ctx.res) {
      Object.entries(corsHeaders).forEach(([key, value]) => {
        ctx.res.headers.set(key, value)
      })
    }
  }
})
