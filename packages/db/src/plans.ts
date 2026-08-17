export const PLANS = {
  trial: { priceInr: 0, monthlyRequests: 1000 },
  starter: { priceInr: 499, monthlyRequests: 3000 },
  growth: { priceInr: 999, monthlyRequests: 10000 },
} as const

export type PlanTier = keyof typeof PLANS

export function isPlanTier(value: unknown): value is PlanTier {
  return value === 'trial' || value === 'starter' || value === 'growth'
}

export function monthlyRequestsFor(tier: PlanTier): number {
  return PLANS[tier].monthlyRequests
}
