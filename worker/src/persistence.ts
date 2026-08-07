import { neon } from '@neondatabase/serverless'

export interface UsageEvent {
  orgId: string
  refBrand: string
  refGarment: string
  refSize: string
  predictedSize: string
  confidence: number
  isBoundaryCase: boolean
  responseMs: number
}

export async function logUsageEvent(databaseUrl: string, event: UsageEvent): Promise<void> {
  try {
    const sql = neon(databaseUrl)
    await sql`
      INSERT INTO usage_logs (
        org_id, ref_brand, ref_garment, ref_size, predicted_size,
        confidence, is_boundary_case, response_ms
      ) VALUES (
        ${event.orgId}, ${event.refBrand}, ${event.refGarment}, ${event.refSize}, ${event.predictedSize},
        ${event.confidence}, ${event.isBoundaryCase}, ${event.responseMs}
      )
    `
  } catch (error) {
    console.error(JSON.stringify({ event: 'usage_log_failed', orgId: event.orgId, message: errorMessage(error) }))
  }
}

export async function syncTrialUsage(databaseUrl: string, orgId: string, remaining: number): Promise<void> {
  try {
    const sql = neon(databaseUrl)
    await sql`
      UPDATE organizations
      SET
        trial_requests_remaining = ${remaining},
        trial_exhausted_at = CASE
          WHEN ${remaining} = 0 AND trial_exhausted_at IS NULL THEN NOW()
          WHEN ${remaining} > 0 THEN NULL
          ELSE trial_exhausted_at
        END,
        updated_at = NOW()
      WHERE id = ${orgId}
    `
  } catch (error) {
    console.error(JSON.stringify({ event: 'usage_sync_failed', orgId, remaining, message: errorMessage(error) }))
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
