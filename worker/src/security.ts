const encoder = new TextEncoder()

/**
 * Compares two values without exposing the first mismatching byte through timing.
 * Hashing gives both inputs a fixed, equal-length representation before comparison.
 */
export async function timingSafeSecretEqual(expected: string, supplied: string): Promise<boolean> {
  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
  ])

  return crypto.subtle.timingSafeEqual(expectedDigest, suppliedDigest)
}
