import { createMiddleware } from "hono/factory";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Snug-Key, Origin",
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
  await next();

  /*after the request has finished prcoessing we attach the cors headers as the users browser receives
  the POST response, it checks for Access-Control-Allow-Origin AGAIN on the POST response headers*/
  Object.entries(corsHeaders).forEach(([key, value]) => {
    ctx.res.headers.set(key, value)
  })
})
