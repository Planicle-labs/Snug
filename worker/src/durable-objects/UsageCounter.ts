import type { DurableObjectState, SqlStorage } from "@cloudflare/workers-types";

const TRIAL_LIMIT = 1000;
const MILESTONE_STEP = 100;

export enum Actions {
  check_and_decrement_trial = "check_and_decrement_trial",
  record_conversion = "record_conversion",
  get_current_usage = "get_current_usage",
  upgrade = "upgrade",
  reset_billing_period = "reset_billing_period",
}

export interface UsageRequestBody {
  action: Actions | string;
  org_id: string;
  plan_tier?: "trial" | "paid";
  usage_remaining?: number;
}

export class UsageCounter {
  private state: DurableObjectState;
  private sql: SqlStorage;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.sql = state.storage.sql;
    this.initDb();
  }

  private initDb() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        org_id TEXT PRIMARY KEY,
        plan_tier TEXT NOT NULL DEFAULT 'trial',
        usage_remaining INTEGER NOT NULL DEFAULT 1000,
        monthly_conversions INTEGER NOT NULL DEFAULT 0,
        billing_start TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as UsageRequestBody;

      if (!body || !body.action || !body.org_id) {
        return Response.json(
          { error: "Missing required fields: action and org_id" },
          { status: 400 }
        );
      }

      if (body.action === Actions.check_and_decrement_trial) {
        // Single atomic UPDATE with RETURNING clause
        const cursor = this.sql.exec(
          `UPDATE usage 
           SET usage_remaining = usage_remaining - 1, updated_at = datetime('now') 
           WHERE org_id = ? AND usage_remaining > 0 
           RETURNING usage_remaining`,
          body.org_id
        );

        let row = cursor.one() as { usage_remaining: number } | null;

        if (!row) {
          // Check if org exists and is already exhausted vs new org
          const existing = this.sql.exec(
            "SELECT usage_remaining FROM usage WHERE org_id = ?",
            body.org_id
          ).one() as { usage_remaining: number } | null;

          if (existing && existing.usage_remaining <= 0) {
            return Response.json({
              allowed: false,
              usage_remaining: 0,
              trial_exhausted: true,
              milestone_crossed: false,
              checkpoint_value: null,
            });
          }

          // First request for new org: Insert with 999 (TRIAL_LIMIT - 1)
          const initialRemaining = TRIAL_LIMIT - 1;
          this.sql.exec(
            'INSERT INTO usage (org_id, usage_remaining, updated_at) VALUES (?, ?, datetime("now"))',
            body.org_id,
            initialRemaining
          );
          row = { usage_remaining: initialRemaining };
        }

        const newRemaining = row.usage_remaining;
        // Divisibility factor check (safe because decrement is always 1)
        const milestoneCrossed = newRemaining % MILESTONE_STEP === 0;

        return Response.json({
          allowed: true,
          usage_remaining: newRemaining,
          trial_exhausted: newRemaining === 0,
          milestone_crossed: milestoneCrossed,
          checkpoint_value: milestoneCrossed ? newRemaining : null,
        });
      }

      if (body.action === Actions.record_conversion) {
        const cursor = this.sql.exec(
          `UPDATE usage 
           SET monthly_conversions = monthly_conversions + 1, updated_at = datetime('now') 
           WHERE org_id = ? 
           RETURNING monthly_conversions`,
          body.org_id
        );
        let row = cursor.one() as { monthly_conversions: number } | null;

        if (!row) {
          this.sql.exec(
            'INSERT INTO usage (org_id, usage_remaining, monthly_conversions, updated_at) VALUES (?, ?, 1, datetime("now"))',
            body.org_id,
            TRIAL_LIMIT
          );
          return Response.json({ success: true, monthly_conversions: 1 });
        }

        return Response.json({ success: true, monthly_conversions: row.monthly_conversions });
      }

      if (body.action === Actions.get_current_usage) {
        const cursor = this.sql.exec(
          "SELECT usage_remaining, monthly_conversions, plan_tier FROM usage WHERE org_id = ?",
          body.org_id
        );
        let row = cursor.one() as {
          usage_remaining: number;
          monthly_conversions: number;
          plan_tier: string;
        } | null;

        if (!row) {
          this.sql.exec(
            'INSERT INTO usage (org_id, usage_remaining, updated_at) VALUES (?, ?, datetime("now"))',
            body.org_id,
            TRIAL_LIMIT
          );
          row = {
            usage_remaining: TRIAL_LIMIT,
            monthly_conversions: 0,
            plan_tier: "trial",
          };
        }

        return Response.json({
          allowed: row.usage_remaining > 0,
          usage_remaining: row.usage_remaining,
          monthly_conversions: row.monthly_conversions,
          plan_tier: row.plan_tier,
        });
      }

      if (body.action === Actions.reset_billing_period) {
        const targetUsage = body.usage_remaining ?? TRIAL_LIMIT;
        this.sql.exec(
          'UPDATE usage SET monthly_conversions = 0, usage_remaining = ?, updated_at = datetime("now"), billing_start = datetime("now") WHERE org_id = ?',
          targetUsage,
          body.org_id
        );
        return Response.json({ success: true, usage_remaining: targetUsage });
      }

      if (body.action === Actions.upgrade) {
        const newPlanTier = body.plan_tier || "paid";
        const newUsage = body.usage_remaining ?? 10000;
        this.sql.exec(
          'UPDATE usage SET plan_tier = ?, usage_remaining = ?, updated_at = datetime("now") WHERE org_id = ?',
          newPlanTier,
          newUsage,
          body.org_id
        );
        return Response.json({
          success: true,
          plan_tier: newPlanTier,
          usage_remaining: newUsage,
        });
      }

      return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    } catch (err: any) {
      return Response.json({ error: err.message || "Internal DO Error" }, { status: 500 });
    }
  }
}
