import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const CREATE_METAFIELD_DEFINITION_MUTATION = `#graphql
  mutation CreateShopMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        name
        namespace
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const GET_SHOP_ID_QUERY = `#graphql
  query GetShopId {
    shop {
      id
    }
  }
`;

const SET_METAFIELDS_MUTATION = `#graphql
  mutation SetShopMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export async function ensureMetafieldDefinitions(admin: AdminApiContext) {
  const definitions = [
    {
      name: "Snug API Key",
      namespace: "snug",
      key: "api_key",
      type: "single_line_text_field",
      ownerType: "SHOP",
      access: {
        storefront: "PUBLIC_READ",
      },
    },
    {
      name: "Snug Worker URL",
      namespace: "snug",
      key: "worker_url",
      type: "single_line_text_field",
      ownerType: "SHOP",
      access: {
        storefront: "PUBLIC_READ",
      },
    },
  ];

  for (const def of definitions) {
    try {
      const res = await admin.graphql(CREATE_METAFIELD_DEFINITION_MUTATION, {
        variables: { definition: def },
      });
      const data = await res.json();
      const userErrors = data?.data?.metafieldDefinitionCreate?.userErrors;
      if (userErrors && userErrors.length > 0) {
        // If it already exists (TAKEN), it's expected and safe to ignore
        const isTaken = userErrors.some((e: any) => e.code === "TAKEN" || e.message?.includes("already"));
        if (!isTaken) {
          console.warn(`[Metafield Definition] Warning creating ${def.namespace}.${def.key}:`, userErrors);
        }
      }
    } catch (err) {
      console.error(`[Metafield Definition] Error creating definition for ${def.namespace}.${def.key}:`, err);
    }
  }
}

export async function syncShopMetafields(
  admin: AdminApiContext,
  payload: { apiKey: string; workerUrl?: string }
) {
  try {
    const shopRes = await admin.graphql(GET_SHOP_ID_QUERY);
    const shopData = await shopRes.json();
    const shopId = shopData?.data?.shop?.id;

    if (!shopId) {
      console.error("[Metafields] Could not retrieve shop ID for setting metafields");
      return false;
    }

    const workerUrl = payload.workerUrl || process.env.SNUG_WORKER_URL || "https://snug-worker.planicle-labs.workers.dev";

    const metafields = [
      {
        ownerId: shopId,
        namespace: "snug",
        key: "api_key",
        type: "single_line_text_field",
        value: payload.apiKey,
      },
      {
        ownerId: shopId,
        namespace: "snug",
        key: "worker_url",
        type: "single_line_text_field",
        value: workerUrl,
      },
    ];

    const setRes = await admin.graphql(SET_METAFIELDS_MUTATION, {
      variables: { metafields },
    });
    const setData = await setRes.json();
    const errors = setData?.data?.metafieldsSet?.userErrors;
    if (errors && errors.length > 0) {
      console.error("[Metafields] Error setting shop metafields:", errors);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[Metafields] Exception while syncing shop metafields:", err);
    return false;
  }
}
