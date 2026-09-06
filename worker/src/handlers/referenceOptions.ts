import type { Context } from 'hono'
import type { AppEnv } from '../index'

import { parseReferenceCoverage } from '../validation'

/**
 * Serves the DB-backed reference brand x garment x size coverage published
 * under `brands:coverage`. The storefront widget builds its reference
 * dropdowns exclusively from this payload so shoppers can only select combos
 * that resolve in /v1/size.
 */
export async function handleReferenceOptionsLookup(ctx: Context<AppEnv>) {
  const coverageRaw = await ctx.env.KV.get('brands:coverage', 'json')
  if (coverageRaw === null) {
    return ctx.json({ error: 'Not Found', message: 'Reference options have not been published yet' }, 404)
  }

  const coverage = parseReferenceCoverage(coverageRaw)
  if (!coverage) {
    return ctx.json({ error: 'Unprocessable Entity', message: 'Published reference options are malformed; republish the configuration' }, 422)
  }

  return ctx.json(coverage, 200)
}
