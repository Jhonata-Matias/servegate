/**
 * gemma4 Cloudflare Worker Gateway — Story 2.5
 *
 * Single public entry for FLUX image generation:
 *   POST /  → auth (X-API-Key) → rate-limit (100/day UTC) → proxy RunPod Serverless
 *
 * Responses:
 *   200 — proxy success (passthrough RunPod body + X-RateLimit-* headers)
 *   401 — invalid_api_key (auth failed)
 *   429 — rate_limit_exceeded (with Retry-After + reset_at)
 *   405 — method_not_allowed (only POST accepted)
 *   502 — upstream_error (RunPod 5xx)
 *   503 — network_error (fetch failed)
 *   504 — upstream_timeout (>60s)
 *
 * Privacy: NEVER logs prompt content or image bytes.
 * Security: RUNPOD_API_KEY never returned to client.
 */

import { validateAuth } from './auth.js';
import { log, getClientIp } from './log.js';
import { buildRateLimitResponse, checkAndIncrement } from './rate-limit.js';
import { proxyToRunpod } from './proxy.js';
import type { Env } from './types.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const start = Date.now();
    const ip = getClientIp(request);

    // 1. Method check (only POST accepted)
    if (request.method !== 'POST') {
      log({
        timestamp: Date.now(),
        event: 'invalid_method',
        ip,
        status: 405,
        elapsed_ms: Date.now() - start,
      });
      return Response.json(
        { error: 'method_not_allowed', allowed: ['POST'] },
        { status: 405, headers: { Allow: 'POST' } },
      );
    }

    // 2. Auth (constant-time comparison; runs BEFORE any KV op)
    const authFailure = validateAuth(request, env.GATEWAY_API_KEY);
    if (authFailure) {
      log({
        timestamp: Date.now(),
        event: 'auth_failed',
        ip,
        status: 401,
        elapsed_ms: Date.now() - start,
      });
      return authFailure;
    }

    // 3. Rate-limit (KV read + conditional increment)
    const { state, allowed } = await checkAndIncrement(env.RATE_LIMIT_KV);
    if (!allowed) {
      log({
        timestamp: Date.now(),
        event: 'rate_limited',
        ip,
        status: 429,
        elapsed_ms: Date.now() - start,
        day_count: state.count,
      });
      return buildRateLimitResponse(state);
    }

    // 4. Proxy to RunPod (auth header injected; body passthrough)
    const response = await proxyToRunpod(request, env, state);
    log({
      timestamp: Date.now(),
      event: response.status < 400 ? 'proxy_success' : 'proxy_error',
      ip,
      status: response.status,
      elapsed_ms: Date.now() - start,
      day_count: state.count,
    });
    return response;
  },
};
