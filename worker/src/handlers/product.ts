import type { Context } from 'hono';
import type { AppEnv } from '../index';

export interface ProductMappingKVRecord {
  product_id: string;
  garment_type: string;
  is_active: boolean;
}

export async function handleProductMappingLookup(ctx: Context<AppEnv>) {
  const rawProductId = ctx.req.param("product_id")?.trim();

  if (!rawProductId) {
    return ctx.json({ error: "Bad Request", message: "Missing product_id parameter" }, 400);
  }

  const org = ctx.var.org;

  // 1. Fetch merchant product mappings from KV
  const mappings = (await ctx.env.KV.get(
    `merchant:${org.org_id}:mappings`,
    "json"
  )) as Record<string, ProductMappingKVRecord> | null;

  if (!mappings || !mappings[rawProductId]) {
    return ctx.json(
      {
        mapped: false,
        shopify_product_id: rawProductId,
      },
      200
    );
  }

  const mapping = mappings[rawProductId];

  return ctx.json(
    {
      mapped: true,
      shopify_product_id: rawProductId,
      garment_type: mapping.garment_type,
      is_active: mapping.is_active,
    },
    200
  );
}
