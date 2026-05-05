import type { Env, RateLimitState, TokenBudgetState } from './types.js';

const DAILY_LIMIT = 100;
const TOKEN_DAILY_LIMIT = 50000;
export const VIDEO_DAILY_LIMIT_DEFAULT = 20;
const KV_TTL_SECONDS = 48 * 60 * 60; // 48h auto-cleanup

export interface VideoQuotaCheck {
  allowed: boolean;
  limit: number;
  count: number;
  resetAt: string; // ISO 8601 UTC midnight tomorrow
}

export interface VideoQuotaIncrementResult {
  incremented: boolean; // false on idempotent re-call
  count: number;
}

/**
 * Computes the KV key for today's UTC date (YYYY-MM-DD).
 * Exported for testability.
 */
export function dayKey(now: Date = new Date()): string {
  return `count:${now.toISOString().slice(0, 10)}`;
}

/**
 * Computes the KV key for today's UTC token budget (YYYY-MM-DD).
 * Parallel namespace to image request count keys.
 */
export function tokenDayKey(now: Date = new Date()): string {
  return `tokens:${now.toISOString().slice(0, 10)}`;
}

function videoCounterKey(dateUTC: string, apiKeyHash: string): string {
  return `videos:${dateUTC}:${apiKeyHash}`;
}

function videoJobMarkerKey(dateUTC: string, apiKeyHash: string, jobId: string): string {
  return `${videoCounterKey(dateUTC, apiKeyHash)}:job:${jobId}`;
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

function nextUtcMidnightIsoFromDateUTC(dateUTC: string): string {
  return new Date(Date.parse(`${dateUTC}T00:00:00.000Z`) + 24 * 3600 * 1000).toISOString();
}

function videoDailyLimit(env: Env): number {
  const parsed = Number.parseInt(env.VIDEO_DAILY_LIMIT ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : VIDEO_DAILY_LIMIT_DEFAULT;
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
 * Pre-flight video quota check + reservation.
 *
 * Reads the current video count for {apiKeyHash} for the UTC day, and:
 * - if count >= VIDEO_DAILY_LIMIT, returns { allowed: false, limit, count, resetAt }
 * - if count <  VIDEO_DAILY_LIMIT, returns { allowed: true, limit, count, resetAt }
 *
 * Does NOT increment yet — the increment happens post-flight in
 * `incrementVideoQuotaPostFlight` after the job actually completes.
 */
export async function checkVideoQuota(
  env: Env,
  apiKeyHash: string,
  dateUTC: string,
): Promise<VideoQuotaCheck> {
  const raw = await env.VIDEOS_KV.get(videoCounterKey(dateUTC, apiKeyHash));
  const count = raw ? Number.parseInt(raw, 10) || 0 : 0;
  const limit = videoDailyLimit(env);

  return {
    allowed: count < limit,
    limit,
    count,
    resetAt: nextUtcMidnightIsoFromDateUTC(dateUTC),
  };
}

/**
 * Post-flight increment, idempotent by jobId.
 *
 * Reads the current per-day count and a per-jobId marker. If the marker for
 * this jobId is already set, returns { incremented: false, count } and does
 * nothing (idempotent on poll loops). Otherwise atomically increments the
 * counter and sets the marker.
 *
 * Marker key: `videos:YYYY-MM-DD:{apiKeyHash}:job:{jobId}` with TTL 48h.
 * Counter key: `videos:YYYY-MM-DD:{apiKeyHash}` with TTL 48h.
 */
export async function incrementVideoQuotaPostFlight(
  env: Env,
  apiKeyHash: string,
  dateUTC: string,
  jobId: string,
): Promise<VideoQuotaIncrementResult> {
  const counterKey = videoCounterKey(dateUTC, apiKeyHash);
  const markerKey = videoJobMarkerKey(dateUTC, apiKeyHash, jobId);
  const [rawCount, marker] = await Promise.all([
    env.VIDEOS_KV.get(counterKey),
    env.VIDEOS_KV.get(markerKey),
  ]);
  const count = rawCount ? Number.parseInt(rawCount, 10) || 0 : 0;

  if (marker !== null) {
    return { incremented: false, count };
  }

  const nextCount = count + 1;
  await Promise.all([
    env.VIDEOS_KV.put(counterKey, String(nextCount), { expirationTtl: KV_TTL_SECONDS }),
    env.VIDEOS_KV.put(markerKey, '1', { expirationTtl: KV_TTL_SECONDS }),
  ]);

  return { incremented: true, count: nextCount };
}

export async function readTokenBudget(
  kv: KVNamespace,
  now: Date = new Date(),
): Promise<TokenBudgetState> {
  const key = tokenDayKey(now);
  const raw = await kv.get(key);
  const used = raw ? Number.parseInt(raw, 10) || 0 : 0;

  return {
    used,
    remaining: Math.max(0, TOKEN_DAILY_LIMIT - used),
    resetAt: nextUtcMidnightIso(now),
    secondsUntilReset: secondsUntilNextUtcMidnight(now),
  };
}

/**
 * Checks whether estimated text tokens fit the daily budget before the provider call.
 *
 * READ-ONLY BY DESIGN. The exact budget update happens post-flight via
 * `recordTokenUsage` in `ctx.waitUntil(...)` after upstream `usage.total_tokens`
 * is known. See `gemma-gateway-decision.md` §5 — KV eventual-consistency tradeoff
 * is accepted (≤10% concurrent overshoot, same model as the image-gen counter
 * from Epic 2 Story 2.5 R7). Adding a pre-flight `kv.put` here would double the
 * KV writes per call (eats free-tier quota; see backlog FU-4.2.1) without
 * preventing the race that Cloudflare KV is eventually consistent on globally.
 */
export async function checkTokenBudget(
  kv: KVNamespace,
  approxTokens: number,
  now: Date = new Date(),
): Promise<{ state: TokenBudgetState; allowed: boolean }> {
  const raw = await kv.get(tokenDayKey(now));
  const used = raw ? Number.parseInt(raw, 10) || 0 : 0;
  const resetAt = nextUtcMidnightIso(now);
  const secondsUntilReset = secondsUntilNextUtcMidnight(now);
  const reservation = Math.max(0, Math.ceil(approxTokens));

  if (used + reservation > TOKEN_DAILY_LIMIT) {
    return {
      allowed: false,
      state: {
        used,
        remaining: Math.max(0, TOKEN_DAILY_LIMIT - used),
        resetAt,
        secondsUntilReset,
      },
    };
  }

  return {
    allowed: true,
    state: {
      used,
      remaining: TOKEN_DAILY_LIMIT - used,
      resetAt,
      secondsUntilReset,
    },
  };
}

export async function recordTokenUsage(
  kv: KVNamespace,
  tokens: number,
  now: Date = new Date(),
): Promise<TokenBudgetState> {
  const key = tokenDayKey(now);
  const raw = await kv.get(key);
  const used = raw ? Number.parseInt(raw, 10) || 0 : 0;
  const nextUsed = Math.max(0, used + Math.max(0, Math.ceil(tokens)));
  await kv.put(key, String(nextUsed), { expirationTtl: KV_TTL_SECONDS });

  return {
    used: nextUsed,
    remaining: Math.max(0, TOKEN_DAILY_LIMIT - nextUsed),
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

export { DAILY_LIMIT, TOKEN_DAILY_LIMIT };
