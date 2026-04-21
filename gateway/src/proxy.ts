import type { Env, RateLimitState } from './types.js';

const RUNPOD_TIMEOUT_MS = 60_000; // 60s — Cloudflare Worker max CPU is 30s but fetch can wait longer
const DAILY_LIMIT = 100;

/**
 * Proxies request to RunPod Serverless endpoint.
 * Adds Authorization header with RUNPOD_API_KEY (NEVER returned to client).
 * Adds X-RateLimit-* headers based on current rate-limit state.
 *
 * Returns:
 * - Upstream response with rate-limit headers added (success path)
 * - 502 if upstream returns 5xx
 * - 504 if upstream times out
 * - 503 if network error
 */
export async function proxyToRunpod(
  request: Request,
  env: Env,
  rateLimitState: RateLimitState,
): Promise<Response> {
  const url = `https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT_ID}/runsync`;
  const body = await request.text();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNPOD_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });

    const responseBody = await upstream.text();
    const headers: Record<string, string> = {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'X-RateLimit-Limit': String(DAILY_LIMIT),
      'X-RateLimit-Remaining': String(rateLimitState.remaining),
      'X-RateLimit-Reset': rateLimitState.resetAt,
    };

    // Map 5xx to 502 to surface upstream issue without exposing internals
    if (upstream.status >= 500) {
      return Response.json(
        { error: 'upstream_error', upstream_status: upstream.status },
        { status: 502, headers },
      );
    }

    return new Response(responseBody, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return Response.json(
        { error: 'upstream_timeout', timeout_ms: RUNPOD_TIMEOUT_MS },
        {
          status: 504,
          headers: rateLimitHeaders(rateLimitState),
        },
      );
    }
    return Response.json(
      { error: 'network_error' },
      {
        status: 503,
        headers: rateLimitHeaders(rateLimitState),
      },
    );
  } finally {
    clearTimeout(timer);
  }
}

function rateLimitHeaders(state: RateLimitState): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(DAILY_LIMIT),
    'X-RateLimit-Remaining': String(state.remaining),
    'X-RateLimit-Reset': state.resetAt,
  };
}
