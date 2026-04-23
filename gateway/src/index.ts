/**
 * servegate Cloudflare Worker Gateway — async submit/poll refactor.
 *
 * Original: Story 2.5 (sync proxy). Refactored 2026-04-23 for
 * INC-2026-04-23-gateway-504 per ADR-0002 (async gateway pattern).
 *
 * Public contract (single):
 *   POST /jobs         → auth → rate-limit → RunPod /run → 202 + {job_id, status_url, est_wait_seconds:"unknown"}
 *                        + headers: Location: /jobs/{job_id}, Retry-After: 5
 *   GET  /jobs/{id}    → auth → KV read → RunPod /status → 200 (done) | 202 (running) | 404 (gone) | 504 (timeout) | 500 (failed/cancelled)
 *                        GET does NOT consume rate-limit quota (EC-5)
 *   POST /             → 404 + {error:"endpoint_removed", migration_doc:"/docs/api/migration-async.md"} (CON-6, EC-8)
 *   Other              → 405 method_not_allowed
 *
 * Architectural decisions honored:
 *   - AD-1: /status response carries image_b64 INLINE in output — no /view fetch
 *   - AD-2: SDK adopts TimeoutError; gateway itself remains error-shape-agnostic
 *   - CON-3: serverless/handler.py unchanged (gateway treats input as opaque passthrough)
 *   - CON-4: NEVER logs prompt content or image bytes
 *   - CON-6: POST / returns 404 (no fallback)
 */

import { validateAuth } from './auth.js';
import { getClientIp, log } from './log.js';
import {
  buildRateLimitResponse,
  checkAndIncrement,
  checkAndRead,
  DAILY_LIMIT,
} from './rate-limit.js';
import { getMapping, putMapping, updateStatus } from './storage.js';
import { getStatus, mapStatus, submitJob, RunpodUpstreamError } from './runpod.js';
import type { Env, JobMapping, JobStatus, RateLimitState } from './types.js';

const POLL_RETRY_AFTER_SECONDS = 5;
const GENERATION_TIMEOUT_S = 280; // aligned with RunPod COMFY_GENERATION_TIMEOUT_S (FR-4)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const start = Date.now();
    const ip = getClientIp(request);
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    // -------- Routing ----------------------------------------------------
    // POST /jobs — new async submit
    if (method === 'POST' && pathname === '/jobs') {
      return handleSubmit(request, env, ip, start);
    }

    // GET /jobs/{id} — poll status
    const statusMatch = method === 'GET' && /^\/jobs\/([^/]+)$/.exec(pathname);
    if (statusMatch) {
      const jobId = statusMatch[1];
      if (!jobId) {
        return json(405, { error: 'method_not_allowed', allowed: ['POST /jobs', 'GET /jobs/{id}'] });
      }
      return handleStatus(request, env, ip, start, jobId);
    }

    // Legacy POST / — removed per CON-6 (EC-8)
    if (method === 'POST' && pathname === '/') {
      log({
        timestamp: Date.now(),
        event: 'legacy_endpoint_rejected',
        ip,
        status: 404,
        elapsed_ms: Date.now() - start,
      });
      return json(
        404,
        {
          error: 'endpoint_removed',
          message: 'POST / was removed in v0.2.0. Use POST /jobs + GET /jobs/{id} instead.',
          migration_doc: '/docs/api/migration-async.md',
        },
      );
    }

    // Unknown route or method
    log({
      timestamp: Date.now(),
      event: 'invalid_method',
      ip,
      status: 405,
      elapsed_ms: Date.now() - start,
    });
    return json(
      405,
      { error: 'method_not_allowed', allowed: ['POST /jobs', 'GET /jobs/{id}'] },
      { Allow: 'POST, GET' },
    );
  },
};

// ===========================================================================
// POST /jobs handler (FR-1)
// ===========================================================================

async function handleSubmit(
  request: Request,
  env: Env,
  ip: string | null,
  start: number,
): Promise<Response> {
  // 1. Auth
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

  // 2. Rate-limit (submit-only consumption, EC-5)
  const { state: rlState, allowed } = await checkAndIncrement(env.RATE_LIMIT_KV);
  if (!allowed) {
    log({
      timestamp: Date.now(),
      event: 'rate_limited',
      ip,
      status: 429,
      elapsed_ms: Date.now() - start,
      day_count: rlState.count,
    });
    return buildRateLimitResponse(rlState);
  }

  // 3. Parse body
  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(
      400,
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      rateLimitHeaders(rlState),
    );
  }

  // 4. Submit to RunPod
  let runpodResponse;
  try {
    runpodResponse = await submitJob(env, input);
  } catch (err) {
    return handleUpstreamError(err, ip, start, rlState, /* jobId */ null);
  }

  // 5. Generate gateway job_id + persist mapping
  const jobId = crypto.randomUUID(); // NFR-4: UUID v4 non-enumerable
  const mapping: JobMapping = {
    job_id: jobId,
    runpod_request_id: runpodResponse.id,
    status: 'queued',
    created_at: Date.now(),
  };
  try {
    await putMapping(env.JOBS_KV, mapping);
  } catch (err) {
    // KV write failed — cannot track the job. Log and fail loud rather than
    // silently accepting an unpollable job. Not in original EC-* but defensive.
    log({
      timestamp: Date.now(),
      event: 'upstream_unavailable',
      ip,
      status: 503,
      elapsed_ms: Date.now() - start,
      error_code: 'kv_write_failed',
      runpod_request_id: runpodResponse.id,
    });
    return json(
      503,
      { error: 'storage_unavailable', message: 'Job submitted to upstream but could not be tracked' },
      rateLimitHeaders(rlState),
    );
  }

  // 6. Success — 202 with standard async headers (FR-1)
  log({
    timestamp: Date.now(),
    event: 'job_submitted',
    ip,
    status: 202,
    elapsed_ms: Date.now() - start,
    day_count: rlState.count,
    job_id: jobId,
    runpod_request_id: runpodResponse.id,
  });
  return json(
    202,
    {
      job_id: jobId,
      status_url: `/jobs/${jobId}`,
      est_wait_seconds: 'unknown', // FR-7 literal
    },
    {
      Location: `/jobs/${jobId}`,
      'Retry-After': String(POLL_RETRY_AFTER_SECONDS),
      ...rateLimitHeaders(rlState),
    },
  );
}

// ===========================================================================
// GET /jobs/{id} handler (FR-2)
// ===========================================================================

async function handleStatus(
  request: Request,
  env: Env,
  ip: string | null,
  start: number,
  jobId: string,
): Promise<Response> {
  // 1. Auth
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

  // 2. Rate-limit state (read-only — EC-5 GET does NOT consume)
  const rlState = await checkAndRead(env.RATE_LIMIT_KV);

  // 3. Look up mapping in KV (cacheTtl=5s for RT-1 mitigation, per storage.ts default)
  const mapping = await getMapping(env.JOBS_KV, jobId);
  if (!mapping) {
    log({
      timestamp: Date.now(),
      event: 'job_not_found',
      ip,
      status: 404,
      elapsed_ms: Date.now() - start,
      job_id: jobId,
    });
    // EC-2: unified — do not reveal if never-existed vs expired
    return json(
      404,
      { error: 'job_not_found_or_expired' },
      { 'Retry-After': String(POLL_RETRY_AFTER_SECONDS), ...rateLimitHeaders(rlState) },
    );
  }

  // 4. Query RunPod /status
  let runpodStatus;
  try {
    runpodStatus = await getStatus(env, mapping.runpod_request_id);
  } catch (err) {
    return handleUpstreamError(err, ip, start, rlState, jobId);
  }

  const gatewayStatus: JobStatus = mapStatus(runpodStatus.status);

  // 5. Decide response based on status
  // Terminal states update KV (extends lifetime or shortens TTL on completion)
  if (
    gatewayStatus === 'completed' ||
    gatewayStatus === 'failed' ||
    gatewayStatus === 'cancelled' ||
    gatewayStatus === 'timeout'
  ) {
    const errorCode = gatewayStatus === 'timeout'
      ? 'generation_timeout'
      : gatewayStatus === 'failed'
        ? 'runpod_failed'
        : gatewayStatus === 'cancelled'
          ? 'runpod_cancelled'
          : undefined;

    try {
      await updateStatus(env.JOBS_KV, jobId, gatewayStatus, errorCode ? { error_code: errorCode } : {});
    } catch {
      // Non-fatal: logging continues, client still gets terminal response
    }

    if (gatewayStatus === 'completed') {
      log({
        timestamp: Date.now(),
        event: 'job_completed',
        ip,
        status: 200,
        elapsed_ms: Date.now() - start,
        day_count: rlState.count,
        job_id: jobId,
        runpod_request_id: mapping.runpod_request_id,
        job_status: gatewayStatus,
      });
      return json(
        200,
        { output: runpodStatus.output ?? null },
        rateLimitHeaders(rlState),
      );
    }

    if (gatewayStatus === 'timeout') {
      log({
        timestamp: Date.now(),
        event: 'job_polled',
        ip,
        status: 504,
        elapsed_ms: Date.now() - start,
        job_id: jobId,
        job_status: gatewayStatus,
        ...(errorCode ? { error_code: errorCode } : {}),
      });
      return json(
        504,
        { error: 'generation_timeout', timeout_s: GENERATION_TIMEOUT_S },
        rateLimitHeaders(rlState),
      );
    }

    // failed or cancelled
    log({
      timestamp: Date.now(),
      event: 'job_polled',
      ip,
      status: 500,
      elapsed_ms: Date.now() - start,
      job_id: jobId,
      job_status: gatewayStatus,
      ...(errorCode ? { error_code: errorCode } : {}),
    });
    return json(
      500,
      { error: errorCode ?? 'generation_error', status: gatewayStatus },
      rateLimitHeaders(rlState),
    );
  }

  // Non-terminal — queued or running
  log({
    timestamp: Date.now(),
    event: 'job_polled',
    ip,
    status: 202,
    elapsed_ms: Date.now() - start,
    job_id: jobId,
    job_status: gatewayStatus,
  });
  return json(
    202,
    {
      status: gatewayStatus,
      est_wait_seconds: 'unknown', // FR-7 literal
    },
    {
      'Retry-After': String(POLL_RETRY_AFTER_SECONDS),
      ...rateLimitHeaders(rlState),
    },
  );
}

// ===========================================================================
// Shared helpers
// ===========================================================================

function handleUpstreamError(
  err: unknown,
  ip: string | null,
  start: number,
  rlState: RateLimitState,
  jobId: string | null,
): Response {
  const isUpstream = err instanceof RunpodUpstreamError;
  const kind = isUpstream ? err.kind : 'network';

  // Map kind → HTTP status (no user-facing leak of auth config details)
  let status: number;
  let errorCode: string;
  if (kind === 'timeout' || kind === 'network') {
    status = 503;
    errorCode = 'upstream_unavailable';
  } else if (kind === 'http_5xx') {
    status = 502;
    errorCode = 'upstream_error';
  } else if (kind === 'http_4xx') {
    // likely our auth/config issue — mask upstream details, surface generic 500
    status = 500;
    errorCode = 'gateway_configuration_error';
  } else {
    status = 502;
    errorCode = 'upstream_bad_shape';
  }

  log({
    timestamp: Date.now(),
    event: 'upstream_unavailable',
    ip,
    status,
    elapsed_ms: Date.now() - start,
    error_code: errorCode,
    ...(jobId ? { job_id: jobId } : {}),
  });

  return json(status, { error: errorCode }, rateLimitHeaders(rlState));
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function rateLimitHeaders(state: RateLimitState): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(DAILY_LIMIT),
    'X-RateLimit-Remaining': String(state.remaining),
    'X-RateLimit-Reset': state.resetAt,
  };
}
