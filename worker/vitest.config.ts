import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          INTERNAL_ADMIN_SECRET: 'test-admin-secret-key',
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/neondb',
          USAGE_SYNC_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/neondb',
        },
      },
    }),
  ],
  test: {
    globals: true,
    pool: '@cloudflare/vitest-pool-workers',
  },
})
