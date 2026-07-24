/**
 * servegate Cloudflare Worker Gateway — async submit/poll refactor.
 *
 * Original: Story 2.5 (sync proxy). Refactored 2026-04-23 for
 * INC-2026-04-23-gateway-504 per ADR-0002 (async gateway pattern).
 *
 * Story 1.1 (OpenAI compat contract): Added /v1/chat/completions alias,
 * /v1/models endpoint, and envelope normalization (FR-1 through FR-4).
 *
 * Public contract:
 *   POST /v1/chat/completions → alias → handleGenerate (Story 1.1 FR-1)
 *   GET  /v1/models          → model catalog (Story 1.1 FR-2)
 *   GET  /v1/models/{id}     → single model lookup (Story 1.1 FR-2)
 *   POST /v1/generate        → text generation SSE/non-streaming
 *   POST /jobs               → auth → rate-limit → RunPod /run → 202
 *   GET  /jobs/{id}          → auth → KV read → RunPod /status → 200|202|404|504|500
 *   GET  /capabilities       → public capability discovery
 *   GET  /videos/{id}        → token-authenticated R2 video proxy
 *   POST /                   → 404 (legacy removed)
 *   Other                    → 405 method_not_allowed
 *
 * Architectural decisions honored:
 *   - AD-1: /status response carries image_b64 INLINE in output — no /view fetch
 *   - AD-2: SDK adopts TimeoutError; gateway itself remains error-shape-agnostic
 *   - CON-3: serverless/handler.py unchanged (gateway treats input as opaque passthrough)
 *   - CON-4: NEVER logs prompt content or image bytes
 *   - CON-6: POST / returns 404 (no fallback)
 */

import { collectApiKeys, validateAuth } from './auth.js';
import { CAPABILITIES_RESPONSE } from './capabilities-constants.js';
import { handleCorsPreflight, handleGenerate } from './generate.js';
import { getClientIp, log } from './log.js';
import { handleModels } from './openai-models.js';
import {
  buildRateLimitResponse,
  checkAndIncrement,
  checkAndRead,
  DAILY_LIMIT,
  incrementVideoQuotaPostFlight,
} from './rate-limit.js';
import {
  readVideoMetadata,
  uploadVideoToR2,
  verifyVideoAccessToken,
  VIDEO_OBJECT_PREFIX,
  VIDEO_URL_TTL_SECONDS,
  type VideoMetadata,
} from './r2-video.js';
import { getMapping, putMapping, updateStatus } from './storage.js';
import { getStatus, mapStatus, submitJob, RunpodUpstreamError } from './runpod.js';
import { handleVideoSubmit } from './video.js';
import type { Env, JobMapping, JobStatus, RateLimitState } from './types.js';

const POLL_RETRY_AFTER_SECONDS = 5;
const GENERATION_TIMEOUT_S = 280; // aligned with RunPod COMFY_GENERATION_TIMEOUT_S (FR-4)

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const start = Date.now();
    const ip = getClientIp(request);
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    // -------- Routing ----------------------------------------------------
    // Global CORS preflight for image + text clients
    if (method === 'OPTIONS') {
      return handleCorsPreflight(env);
    }

    // -------- /v1/* OpenAI-compatible routes (Story 1.1) -----------------

    // POST /v1/chat/completions — alias to /v1/generate (FR-1)
    if (pathname === '/v1/chat/completions') {
      if (method !== 'POST') {
        return json(405, {
          error: {
            message: 'Method not allowed. Use POST.',
            type: 'invalid_request_error',
            code: 'method_not_allowed',
          },
        });
      }
      return handleGenerate(request, env, ctx);
    }

    // GET /v1/models — model catalog (FR-2)
    if (method === 'GET' && pathname === '/v1/models') {
      return handleModels(request, env);
    }

    // GET /v1/models/{id} — single model lookup (FR-2)
    const modelsMatch = method === 'GET' && /^\/v1\/models\/([^/]+)$/.exec(pathname);
    if (modelsMatch) {
      return handleModels(request, env, modelsMatch[1]);
    }

    // POST /v1/generate — text generation SSE/non-streaming endpoint
    if (method === 'POST' && pathname === '/v1/generate') {
      return handleGenerate(request, env, ctx);
    }

    // GET /capabilities — public capability discovery endpoint (Story 5.2 AC6)
    if (method === 'GET' && pathname === '/capabilities') {
      return new Response(JSON.stringify(CAPABILITIES_RESPONSE), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    // GET /videos/{id} — token-authenticated R2 video proxy (Story 5.2 AC3)
    const videoMatch = method === 'GET' && /^\/videos\/([^/]+)$/.exec(pathname);
    if (videoMatch) {
      const jobId = videoMatch[1];
      if (!jobId) {
        return json(404, { error: 'video_not_found' });
      }
      return handleVideoObject(request, env, ip, start, jobId);
    }

    // POST /jobs — new async submit
    if (method === 'POST' && pathname === '/jobs') {
      return routeSubmit(request, env, ip, start);
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

async function routeSubmit(
  request: Request,
  env: Env,
  ip: string | null,
  start: number,
): Promise<Response> {
  const authFailure = validateAuth(request, collectApiKeys(env));
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

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return handleSubmit(request, env, ip, start);
  }

  const kind = isRecord(body) ? body.kind : undefined;
  if (kind === undefined || kind === 'image') {
    return handleSubmit(request, env, ip, start);
  }

  if (kind === 'video') {
    return handleVideoSubmit(request, env, ip, start);
  }

  return json(400, { error: 'unsupported_kind', supported: ['image', 'video'] });
}

async function handleSubmit(
  request: Request,
  env: Env,
  ip: string | null,
  start: number,
): Promise<Response> {
  // 1. Auth
  const authFailure = validateAuth(request, collectApiKeys(env));
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
  const authFailure = validateAuth(request, collectApiKeys(env));
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

  // 3. Look up mapping in KV (cacheTtl default 30s min per Workers KV, storage.ts)
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

  if (mapping.kind === 'video') {
    return handleVideoStatus(request, env, ip, start, jobId, mapping, rlState);
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

async function handleVideoStatus(
  request: Request,
  env: Env,
  ip: string | null,
  start: number,
  jobId: string,
  mapping: JobMapping,
  rlState: RateLimitState,
): Promise<Response> {
  if (mapping.status === 'completed') {
    const cached = await getVideoOutputCache(env, jobId);
    if (cached) {
      return json(200, videoCompletedBody(cached), rateLimitHeaders(rlState));
    }
  }

  let runpodStatus;
  try {
    runpodStatus = await getStatus(env, mapping.runpod_request_id, {
      endpointId: mapping.runpod_endpoint_id ?? env.RUNPOD_LTX_ENDPOINT_ID ?? env.RUNPOD_ENDPOINT_ID,
    });
  } catch (err) {
    return handleUpstreamError(err, ip, start, rlState, jobId);
  }

  const gatewayStatus: JobStatus = mapStatus(runpodStatus.status);
  if (gatewayStatus !== 'completed') {
    if (gatewayStatus === 'queued' || gatewayStatus === 'running') {
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
          est_wait_seconds: 'unknown',
        },
        {
          'Retry-After': String(POLL_RETRY_AFTER_SECONDS),
          ...rateLimitHeaders(rlState),
        },
      );
    }

    const errorCode = gatewayStatus === 'timeout'
      ? 'generation_timeout'
      : gatewayStatus === 'cancelled'
        ? 'runpod_cancelled'
        : 'runpod_failed';
    try {
      await updateStatus(env.JOBS_KV, jobId, gatewayStatus, { error_code: errorCode });
    } catch {
      // Non-fatal: client still receives the terminal failure response.
    }
    log({
      timestamp: Date.now(),
      event: 'job_polled',
      ip,
      status: 500,
      elapsed_ms: Date.now() - start,
      job_id: jobId,
      job_status: gatewayStatus,
      error_code: errorCode,
    });
    return json(
      500,
      {
        status: 'failed',
        error: {
          code: errorCode,
          message: runpodStatus.output?.error ?? 'Video generation failed',
        },
        retryable: gatewayStatus === 'timeout',
      },
      rateLimitHeaders(rlState),
    );
  }

  const cached = await getVideoOutputCache(env, jobId);
  if (cached) {
    return json(200, videoCompletedBody(cached), rateLimitHeaders(rlState));
  }

  const videoB64 = runpodStatus.output?.video_b64;
  if (typeof videoB64 !== 'string' || videoB64.length === 0) {
    return json(
      500,
      {
        status: 'failed',
        error: {
          code: 'missing_video_output',
          message: 'RunPod completed without video_b64 output',
        },
        retryable: true,
      },
      rateLimitHeaders(rlState),
    );
  }

  const metadata = readVideoMetadata(runpodStatus.output?.metadata ?? {});
  const submittedAt = mapping.submitted_at ?? new Date(mapping.created_at).toISOString();
  const apiKeyHash = mapping.api_key_hash ?? await hashApiKey(request.headers.get('X-API-Key') ?? '');
  let upload;
  try {
    upload = await uploadVideoToR2(env, jobId, videoB64, { submittedAt, apiKeyHash });
  } catch (err) {
    return json(
      500,
      {
        status: 'failed',
        error: {
          code: 'r2_upload_failed',
          message: err instanceof Error ? err.message : 'R2 upload failed',
        },
        retryable: true,
      },
      rateLimitHeaders(rlState),
    );
  }

  const metrics = videoMetrics(runpodStatus.delayTime, runpodStatus.executionTime);
  const cache: VideoOutputCache = {
    videoUrl: upload.videoUrl,
    objectKey: upload.objectKey,
    sizeBytes: upload.sizeBytes,
    ttlSeconds: upload.ttlSeconds,
    metadata,
    metrics,
  };

  try {
    await env.JOBS_KV.put(videoOutputCacheKey(jobId), JSON.stringify(cache), {
      expirationTtl: VIDEO_URL_TTL_SECONDS,
    });
    await updateStatus(env.JOBS_KV, jobId, gatewayStatus);
  } catch {
    // Cache/status persistence is best-effort; quota remains idempotent by jobId.
  }

  const dateUTC = submittedAt.slice(0, 10);
  await incrementVideoQuotaPostFlight(env, apiKeyHash, dateUTC, jobId);

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

  return json(200, videoCompletedBody(cache), rateLimitHeaders(rlState));
}

async function handleVideoObject(
  request: Request,
  env: Env,
  ip: string | null,
  start: number,
  jobId: string,
): Promise<Response> {
  const token = new URL(request.url).searchParams.get('t');
  if (!token) {
    return json(401, { error: 'invalid_video_token' });
  }

  const tokenCheck = await verifyVideoAccessToken(env, jobId, token);
  if (!tokenCheck.valid) {
    log({
      timestamp: Date.now(),
      event: 'job_polled',
      ip,
      status: 401,
      elapsed_ms: Date.now() - start,
      job_id: jobId,
      error_code: `video_token_${tokenCheck.reason ?? 'invalid'}`,
    });
    return json(401, { error: 'invalid_video_token' });
  }

  const object = await env.R2_VIDEOS_BUCKET.get(`${VIDEO_OBJECT_PREFIX}/${jobId}.mp4`);
  if (!object) {
    return json(404, { error: 'video_not_found' });
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(object.size),
      'Cache-Control': `private, max-age=${VIDEO_URL_TTL_SECONDS}`,
    },
  });
}

// ===========================================================================
// Shared helpers
// ===========================================================================

interface VideoOutputCache {
  videoUrl: string;
  objectKey: string;
  sizeBytes: number;
  ttlSeconds: number;
  metadata: VideoMetadata;
  metrics: VideoMetrics;
}

interface VideoMetrics {
  queue_seconds: number;
  execution_seconds: number;
  wallclock_seconds: number;
}

function videoOutputCacheKey(jobId: string): string {
  return `video-output:${jobId}`;
}

async function getVideoOutputCache(env: Env, jobId: string): Promise<VideoOutputCache | null> {
  const raw = await env.JOBS_KV.get(videoOutputCacheKey(jobId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VideoOutputCache;
    if (
      typeof parsed.videoUrl !== 'string' ||
      typeof parsed.objectKey !== 'string' ||
      typeof parsed.sizeBytes !== 'number' ||
      typeof parsed.ttlSeconds !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function videoCompletedBody(cache: VideoOutputCache): unknown {
  return {
    status: 'completed',
    output: {
      video_url: cache.videoUrl,
      duration_seconds: cache.metadata.duration_seconds,
      width: cache.metadata.width,
      height: cache.metadata.height,
      fps: cache.metadata.fps,
      size_bytes: cache.sizeBytes,
      url_ttl_seconds: cache.ttlSeconds,
    },
    metrics: cache.metrics,
  };
}

function videoMetrics(delayTime?: number, executionTime?: number): VideoMetrics {
  const queueSeconds = millisecondsToSeconds(delayTime);
  const executionSeconds = millisecondsToSeconds(executionTime);
  return {
    queue_seconds: queueSeconds,
    execution_seconds: executionSeconds,
    wallclock_seconds: roundSeconds(queueSeconds + executionSeconds),
  };
}

function millisecondsToSeconds(value: number | undefined): number {
  return roundSeconds(typeof value === 'number' && Number.isFinite(value) ? value / 1000 : 0);
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function hashApiKey(apiKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
