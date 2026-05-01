/**
 * Public type contracts for @jhonata-matias/flux-client.
 * Matches gateway request/response schemas (Story 2.5) which passthrough RunPod Serverless (Story 2.1).
 */

export interface GenerateInput {
  prompt: string;
  steps: number;
  width: number;
  height: number;
  seed?: number;
}

export type EditImageInput = Buffer | Uint8Array | Blob | string;

export interface EditInput {
  prompt: string;
  image: EditImageInput;
  strength?: number;
  seed?: number;
  steps?: number;
  aspect_ratio?: string;
  autoDownsample?: boolean;
}

export interface GenerateMetadata {
  seed: number;
  elapsed_ms: number;
  qwen_generated_width?: number;
  qwen_generated_height?: number;
  output_width?: number;
  output_height?: number;
  input_width?: number;
  input_height?: number;
  source_width?: number;
  source_height?: number;
  input_downsampled?: boolean;
}

export interface GenerateOutput {
  output: {
    image_b64: string;
    metadata: GenerateMetadata;
  };
}

export interface SubmitJobResponse {
  job_id: string;
  status_url: string;
  est_wait_seconds: 'unknown';
}

export interface PollPendingResponse {
  status: 'queued' | 'running';
  est_wait_seconds: 'unknown';
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffStrategy: 'exponential' | 'linear';
  requestTimeoutMs: number;
}

export interface WarmupResult {
  duration_ms: number;
  was_cold: boolean;
}

export interface ClientOptions {
  retry?: Partial<RetryConfig>;
  warmTimeoutMs?: number;
  warmThresholdMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ClientConstructorArgs {
  apiKey: string;
  gatewayUrl: string;
  options?: ClientOptions;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffStrategy: 'exponential',
  requestTimeoutMs: 30_000,
};

export const DEFAULT_POLL_TIMEOUT_MS = 180_000;
export const DEFAULT_WARM_THRESHOLD_MS = 30_000;
