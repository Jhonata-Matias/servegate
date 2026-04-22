/**
 * Cloudflare Worker bindings for servegate gateway (Story 2.5, formerly gemma4).
 * Bindings configured in wrangler.toml + secrets via `wrangler secret put`.
 */

export interface Env {
  // KV namespace for rate-limit counter
  RATE_LIMIT_KV: KVNamespace;

  // Secrets (configured via `wrangler secret put`)
  GATEWAY_API_KEY: string;
  RUNPOD_API_KEY: string;
  RUNPOD_ENDPOINT_ID: string;
}

export interface RateLimitState {
  count: number;
  remaining: number;
  resetAt: string; // ISO-8601
  secondsUntilReset: number;
}

export interface LogEvent {
  timestamp: number;
  event: 'auth_failed' | 'rate_limited' | 'proxy_success' | 'proxy_error' | 'invalid_method';
  ip: string | null;
  status: number;
  elapsed_ms: number;
  day_count?: number;
}
