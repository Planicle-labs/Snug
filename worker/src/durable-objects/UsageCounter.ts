import type { DurableObjectState, SqlStorage } from "@cloudflare/workers-types";

const trial_limit = 1000

enum Actions{
  check_and_decrement_trial = "check_and_decrement_trial",
  record_conversion = "record_conversion",
  upgrade = "upgrade",
  reset_billing_period = "reset_billing_period"
}

export class UsageCounter{
  private state: DurableObjectState
  private sql: SqlStorage

  constructor(state: DurableObjectState) {
    this.state = state
    this.sql = state.storage.sql
    this.initDb()
  }

  private initDb() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        org_id TEXT PRIMARY KEY,
        plan_tier TEXT NOT NULL DEFAULT 'trial',
        usage_remaining INTEGER NOT NULL DEFAULT 1000,
        monthly_conversions INTEGER NOT NULL DEFAULT 0,
        billing_start TEXT NOT NULL DEFAULT (datetime('now'))
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
      `)
  }

  async fetch(request: Request): Promise<Response>{
    const body = await request.json() as {
      action: string
      org_id: string
    }

    if (body.action === Actions.check_and_decrement_trial) {
      const cursor = this.sql.exec(
        'SELECT usage_remaining from usage WHERE org_id = ?',
        body.org_id
      )
      let row = cursor.one() as { usage_remaining: number } | null

      if (!row) {
        this.sql.exec(
          'INSERT INTO usage (org_id, usage_remaining, updated_at) VALUES ( ?, ?, datetime("now") )',
          body.org_id, trial_limit
        )
        row = { usage_remaining: trial_limit }
      }
      if (row.usage_remaining <= 0) {
        return Response.json({ allowed: false, usage_remaining: 0, trial_exhausted: true })
      }

      // Decrement regardless of whether this is the last one
      this.sql.exec(
        'UPDATE usage SET usage_remaining = usage_remaining - 1, updated_at = datetime("now") WHERE org_id = ?',
        body.org_id
      )

      const newRemaining = row.usage_remaining - 1

      return Response.json({
        allowed: true,
        usage_remaining: newRemaining,
        trial_exhausted: newRemaining === 0
      })
    }
    if (body.action === Actions.record_conversion) {
      const cursor = this.sql.exec(
        'SELECT monthly_conversions from usage WHERE org_id = ?',
        body.org_id
      )
      let row = cursor.one() as { monthly_conversions: number }

      this.sql.exec(
        'UPDATE usage SET monthly_conversions = monthly_conversions + 1, updated_at = datetime("now") WHERE org_id = ?',
        body.org_id
      )
      return Response.json({
        success:true, monthly_conversions:row.monthly_conversions
      })
    }
    if (body.action === Actions.reset_billing_period) {
      this.sql.exec(
        'UPDATE usage SET monthly_conversions = 0, updated_at = datetime("now"), billing_start = datetime("now") WHERE org_id = ?',
        body.org_id
      )
      return Response.json({
        success:true
      })
    }
    if (body.action)
  }
}
