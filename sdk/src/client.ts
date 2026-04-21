import {
  AuthError,
  ColdStartError,
  NetworkError,
  RateLimitError,
} from './errors.js';
import {
  DEFAULT_RETRY_CONFIG,
  DEFAULT_WARM_THRESHOLD_MS,
  type ClientConstructorArgs,
  type GenerateInput,
  type GenerateOutput,
  type RetryConfig,
  type WarmupResult,
} from './types.js';
import { validateGenerateInput } from './validate.js';

const COLD_HEURISTIC_THRESHOLD_MS = 30_000;

interface RateLimitErrorBody {
  error?: string;
  limit?: number;
  reset_at?: string;
}

interface AuthErrorBody {
  error?: string;
}

export class FluxClient {
  readonly #apiKey: string;
  readonly #gatewayUrl: string;
  readonly #retryConfig: RetryConfig;
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
    this.#warmThresholdMs = args.options?.warmThresholdMs ?? DEFAULT_WARM_THRESHOLD_MS;
    this.#fetch = args.options?.fetchImpl ?? fetch.bind(globalThis);
  }

  /**
   * Pre-warm the gateway/worker by firing a minimal dummy request.
   * Returns timing info; sets `lastWarmTimestamp` if successful.
   * Default timeout: 180s (cold SLA per ADR-0001 Path A).
   */
  async warmup(options?: { timeout?: number }): Promise<WarmupResult> {
    const timeout = options?.timeout ?? this.#retryConfig.coldTimeoutMs;
    const start = Date.now();

    const dummyInput: GenerateInput = {
      prompt: 'warmup',
      steps: 1,
      width: 512,
      height: 512,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await this.#fetch(`${this.#gatewayUrl}/`, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify({ input: dummyInput }),
        signal: controller.signal,
      });

      const duration_ms = Date.now() - start;

      if (response.ok) {
        this.#lastWarmTimestamp = Date.now();
        return {
          duration_ms,
          was_cold: duration_ms > COLD_HEURISTIC_THRESHOLD_MS,
        };
      }

      // Non-OK: treat as warmup failure but still return timing info; don't update warm timestamp
      throw new Error(`warmup gateway returned status ${response.status}`);
    } catch (err) {
      const duration_ms = Date.now() - start;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ColdStartError({
          duration_ms,
          retry_count: 0,
          message: `Warmup timed out after ${timeout}ms`,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
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
   * Generate an image via the gateway. Validates input strictly, then runs retry-with-backoff loop.
   *
   * Behavior:
   * - 200 → returns parsed `GenerateOutput`
   * - 401 → throws `AuthError` immediately (no retry)
   * - 429 → throws `RateLimitError` immediately (consumer decides retry timing)
   * - 5xx / network error / timeout → retries up to `maxRetries` with backoff
   * - All retries exhausted → throws `ColdStartError`
   * - First attempt timeout: `coldTimeoutMs` (default 180s); subsequent: `warmTimeoutMs` (default 30s)
   */
  async generate(input: unknown): Promise<GenerateOutput> {
    validateGenerateInput(input);

    const start = Date.now();
    let lastHttpStatus: number | undefined;

    for (let attempt = 0; attempt <= this.#retryConfig.maxRetries; attempt++) {
      const isFirstAttempt = attempt === 0;
      const timeout = isFirstAttempt
        ? this.#retryConfig.coldTimeoutMs
        : this.#retryConfig.warmTimeoutMs;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await this.#fetch(`${this.#gatewayUrl}/`, {
          method: 'POST',
          headers: this.#headers(),
          body: JSON.stringify({ input }),
          signal: controller.signal,
        });

        lastHttpStatus = response.status;

        if (response.status === 401) {
          const body = await this.#safeReadJson<AuthErrorBody>(response);
          throw new AuthError({
            http_status: 401,
            ...(body?.error ? { message: body.error } : {}),
          });
        }

        if (response.status === 429) {
          const body = await this.#safeReadJson<RateLimitErrorBody>(response);
          const retryAfterHeader = response.headers.get('Retry-After');
          const retry_after_seconds = retryAfterHeader
            ? Math.max(0, Number.parseInt(retryAfterHeader, 10) || 60)
            : 60;
          throw new RateLimitError({
            retry_after_seconds,
            reset_at: body?.reset_at ?? new Date(Date.now() + retry_after_seconds * 1000).toISOString(),
            ...(body?.limit !== undefined ? { limit: body.limit } : {}),
          });
        }

        if (response.ok) {
          const parsed = (await response.json()) as GenerateOutput;
          this.#lastWarmTimestamp = Date.now();
          return parsed;
        }

        // 5xx upstream — retryable; fall through to retry
      } catch (err) {
        // Re-throw non-retryable errors immediately
        if (err instanceof AuthError || err instanceof RateLimitError) {
          throw err;
        }
        if (err instanceof TypeError) {
          // fetch network failure (DNS, connection refused) before any HTTP status
          if (attempt === this.#retryConfig.maxRetries) {
            throw new NetworkError({ cause: err });
          }
        } else if (err instanceof Error && err.name === 'AbortError') {
          // timeout — retryable; fall through
        } else {
          // unknown — retryable up to maxRetries
        }
      } finally {
        clearTimeout(timer);
      }

      // Backoff before next attempt (except on last)
      if (attempt < this.#retryConfig.maxRetries) {
        const delay = this.#computeBackoffMs(attempt);
        await this.#sleep(delay);
      }
    }

    // Exhausted retries
    throw new ColdStartError({
      duration_ms: Date.now() - start,
      retry_count: this.#retryConfig.maxRetries,
      ...(lastHttpStatus !== undefined ? { last_http_status: lastHttpStatus } : {}),
    });
  }

  // ---------- private helpers ----------

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
