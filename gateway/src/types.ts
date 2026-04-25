/**
 * Cloudflare Worker bindings for servegate gateway.
 *
 * Original: Story 2.5 (gateway sync proxy). Refactored 2026-04-23 for
 * INC-2026-04-23-gateway-504 async submit/poll pattern.
 *
 * Bindings configured in wrangler.toml + secrets via `wrangler secret put`.
 */

export interface Env {
  // KV namespace for rate-limit counter (Story 2.5)
  RATE_LIMIT_KV: KVNamespace;

  // KV namespace for async job mapping (INC-2026-04-23-gateway-504 FR-3)
  JOBS_KV: KVNamespace;

  // Secrets (configured via `wrangler secret put`)
  GATEWAY_API_KEY: string;
  RUNPOD_API_KEY: string;
  RUNPOD_ENDPOINT_ID: string;
  RUNPOD_TEXT_ENDPOINT_ID?: string;
  CORS_ALLOWED_ORIGIN?: string;
}

export interface RateLimitState {
  count: number;
  remaining: number;
  resetAt: string; // ISO-8601
  secondsUntilReset: number;
}

export interface TokenBudgetState {
  used: number;
  remaining: number;
  resetAt: string; // ISO-8601
  secondsUntilReset: number;
}

export type GenerateRole = 'system' | 'user' | 'assistant';

export interface GenerateMessage {
  role: GenerateRole;
  content: string;
}

export interface GenerateRequest {
  model?: string;
  messages: GenerateMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

export interface GenerateResponse {
  id?: string;
  object: 'chat.completion';
  created?: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
      reasoning?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface GenerateStreamChunk {
  id?: string;
  object: 'chat.completion.chunk';
  created?: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      reasoning?: string;
    };
    finish_reason: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Job state model (INC-2026-04-23-gateway-504 FR-2, FR-3, terminology.status_str)
// ---------------------------------------------------------------------------

/**
 * Gateway-facing job status enum. Simplified alias over the upstream RunPod enum.
 * Mapping is 1:1 — see RUNPOD_TO_GATEWAY_STATUS below.
 */
export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/**
 * RunPod upstream status enum as returned by /v2/{endpoint}/status/{id}.
 * Verified against research RT-2 (docs.runpod.io/serverless/endpoints/operation-reference).
 */
export type RunpodStatus =
  | 'IN_QUEUE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

/**
 * Canonical mapping: RunPod upstream enum → gateway-facing enum.
 * Used by runpod.ts::mapStatus() and gateway response construction.
 */
export const RUNPOD_TO_GATEWAY_STATUS: Record<RunpodStatus, JobStatus> = {
  IN_QUEUE: 'queued',
  IN_PROGRESS: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timeout',
};

/**
 * Record persisted in JOBS_KV keyed by gateway-generated job_id (UUID v4).
 * Used by storage.ts to bridge gateway identity and RunPod identity.
 */
export interface JobMapping {
  job_id: string;               // UUID v4 — gateway-owned identity
  runpod_request_id: string;    // RunPod-owned identity, returned by /run
  status: JobStatus;            // Last-observed status (updated on poll)
  created_at: number;           // Unix ms — when /jobs POST was received
  completed_at?: number;        // Unix ms — set when status transitions to completed/failed/cancelled/timeout
  error_code?: string;          // Populated for terminal error states
}

// ---------------------------------------------------------------------------
// RunPod API response shapes (research RT-2 verified)
// ---------------------------------------------------------------------------

/**
 * Response of POST https://api.runpod.ai/v2/{endpoint}/run
 */
export interface RunpodSubmitResponse {
  id: string;                   // This is the runpod_request_id
  status: RunpodStatus;         // Always 'IN_QUEUE' on successful submit
}

/**
 * Response of GET https://api.runpod.ai/v2/{endpoint}/status/{id}
 *
 * When status=COMPLETED, `output` contains the return value of our handler.py:
 *   { image_b64: string, metadata: { seed: number, elapsed_ms: number } }
 *
 * This is AD-1 in story Dev Notes: image_b64 comes INLINE via `output` —
 * gateway does NOT call /view.
 */
export interface RunpodStatusResponse {
  id: string;                   // Echoes runpod_request_id
  status: RunpodStatus;
  delayTime?: number;           // ms queue time
  executionTime?: number;       // ms actual inference time
  output?: {
    image_b64?: string;
    metadata?: {
      seed?: number;
      elapsed_ms?: number;
    };
    error?: string;             // Populated for FAILED/TIMED_OUT
    code?: number;
  };
}

// ---------------------------------------------------------------------------
// Structured logging event types (CON-4 Privacy: never logs prompt/image bytes)
// ---------------------------------------------------------------------------

export type LogEventName =
  // Pre-existing events (Story 2.5)
  | 'auth_failed'
  | 'rate_limited'
  | 'proxy_success'       // Retained for backward-compat; emitted only for legacy path if any remains (shouldn't after CON-6)
  | 'proxy_error'
  | 'invalid_method'
  // New events (INC-2026-04-23-gateway-504)
  | 'job_submitted'       // POST /jobs succeeded
  | 'job_polled'          // GET /jobs/{id} served
  | 'job_completed'       // GET /jobs/{id} returned 200 with output
  | 'job_not_found'       // GET /jobs/{id} returned 404
  | 'upstream_unavailable'// RunPod /run or /status failed
  | 'legacy_endpoint_rejected' // POST / returned 404 per CON-6 / EC-8
  // Text generation events (Story 4.2)
  | 'generate_submitted'
  | 'generate_rate_limited'
  | 'generate_completed'
  | 'generate_stream_aborted'
  | 'generate_upstream_error'
  | 'generate_invalid_input';

export interface LogEvent {
  timestamp: number;
  event: LogEventName;
  ip: string | null;
  status: number;
  elapsed_ms: number;
  day_count?: number;
  job_id?: string;          // New: correlates polling events to submit
  runpod_request_id?: string; // New: correlates gateway and RunPod sides
  job_status?: JobStatus;   // New: current status in poll responses
  error_code?: string;      // New: structured error identifier (no prompts, no images)
}
