/**
 * Public type contracts for @gemma4/flux-client.
 * Matches gateway request/response schemas (Story 2.5) which passthrough RunPod Serverless (Story 2.1).
 */

export interface GenerateInput {
  prompt: string;
  steps: number;
  width: number;
  height: number;
  seed?: number;
}

export interface GenerateMetadata {
  seed: number;
  elapsed_ms: number;
}

export interface GenerateOutput {
  output: {
    image_b64: string;
    metadata: GenerateMetadata;
  };
}

export interface WarmupResult {
  duration_ms: number;
  was_cold: boolean;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffStrategy: 'exponential' | 'linear';
  coldTimeoutMs: number;
  warmTimeoutMs: number;
}

export interface ClientOptions {
  retry?: Partial<RetryConfig>;
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
  coldTimeoutMs: 180_000,
  warmTimeoutMs: 30_000,
};

export const DEFAULT_WARM_THRESHOLD_MS = 30_000;
