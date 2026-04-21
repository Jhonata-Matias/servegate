import type { LogEvent } from './types.js';

/**
 * Structured logging — emits 1 JSON line per event.
 * Visible via `wrangler tail` and Cloudflare dashboard.
 *
 * NEVER logs:
 * - Request body (contains user prompt — privacy LGPD)
 * - Response body (contains image_b64 bytes)
 * - Secrets (RUNPOD_API_KEY, GATEWAY_API_KEY)
 */
export function log(event: LogEvent): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(event));
}

/**
 * Extracts client IP from Cloudflare-injected header.
 * Falls back to null if not present (local dev).
 */
export function getClientIp(request: Request): string | null {
  return request.headers.get('CF-Connecting-IP');
}
