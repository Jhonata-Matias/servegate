import type { RateLimitState } from './types.js';

const DAILY_LIMIT = 100;
const KV_TTL_SECONDS = 48 * 60 * 60; // 48h auto-cleanup

/**
 * Computes the KV key for today's UTC date (YYYY-MM-DD).
 * Exported for testability.
 */
export function dayKey(now: Date = new Date()): string {
  return `count:${now.toISOString().slice(0, 10)}`;
}

/**
 * Computes seconds until next 00:00 UTC from `now`.
 */
export function secondsUntilNextUtcMidnight(now: Date = new Date()): number {
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
}

/**
 * Computes ISO-8601 timestamp of next 00:00 UTC.
 */
export function nextUtcMidnightIso(now: Date = new Date()): string {
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return tomorrow.toISOString();
}

/**
 * Reads rate-limit counter, increments if under cap, returns state.
 *
 * Behavior:
 * - If count >= 100 BEFORE increment → return state with `remaining: 0`,
 *   caller should respond 429 (no increment).
 * - If count < 100 → atomic-ish increment via KV put (eventual consistency
 *   trade-off accepted per Story 2.5 Risk R7), return state with new remaining.
 *
 * Trade-off: KV is eventually consistent globally; concurrent requests in
 * different regions may both read same count and both increment, causing
 * 1-2 imgs/day overshoot. Accepted per Epic 2 PRD.
 */
export async function checkAndIncrement(
  kv: KVNamespace,
  now: Date = new Date(),
): Promise<{ state: RateLimitState; allowed: boolean }> {
  const key = dayKey(now);
  const raw = await kv.get(key);
  const count = raw ? Number.parseInt(raw, 10) || 0 : 0;

  const resetAt = nextUtcMidnightIso(now);
  const secondsUntilReset = secondsUntilNextUtcMidnight(now);

  if (count >= DAILY_LIMIT) {
    return {
      allowed: false,
      state: {
        count,
        remaining: 0,
        resetAt,
        secondsUntilReset,
      },
    };
  }

  // Increment + persist with 48h TTL (auto-cleanup)
  const newCount = count + 1;
  await kv.put(key, String(newCount), { expirationTtl: KV_TTL_SECONDS });

  return {
    allowed: true,
    state: {
      count: newCount,
      remaining: DAILY_LIMIT - newCount,
      resetAt,
      secondsUntilReset,
    },
  };
}

/**
 * Reads the current rate-limit counter WITHOUT mutating. Used by GET /jobs/{id}
 * handlers so polling does NOT consume quota (EC-5 — INC-2026-04-23-gateway-504).
 *
 * Returns the same RateLimitState shape so callers can populate X-RateLimit-*
 * response headers consistently with the submit path.
 */
export async function checkAndRead(
  kv: KVNamespace,
  now: Date = new Date(),
): Promise<RateLimitState> {
  const key = dayKey(now);
  const raw = await kv.get(key);
  const count = raw ? Number.parseInt(raw, 10) || 0 : 0;

  return {
    count,
    remaining: Math.max(0, DAILY_LIMIT - count),
    resetAt: nextUtcMidnightIso(now),
    secondsUntilReset: secondsUntilNextUtcMidnight(now),
  };
}

/**
 * Builds a 429 Response with Retry-After header + structured body.
 */
export function buildRateLimitResponse(state: RateLimitState): Response {
  return Response.json(
    {
      error: 'rate_limit_exceeded',
      limit: DAILY_LIMIT,
      reset_at: state.resetAt,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(state.secondsUntilReset),
        'X-RateLimit-Limit': String(DAILY_LIMIT),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': state.resetAt,
      },
    },
  );
}

export { DAILY_LIMIT };
