import {
  AuthError,
  NetworkError,
  RateLimitError,
  TimeoutError,
} from './errors.js';
import {
  DEFAULT_POLL_TIMEOUT_MS,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_WARM_THRESHOLD_MS,
  type ClientConstructorArgs,
  type GenerateInput,
  type GenerateOutput,
  type PollPendingResponse,
  type RetryConfig,
  type SubmitJobResponse,
  type WarmupResult,
} from './types.js';
import { validateGenerateInput } from './validate.js';

const COLD_HEURISTIC_THRESHOLD_MS = 30_000;
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MAX_NOT_FOUND_RETRIES = 3;

interface RateLimitErrorBody {
  error?: string;
  limit?: number;
  reset_at?: string;
}

interface AuthErrorBody {
  error?: string;
}

interface TimeoutErrorBody {
  error?: string;
}

interface TerminalPollErrorBody {
  error?: string;
  status?: string;
}

export class FluxClient {
  readonly #apiKey: string;
  readonly #gatewayUrl: string;
  readonly #retryConfig: RetryConfig;
  readonly #warmTimeoutMs: number;
  readonly #warmThresholdMs: number;
  readonly #fetch: typeof fetch;
  #lastWarmTimestamp: number | null = null;

  constructor(args: ClientConstructorArgs) {
    if (!args.apiKey || typeof args.apiKey !== 'string') {
      throw new Error('FluxClient: apiKey is required and must be a string');
    }
    if (!args.gatewayUrl || typeof args.gatewayUrl !== 'string') {
      throw new Error('FluxClient: gatewayUrl is required and must be a string');
    }
    this.#apiKey = args.apiKey;
    this.#gatewayUrl = args.gatewayUrl.replace(/\/$/, '');
    this.#retryConfig = { ...DEFAULT_RETRY_CONFIG, ...args.options?.retry };
    this.#warmTimeoutMs = args.options?.warmTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    this.#warmThresholdMs = args.options?.warmThresholdMs ?? DEFAULT_WARM_THRESHOLD_MS;
    this.#fetch = args.options?.fetchImpl ?? fetch.bind(globalThis);
  }

  /**
   * Pre-warm the gateway/worker by submitting a minimal async job.
   * Returns timing info for the submit request; sets `lastWarmTimestamp` if accepted.
   */
  async warmup(options?: { timeout?: number }): Promise<WarmupResult> {
    const timeout = options?.timeout ?? this.#warmTimeoutMs;
    const start = Date.now();

    const dummyInput: GenerateInput = {
      prompt: 'warmup',
      steps: 1,
      width: 512,
      height: 512,
    };

    try {
      const submitResponse = await this.#submitWithRetry(dummyInput);
      await this.#pollSubmittedJob(submitResponse, start, timeout, true);
      const duration_ms = Date.now() - start;
      return {
        duration_ms,
        was_cold: duration_ms > COLD_HEURISTIC_THRESHOLD_MS,
      };
    } catch (err) {
      if (err instanceof TimeoutError || err instanceof AuthError || err instanceof RateLimitError || err instanceof NetworkError) {
        throw err;
      }
      throw err;
    }
  }

  /**
   * Synchronous probe — returns `true` if a successful warmup occurred within `warmThresholdMs`.
   * Pure state check, no network. Does not count against retry budget.
   */
  isWarm(): boolean {
    if (this.#lastWarmTimestamp === null) return false;
    return Date.now() - this.#lastWarmTimestamp < this.#warmThresholdMs;
  }

  getLastWarmTimestamp(): number | null {
    return this.#lastWarmTimestamp;
  }

  /**
   * Generate an image via the async gateway contract.
   *
   * Flow:
   * - POST /jobs submits in <2s and returns 202 + Location + Retry-After
   * - GET /jobs/{id} is polled until 200 or terminal timeout
   * - Polling respects Retry-After and is bounded by options.warmTimeoutMs
   */
  async generate(input: unknown): Promise<GenerateOutput> {
    validateGenerateInput(input);

    const start = Date.now();
    const submitResponse = await this.#submitWithRetry(input as GenerateInput);
    return this.#pollSubmittedJob(submitResponse, start, this.#warmTimeoutMs, true);
  }

  // ---------- private helpers ----------

  async #pollSubmittedJob(
    submitResponse: Response,
    start: number,
    pollTimeoutMs: number,
    markWarmOnSuccess: boolean,
  ): Promise<GenerateOutput> {
    const submitBody = await this.#safeReadJson<SubmitJobResponse>(submitResponse);
    if (!submitBody?.job_id || !submitBody.status_url) {
      throw new Error('Gateway submit response missing job_id or status_url');
    }

    const pollUrl = this.#absoluteStatusUrl(
      submitResponse.headers.get('Location') ?? submitBody.status_url,
    );

    let retryAfterSeconds = this.#parseRetryAfterSeconds(submitResponse.headers.get('Retry-After'));
    let notFoundRetries = 0;

    while (Date.now() - start < pollTimeoutMs) {
      const response = await this.#request(pollUrl, {
        method: 'GET',
        headers: this.#headers(),
      });

      if (response.status === 200) {
        const parsed = await this.#safeReadJson<GenerateOutput>(response);
        if (!parsed?.output?.image_b64) {
          throw new Error('Gateway completion response missing output.image_b64');
        }
        if (markWarmOnSuccess) {
          this.#lastWarmTimestamp = Date.now();
        }
        return parsed;
      }

      if (response.status === 202) {
        const body = await this.#safeReadJson<PollPendingResponse>(response);
        if (body?.status !== 'queued' && body?.status !== 'running') {
          throw new Error('Gateway poll response returned unexpected pending body');
        }
        retryAfterSeconds = this.#parseRetryAfterSeconds(response.headers.get('Retry-After'));
        await this.#sleep(retryAfterSeconds * 1000);
        continue;
      }

      if (response.status === 404) {
        if (notFoundRetries < MAX_NOT_FOUND_RETRIES) {
          await this.#sleep(this.#computeBackoffMs(notFoundRetries));
          notFoundRetries++;
          continue;
        }
        throw new Error('job_not_found_or_expired');
      }

      if (response.status === 504) {
        const body = await this.#safeReadJson<TimeoutErrorBody>(response);
        throw new TimeoutError({
          elapsed_ms: Date.now() - start,
          cause: body?.error === 'generation_timeout' ? 'runpod_timeout' : 'gateway_504',
        });
      }

      if (response.status === 401) {
        const body = await this.#safeReadJson<AuthErrorBody>(response);
        throw new AuthError({
          http_status: 401,
          ...(body?.error ? { message: body.error } : {}),
        });
      }

      if (response.status === 429) {
        throw await this.#buildRateLimitError(response);
      }

      if (response.status === 500) {
        const body = await this.#safeReadJson<TerminalPollErrorBody>(response);
        throw new Error(
          body?.error
            ? `${body.error}${body.status ? `:${body.status}` : ''}`
            : 'generation_error',
        );
      }

      if (response.status >= 502) {
        retryAfterSeconds = this.#parseRetryAfterSeconds(response.headers.get('Retry-After'));
        continue;
      }

      throw new Error(`Unexpected poll status ${response.status}`);
    }

    throw new TimeoutError({
      elapsed_ms: Date.now() - start,
      cause: 'poll_exhausted',
    });
  }

  #headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.#apiKey,
    };
  }

  #computeBackoffMs(attempt: number): number {
    if (this.#retryConfig.backoffStrategy === 'linear') {
      return this.#retryConfig.initialDelayMs * (attempt + 1);
    }
    return this.#retryConfig.initialDelayMs * Math.pow(2, attempt);
  }

  async #submitWithRetry(input: GenerateInput): Promise<Response> {
    for (let attempt = 0; attempt <= this.#retryConfig.maxRetries; attempt++) {
      try {
        const response = await this.#request(`${this.#gatewayUrl}/jobs`, {
          method: 'POST',
          headers: this.#headers(),
          body: JSON.stringify(input),
        });

        if (response.status === 202) {
          return response;
        }
        if (response.status === 401) {
          const body = await this.#safeReadJson<AuthErrorBody>(response);
          throw new AuthError({
            http_status: 401,
            ...(body?.error ? { message: body.error } : {}),
          });
        }
        if (response.status === 429) {
          throw await this.#buildRateLimitError(response);
        }
        if (response.status >= 500 && attempt < this.#retryConfig.maxRetries) {
          await this.#sleep(this.#computeBackoffMs(attempt));
          continue;
        }
        if (response.status >= 500) {
          throw new NetworkError({ cause: new Error(`Gateway submit failed with ${response.status}`) });
        }
        throw new Error(`Unexpected submit status ${response.status}`);
      } catch (err) {
        if (err instanceof AuthError || err instanceof RateLimitError) {
          throw err;
        }
        if (attempt === this.#retryConfig.maxRetries) {
          if (err instanceof TimeoutError) {
            throw err;
          }
          if (err instanceof Error) {
            throw new NetworkError({ cause: err });
          }
          throw new Error('Unknown submit failure');
        }
        await this.#sleep(this.#computeBackoffMs(attempt));
      }
    }

    throw new Error('submit retry loop exhausted unexpectedly');
  }

  async #request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#retryConfig.requestTimeoutMs);
    try {
      return await this.#fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new NetworkError({
          cause: new Error(`Request timed out after ${this.#retryConfig.requestTimeoutMs}ms`),
        });
      }
      if (err instanceof Error) {
        throw err;
      }
      throw new Error('Unknown request failure');
    } finally {
      clearTimeout(timer);
    }
  }

  async #buildRateLimitError(response: Response): Promise<RateLimitError> {
    const body = await this.#safeReadJson<RateLimitErrorBody>(response);
    const retry_after_seconds = this.#parseRetryAfterSeconds(response.headers.get('Retry-After'), 60);
    return new RateLimitError({
      retry_after_seconds,
      reset_at: body?.reset_at ?? new Date(Date.now() + retry_after_seconds * 1000).toISOString(),
      ...(body?.limit !== undefined ? { limit: body.limit } : {}),
    });
  }

  #parseRetryAfterSeconds(headerValue: string | null, fallback = DEFAULT_RETRY_AFTER_SECONDS): number {
    if (!headerValue) return fallback;
    return Math.max(1, Number.parseInt(headerValue, 10) || fallback);
  }

  #absoluteStatusUrl(path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return `${this.#gatewayUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async #safeReadJson<T>(response: Response): Promise<T | null> {
    try {
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }
}
