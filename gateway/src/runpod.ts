/**
 * RunPod Serverless API client (INC-2026-04-23-gateway-504 Task 2.2).
 *
 * Wraps the async primitives of RunPod /v2/{endpoint}/... so the gateway can
 * submit + poll without embedding the full URL/auth dance at every call site.
 *
 * CRITICAL ARCHITECTURAL DECISION (AD-1, story Dev Notes):
 *   Gateway does NOT call RunPod /view. image_b64 comes INLINE in /status.output.
 *   Verified via serverless/handler.py:237 which returns
 *     { image_b64, metadata: { seed, elapsed_ms } }
 *   which the RunPod framework surfaces as the `output` field on /status.
 *   DO NOT add a getOutput() wrapper. If reality contradicts this, STOP and
 *   escalate to @architect.
 *
 * Research traceability: RT-2 (docs.runpod.io/serverless/endpoints/operation-reference)
 * Story AD-1, CON-3 (handler.py unchanged).
 */

import {
  RUNPOD_TO_GATEWAY_STATUS,
  type Env,
  type JobStatus,
  type RunpodStatus,
  type RunpodStatusResponse,
  type RunpodSubmitResponse,
} from './types.js';

const RUNPOD_BASE = 'https://api.runpod.ai/v2';
const UPSTREAM_TIMEOUT_MS = 30_000; // per-call budget; loop-level timeouts live in SDK

/**
 * Structured upstream failure for callers to distinguish from NetworkError /
 * success. Kept local to runpod.ts — index.ts handler maps to HTTP status.
 */
export class RunpodUpstreamError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'network'          // fetch rejected / connection reset / DNS fail
      | 'timeout'          // 30s budget exceeded
      | 'http_5xx'         // upstream transient
      | 'http_4xx'         // likely auth/config — surface explicitly
      | 'bad_shape',       // 2xx but body did not match schema
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = 'RunpodUpstreamError';
  }
}

/**
 * Submits an async job to RunPod.
 *
 * Request body shape matches handler.py normalize_input (prompt required; steps/
 * width/height/seed optional with sensible defaults enforced handler-side).
 * We pass through as-is — the gateway is content-agnostic for payload contents.
 */
export async function submitJob(
  env: Env,
  input: Record<string, unknown>,
): Promise<RunpodSubmitResponse> {
  const url = `${RUNPOD_BASE}/${env.RUNPOD_ENDPOINT_ID}/run`;
  const body = JSON.stringify({ input });

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  const parsed = await parseJson<RunpodSubmitResponse>(response);
  if (!parsed || typeof parsed.id !== 'string' || !isRunpodStatus(parsed.status)) {
    throw new RunpodUpstreamError(
      'RunPod /run returned unexpected body shape',
      'bad_shape',
      response.status,
    );
  }
  return parsed;
}

/**
 * Polls the current status of a previously submitted RunPod job.
 * When status=COMPLETED, the returned `output` contains the handler.py return
 * value (image_b64 + metadata) per AD-1.
 */
export async function getStatus(
  env: Env,
  runpodRequestId: string,
): Promise<RunpodStatusResponse> {
  const url = `${RUNPOD_BASE}/${env.RUNPOD_ENDPOINT_ID}/status/${runpodRequestId}`;

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
    },
  });

  const parsed = await parseJson<RunpodStatusResponse>(response);
  if (!parsed || typeof parsed.id !== 'string' || !isRunpodStatus(parsed.status)) {
    throw new RunpodUpstreamError(
      'RunPod /status returned unexpected body shape',
      'bad_shape',
      response.status,
    );
  }
  return parsed;
}

/**
 * Canonical mapping from RunPod upstream enum to gateway enum.
 * Exported for log redaction and test assertions.
 */
export function mapStatus(runpodStatus: RunpodStatus): JobStatus {
  return RUNPOD_TO_GATEWAY_STATUS[runpodStatus];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isRunpodStatus(s: unknown): s is RunpodStatus {
  return (
    s === 'IN_QUEUE' ||
    s === 'IN_PROGRESS' ||
    s === 'COMPLETED' ||
    s === 'FAILED' ||
    s === 'CANCELLED' ||
    s === 'TIMED_OUT'
  );
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });

    if (response.status >= 500) {
      throw new RunpodUpstreamError(
        `RunPod upstream returned ${response.status}`,
        'http_5xx',
        response.status,
      );
    }
    if (response.status >= 400) {
      throw new RunpodUpstreamError(
        `RunPod upstream returned ${response.status}`,
        'http_4xx',
        response.status,
      );
    }
    return response;
  } catch (err) {
    if (err instanceof RunpodUpstreamError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new RunpodUpstreamError(
        `RunPod upstream timed out after ${UPSTREAM_TIMEOUT_MS}ms`,
        'timeout',
      );
    }
    throw new RunpodUpstreamError(
      err instanceof Error ? err.message : 'fetch failed',
      'network',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
