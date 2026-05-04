import { validateAuth } from './auth.js';
import { log } from './log.js';
import {
  DAILY_LIMIT,
  buildRateLimitResponse,
  checkAndIncrement,
} from './rate-limit.js';
import { RunpodUpstreamError, submitJob } from './runpod.js';
import { putMapping } from './storage.js';
import type { Env, JobMapping, RateLimitState, VideoSubmitRequest, VideoSubmitResponse } from './types.js';

const POLL_RETRY_AFTER_SECONDS = 5;
const MAX_PROMPT_CHARS = 2000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_FIELDS = new Set([
  'kind',
  'prompt',
  'negative_prompt',
  'image',
  'num_frames',
  'fps',
  'guidance_scale',
  'steps',
  'seed',
]);

const EST_WAIT_SECONDS: VideoSubmitResponse['est_wait_seconds'] = {
  p50: 90,
  p95: 200,
  first_call_max: 600,
};

export async function handleVideoSubmit(
  request: Request,
  env: Env,
  ip: string | null,
  start: number,
): Promise<Response> {
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

  // TODO Task 3: switch to video-specific quota.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      400,
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      rateLimitHeaders(rlState),
    );
  }

  const validation = validateVideoRequest(body);
  if (!validation.ok) {
    return json(
      400,
      { error: 'invalid_input', field: validation.field, reason: validation.reason },
      rateLimitHeaders(rlState),
    );
  }

  const endpointId = env.RUNPOD_LTX_ENDPOINT_ID;
  if (!endpointId) {
    log({
      timestamp: Date.now(),
      event: 'upstream_unavailable',
      ip,
      status: 500,
      elapsed_ms: Date.now() - start,
      error_code: 'missing_ltx_endpoint',
    });
    return json(
      500,
      { error: 'gateway_configuration_error' },
      rateLimitHeaders(rlState),
    );
  }

  const { kind: _kind, ...runpodInput } = validation.value;
  let runpodResponse;
  try {
    runpodResponse = await submitJob(env, runpodInput, { endpointId });
  } catch (err) {
    return handleVideoUpstreamError(err, ip, start, rlState);
  }

  const jobId = crypto.randomUUID();
  const mapping: JobMapping = {
    job_id: jobId,
    runpod_request_id: runpodResponse.id,
    kind: 'video',
    status: 'queued',
    created_at: Date.now(),
  };

  try {
    await putMapping(env.JOBS_KV, mapping);
  } catch {
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
      { error: 'storage_unavailable', retryable: true },
      rateLimitHeaders(rlState),
    );
  }

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
      est_wait_seconds: EST_WAIT_SECONDS,
    } satisfies VideoSubmitResponse,
    {
      Location: `/jobs/${jobId}`,
      'Retry-After': String(POLL_RETRY_AFTER_SECONDS),
      ...rateLimitHeaders(rlState),
    },
  );
}

type ValidationResult =
  | { ok: true; value: VideoSubmitRequest }
  | { ok: false; field: string; reason: string };

function validateVideoRequest(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return invalid('body', 'must be an object');
  }

  for (const field of Object.keys(body)) {
    if (!SUPPORTED_FIELDS.has(field)) {
      return invalid(field, 'unsupported field');
    }
  }

  if (body.kind !== 'video') {
    return invalid('kind', 'must be video');
  }

  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    return invalid('prompt', 'must be non-empty');
  }
  if (body.prompt.length > MAX_PROMPT_CHARS) {
    return invalid('prompt', `must be <= ${MAX_PROMPT_CHARS} chars`);
  }

  if (body.negative_prompt !== undefined && typeof body.negative_prompt !== 'string') {
    return invalid('negative_prompt', 'must be a string');
  }

  if (body.image !== undefined) {
    if (typeof body.image !== 'string') {
      return invalid('image', 'must be a data URL');
    }
    const imageValidation = validateImageDataUrl(body.image);
    if (!imageValidation.ok) {
      return invalid('image', imageValidation.reason);
    }
  }

  const numericValidation =
    validateNumberInRange(body, 'num_frames', 1, 121, true) ??
    validateNumberInRange(body, 'fps', 1, 60, true) ??
    validateNumberInRange(body, 'guidance_scale', 0, 20, false) ??
    validateNumberInRange(body, 'steps', 1, 80, true);
  if (numericValidation) return numericValidation;

  return {
    ok: true,
    value: body as unknown as VideoSubmitRequest,
  };
}

function validateImageDataUrl(value: string): { ok: true } | { ok: false; reason: string } {
  const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match) {
    return { ok: false, reason: 'must be a jpeg/png base64 data URL' };
  }

  const base64 = match[1] ?? '';
  if (base64.length === 0 || base64.length % 4 !== 0 || !hasValidPadding(base64)) {
    return { ok: false, reason: 'malformed base64' };
  }

  if (decodedBase64Size(base64) > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'decoded size exceeds 12MB' };
  }

  try {
    atob(base64);
  } catch {
    return { ok: false, reason: 'malformed base64' };
  }

  return { ok: true };
}

function validateNumberInRange(
  body: Record<string, unknown>,
  field: 'num_frames' | 'fps' | 'guidance_scale' | 'steps',
  min: number,
  max: number,
  integer: boolean,
): ValidationResult | null {
  const value = body[field];
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalid(field, 'must be a number');
  }
  if (integer && !Number.isInteger(value)) {
    return invalid(field, 'must be an integer');
  }
  if (value < min || value > max) {
    return invalid(field, `must be between ${min} and ${max}`);
  }
  return null;
}

function handleVideoUpstreamError(
  err: unknown,
  ip: string | null,
  start: number,
  rlState: RateLimitState,
): Response {
  const isUpstream = err instanceof RunpodUpstreamError;
  const kind = isUpstream ? err.kind : 'network';
  const status = kind === 'http_4xx' ? 500 : kind === 'network' || kind === 'timeout' ? 503 : 502;
  const errorCode =
    kind === 'http_5xx'
      ? 'upstream_error'
      : kind === 'http_4xx'
        ? 'gateway_configuration_error'
        : kind === 'bad_shape'
          ? 'upstream_bad_shape'
          : 'upstream_unavailable';

  log({
    timestamp: Date.now(),
    event: 'upstream_unavailable',
    ip,
    status,
    elapsed_ms: Date.now() - start,
    error_code: errorCode,
  });

  if (kind === 'http_5xx') {
    return json(status, { error: 'upstream_error', retryable: true }, rateLimitHeaders(rlState));
  }

  return json(status, { error: errorCode }, rateLimitHeaders(rlState));
}

function invalid(field: string, reason: string): ValidationResult {
  return { ok: false, field, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasValidPadding(base64: string): boolean {
  const firstPadding = base64.indexOf('=');
  return firstPadding === -1 || /^=+$/.test(base64.slice(firstPadding));
}

function decodedBase64Size(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
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
