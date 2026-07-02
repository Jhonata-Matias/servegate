/**
 * Auth middleware — validates X-API-Key header against the configured
 * GATEWAY_API_KEY allowlist (Story 2.10). Uses constant-time comparison
 * to mitigate timing attacks and iterates the full list without early-exit
 * so match-position is not leaked via timing.
 */

import type { Env } from './types.js';

/**
 * Constant-time string comparison.
 * Returns true if both strings are equal AND of equal length.
 * Implementation: XOR each char-code, accumulate; result is 0 iff identical.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still execute a dummy comparison loop to avoid length-leak via timing,
    // but result is guaranteed false.
    let dummy = 0;
    for (let i = 0; i < a.length; i++) {
      dummy |= a.charCodeAt(i) ^ a.charCodeAt(i);
    }
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Collects the set of currently-valid API keys from the Env, in order:
 * GATEWAY_API_KEY (required, tenant 1), then GATEWAY_API_KEY_2..4
 * (optional additional tenants — Story 2.10 interim allowlist, teto=4).
 *
 * Undefined/empty slots are filtered out. Callers can safely pass the
 * result to validateAuth even when only the primary key is configured.
 */
export function collectApiKeys(env: Env): string[] {
  const slots = [
    env.GATEWAY_API_KEY,
    env.GATEWAY_API_KEY_2,
    env.GATEWAY_API_KEY_3,
    env.GATEWAY_API_KEY_4,
  ];
  return slots.filter((k): k is string => typeof k === 'string' && k.length > 0);
}

/**
 * Validates the request's X-API-Key header against the configured allowlist.
 * Returns null on success, or a 401 Response on failure.
 *
 * SECURITY: the loop iterates every candidate without early-exit so that
 * total comparison time is O(sum of key lengths) regardless of which slot
 * matches — the response time cannot be used to fingerprint which tenant
 * a valid key belongs to.
 */
export function validateAuth(request: Request, keys: readonly string[]): Response | null {
  const provided = request.headers.get('X-API-Key');
  if (!provided) {
    return Response.json(
      { error: 'invalid_api_key', reason: 'missing_header' },
      { status: 401 },
    );
  }
  if (keys.length === 0) {
    // Defense-in-depth: should never happen if collectApiKeys is used and
    // GATEWAY_API_KEY is set (Env schema marks it required). Fail closed.
    return Response.json(
      { error: 'server_misconfigured', reason: 'no_api_keys_configured' },
      { status: 500 },
    );
  }
  let matched = false;
  for (const candidate of keys) {
    matched = constantTimeEqual(provided, candidate) || matched;
  }
  if (!matched) {
    return Response.json(
      { error: 'invalid_api_key', reason: 'mismatch' },
      { status: 401 },
    );
  }
  return null;
}
