/**
 * Auth middleware — validates X-API-Key header against the configured
 * GATEWAY_API_KEY allowlist (Story 2.10). Uses constant-time comparison
 * to mitigate timing attacks and iterates the full list without early-exit
 * so match-position is not leaked via timing.
 *
 * Story 1.1 (FR-4): Added validateAuthDual for OpenAI-compatible dual auth
 * (Authorization: Bearer + X-API-Key) on /v1/* routes.
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

// ===========================================================================
// Story 1.1 FR-4 — Dual auth for /v1/* routes
// ===========================================================================

/**
 * Result of dual-auth validation on /v1/* routes.
 *
 * - `ok`: both headers (if present) carry the same valid key, or exactly one
 *   header is present and valid.
 * - `divergent`: both Authorization: Bearer and X-API-Key are present but
 *   carry different values → 401 per FR-4.
 * - `missing`: neither header is present → 401.
 * - `invalid`: the provided key(s) don't match any configured key → 401.
 */
export type DualAuthResult =
  | { ok: true }
  | { ok: false; reason: 'divergent' | 'missing' | 'invalid' };

/**
 * Validates a request against the dual-auth scheme required by /v1/* routes
 * (Story 1.1 FR-4).
 *
 * Accepts `Authorization: Bearer <key>` OR `X-API-Key: <key>`. If both are
 * present, they MUST carry the same value — divergence is rejected with 401.
 *
 * Returns { ok: true } on success, or { ok: false, reason } on failure.
 * Callers should convert the result to a 401 Response with the OpenAI error
 * envelope (FR-6).
 */
export function validateAuthDual(request: Request, keys: readonly string[]): DualAuthResult {
  const bearerKey = extractBearer(request);
  const apiKey = request.headers.get('X-API-Key');

  // Both present — must match (FR-4 divergence check)
  if (bearerKey !== null && apiKey !== null) {
    if (!constantTimeEqual(bearerKey, apiKey)) {
      return { ok: false, reason: 'divergent' };
    }
    // Values match — validate the single key
    return matchKey(bearerKey, keys);
  }

  // Only Bearer present
  if (bearerKey !== null) {
    return matchKey(bearerKey, keys);
  }

  // Only X-API-Key present
  if (apiKey !== null) {
    return matchKey(apiKey, keys);
  }

  // Neither present
  return { ok: false, reason: 'missing' };
}

/**
 * Converts a DualAuthResult to an HTTP Response.
 * Uses the OpenAI error envelope format (FR-6).
 */
export function dualAuthResponse(result: DualAuthResult): Response {
  if (result.ok) return new Response(null, { status: 200 }); // should not be called on ok

  const body =
    result.reason === 'divergent'
      ? {
          error: {
            message: 'Conflicting authentication headers. Use either Authorization: Bearer OR X-API-Key, not both with different values.',
            type: 'authentication_error',
            code: 'invalid_api_key',
          },
        }
      : result.reason === 'missing'
        ? {
            error: {
              message: 'Missing authentication. Provide Authorization: Bearer <key> or X-API-Key header.',
              type: 'authentication_error',
              code: 'invalid_api_key',
            },
          }
        : {
            error: {
              message: 'Invalid API key.',
              type: 'authentication_error',
              code: 'invalid_api_key',
            },
          };

  return Response.json(body, { status: 401 });
}

// ===========================================================================
// Internal helpers
// ===========================================================================

/**
 * Extracts the Bearer token from the Authorization header.
 * Returns null if the header is absent or malformed.
 */
function extractBearer(request: Request): string | null {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

/**
 * Validates a single key against the allowlist.
 * Returns { ok: true } if matched, { ok: false, reason: 'invalid' } otherwise.
 */
function matchKey(key: string, keys: readonly string[]): DualAuthResult {
  if (keys.length === 0) {
    return { ok: false, reason: 'invalid' };
  }
  let matched = false;
  for (const candidate of keys) {
    matched = constantTimeEqual(key, candidate) || matched;
  }
  return matched ? { ok: true } : { ok: false, reason: 'invalid' };
}
