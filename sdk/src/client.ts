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
  type EditInput,
  type GenerateInput,
  type GenerateOutput,
  type GenerateVideoInput,
  type GenerateVideoOutput,
  type PollPendingResponse,
  type RetryConfig,
  type SubmitJobResponse,
  type VideoProgressEvent,
  type WarmupResult,
} from './types.js';
import {
  validateAndNormalizeEditInput,
  validateGenerateInput,
  validateGenerateVideoInput,
  type NormalizedEditRequest,
} from './validate.js';

const COLD_HEURISTIC_THRESHOLD_MS = 30_000;
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const DEFAULT_VIDEO_TIMEOUT_MS = 900_000;
const MAX_VIDEO_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_NOT_FOUND_RETRIES = 3;
const VIDEO_POLL_5XX_BACKOFF_MS = [1_000, 3_000, 9_000] as const;

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

interface VideoSubmitJobResponse {
  job_id: string;
  status_url: string;
  est_wait_seconds: {
    p50: number;
    p95: number;
    first_call_max: number;
  };
}

interface VideoPollPendingResponse {
  status: 'queued' | 'running';
  est_wait_seconds?: number | 'unknown' | VideoSubmitJobResponse['est_wait_seconds'];
  progress?: Partial<VideoProgressEvent>;
}

interface VideoCompletionResponse {
  status?: 'completed';
  output?: GenerateVideoOutput & { url_ttl_seconds?: number };
  metrics?: GenerateVideoOutput['metrics'];
}

interface GatewayErrorBody {
  error?: string | { code?: string; message?: string };
  status?: string;
  retryable?: boolean;
}

type VideoJobSubmitInput = Omit<GenerateVideoInput, 'signal' | 'onProgress' | 'timeoutMs'> & { kind: 'video' };
type JobSubmitInput = GenerateInput | NormalizedEditRequest | VideoJobSubmitInput;

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

  /**
   * Edit an existing image via the same async submit/poll gateway contract.
   * The `input_image_b64` payload shape selects the i2i branch server-side.
   */
  async edit(input: EditInput): Promise<GenerateOutput> {
    const request = await validateAndNormalizeEditInput(input);
    const start = Date.now();
    const submitResponse = await this.#submitWithRetry(request);
    return this.#pollSubmittedJob(submitResponse, start, this.#warmTimeoutMs, true);
  }

  /**
   * Generate video via the async gateway contract.
   * Uses a video-specific poller because the image poller validates image_b64
   * outputs and has different timeout/5xx retry semantics.
   */
  async generateVideo(input: GenerateVideoInput): Promise<GenerateVideoOutput> {
    validateGenerateVideoInput(input);
    this.#throwIfAborted(input.signal);

    const request: VideoJobSubmitInput = {
      kind: 'video',
      prompt: input.prompt,
    };
    if (input.image !== undefined) request.image = await this.#normalizeVideoImage(input.image, input.signal);
    if (input.num_frames !== undefined) request.num_frames = input.num_frames;
    if (input.fps !== undefined) request.fps = input.fps;
    if (input.guidance_scale !== undefined) request.guidance_scale = input.guidance_scale;
    if (input.steps !== undefined) request.steps = input.steps;
    if (input.negative_prompt !== undefined) request.negative_prompt = input.negative_prompt;
    if (input.seed !== undefined) request.seed = input.seed;

    const start = Date.now();
    const submitResponse = await this.#submitVideoWithRetry(request, input.signal);
    return this.#pollVideoJob(submitResponse, start, input.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS, input);
  }

  async text2video(
    prompt: string,
    opts?: Omit<GenerateVideoInput, 'prompt'>,
  ): Promise<GenerateVideoOutput> {
    return this.generateVideo({ prompt, ...opts });
  }

  async image2video(
    image: string,
    prompt: string,
    opts?: Omit<GenerateVideoInput, 'prompt' | 'image'>,
  ): Promise<GenerateVideoOutput> {
    return this.generateVideo({ prompt, image, ...opts });
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

  async #pollVideoJob(
    submitResponse: Response,
    start: number,
    pollTimeoutMs: number,
    input: GenerateVideoInput,
  ): Promise<GenerateVideoOutput> {
    const submitBody = await this.#safeReadJson<VideoSubmitJobResponse>(submitResponse);
    if (!submitBody?.job_id || !submitBody.status_url) {
      throw new Error('Gateway video submit response missing job_id or status_url');
    }

    const pollUrl = this.#absoluteStatusUrl(
      submitResponse.headers.get('Location') ?? submitBody.status_url,
    );

    let retryAfterSeconds = this.#parseRetryAfterSeconds(submitResponse.headers.get('Retry-After'));
    let notFoundRetries = 0;
    let transient5xxRetries = 0;
    let phase: VideoProgressEvent['phase'] = 'queued';

    while (Date.now() - start < pollTimeoutMs) {
      this.#throwIfAborted(input.signal);

      const response = await this.#request(pollUrl, {
        method: 'GET',
        headers: this.#headers(),
      }, input.signal);

      if (response.status === 200) {
        const parsed = await this.#safeReadJson<VideoCompletionResponse>(response);
        const output = parsed?.output;
        const metrics = parsed?.metrics;
        if (!output?.video_url || !metrics) {
          throw new Error('Gateway video completion response missing output or metrics');
        }
        return {
          video_url: output.video_url,
          duration_seconds: output.duration_seconds,
          width: output.width,
          height: output.height,
          fps: output.fps,
          size_bytes: output.size_bytes,
          metrics,
        };
      }

      if (response.status === 202) {
        const body = await this.#safeReadJson<VideoPollPendingResponse>(response);
        if (body?.status !== 'queued' && body?.status !== 'running') {
          throw new Error('Gateway video poll response returned unexpected pending body');
        }
        if (this.#isVideoPhase(body.progress?.phase)) {
          phase = body.progress.phase;
        }
        const progress: VideoProgressEvent = { phase };
        if (typeof body.progress?.percent_estimate === 'number') {
          progress.percent_estimate = body.progress.percent_estimate;
        }
        const estWaitSeconds = this.#extractVideoWaitSeconds(body.progress?.est_wait_seconds ?? body.est_wait_seconds);
        if (estWaitSeconds !== undefined) {
          progress.est_wait_seconds = estWaitSeconds;
        }
        input.onProgress?.(progress);
        retryAfterSeconds = this.#parseRetryAfterSeconds(response.headers.get('Retry-After'));
        await this.#sleep(retryAfterSeconds * 1000, input.signal);
        continue;
      }

      if (response.status === 404) {
        if (notFoundRetries < MAX_NOT_FOUND_RETRIES) {
          await this.#sleep(this.#computeBackoffMs(notFoundRetries), input.signal);
          notFoundRetries++;
          continue;
        }
        throw new Error('job_not_found_or_expired');
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

      if (response.status >= 500) {
        if (transient5xxRetries < VIDEO_POLL_5XX_BACKOFF_MS.length) {
          const backoffMs = VIDEO_POLL_5XX_BACKOFF_MS[transient5xxRetries] ?? 9_000;
          transient5xxRetries++;
          await this.#sleep(backoffMs, input.signal);
          continue;
        }
        throw await this.#buildGatewayError(response, `Gateway video poll failed with ${response.status}`);
      }

      throw new Error(`Unexpected video poll status ${response.status}`);
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

  async #submitVideoWithRetry(input: VideoJobSubmitInput, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; attempt <= this.#retryConfig.maxRetries; attempt++) {
      try {
        this.#throwIfAborted(signal);
        const response = await this.#request(`${this.#gatewayUrl}/jobs`, {
          method: 'POST',
          headers: this.#headers(),
          body: JSON.stringify(input),
        }, signal);

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
          await this.#sleep(this.#computeBackoffMs(attempt), signal);
          continue;
        }
        if (response.status >= 500) {
          throw await this.#buildGatewayError(response, `Gateway video submit failed with ${response.status}`);
        }
        throw new Error(`Unexpected video submit status ${response.status}`);
      } catch (err) {
        if (
          err instanceof AuthError ||
          err instanceof RateLimitError ||
          this.#isAbortError(err)
        ) {
          throw err;
        }
        if (attempt === this.#retryConfig.maxRetries) {
          if (err instanceof TimeoutError) {
            throw err;
          }
          if (err instanceof Error) {
            throw new NetworkError({ cause: err });
          }
          throw new Error('Unknown video submit failure');
        }
        await this.#sleep(this.#computeBackoffMs(attempt), signal);
      }
    }

    throw new Error('video submit retry loop exhausted unexpectedly');
  }

  async #submitWithRetry(input: JobSubmitInput): Promise<Response> {
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

  async #request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    this.#throwIfAborted(signal);
    const controller = new AbortController();
    let abortCause: 'timeout' | 'external' | null = null;
    const timer = setTimeout(() => {
      abortCause = 'timeout';
      controller.abort();
    }, this.#retryConfig.requestTimeoutMs);
    const abort = (): void => {
      abortCause = 'external';
      controller.abort();
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await this.#fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError' && abortCause === 'external') {
        throw this.#buildAbortError();
      }
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
      signal?.removeEventListener('abort', abort);
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

  async #buildGatewayError(response: Response, fallback: string): Promise<Error> {
    const body = await this.#safeReadJson<GatewayErrorBody>(response);
    if (typeof body?.error === 'string') {
      return new Error(body.status ? `${body.error}:${body.status}` : body.error);
    }
    if (body?.error?.code || body?.error?.message) {
      const code = body.error.code ?? 'gateway_error';
      return new Error(body.error.message ? `${code}: ${body.error.message}` : code);
    }
    return new Error(fallback);
  }

  async #normalizeVideoImage(image: string, signal?: AbortSignal): Promise<string> {
    const trimmed = image.trim();
    if (trimmed.startsWith('data:')) {
      return trimmed;
    }
    if (!trimmed.startsWith('https://')) {
      throw this.#buildImageFetchError('Video image must be a data URL or https URL');
    }

    let response: Response;
    try {
      this.#throwIfAborted(signal);
      const init: RequestInit = { method: 'GET' };
      if (signal !== undefined) init.signal = signal;
      response = await this.#fetch(trimmed, init);
    } catch (err) {
      if (this.#isAbortError(err)) {
        throw this.#buildAbortError();
      }
      throw this.#buildImageFetchError(
        `Failed to fetch video image URL: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }

    if (!response.ok) {
      throw this.#buildImageFetchError(`Failed to fetch video image URL: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
      throw this.#buildImageFetchError('Video image URL must return image/jpeg or image/png');
    }

    const contentLength = response.headers.get('Content-Length');
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_VIDEO_IMAGE_BYTES) {
      throw this.#buildImageFetchError('Video image URL payload must be <= 12 MB');
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_VIDEO_IMAGE_BYTES) {
      throw this.#buildImageFetchError('Video image URL payload must be <= 12 MB');
    }

    return `data:${contentType};base64,${this.#bytesToBase64(bytes)}`;
  }

  #buildImageFetchError(message: string): Error {
    return new Error(message, { cause: 'image_fetch_failed' });
  }

  #parseRetryAfterSeconds(headerValue: string | null, fallback = DEFAULT_RETRY_AFTER_SECONDS): number {
    if (!headerValue) return fallback;
    return Math.max(1, Number.parseInt(headerValue, 10) || fallback);
  }

  #absoluteStatusUrl(path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return `${this.#gatewayUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  #sleep(ms: number, signal?: AbortSignal): Promise<void> {
    this.#throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, ms);
      const abort = (): void => {
        clearTimeout(timer);
        reject(this.#buildAbortError());
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  #throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw this.#buildAbortError();
    }
  }

  #buildAbortError(): Error {
    return new DOMException('aborted', 'AbortError');
  }

  #isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError';
  }

  #isVideoPhase(value: unknown): value is VideoProgressEvent['phase'] {
    return value === 'queued' || value === 'loading_model' || value === 'inferencing' || value === 'uploading';
  }

  #extractVideoWaitSeconds(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (value !== null && typeof value === 'object') {
      const maybeP50 = (value as { p50?: unknown }).p50;
      if (typeof maybeP50 === 'number' && Number.isFinite(maybeP50)) {
        return maybeP50;
      }
    }
    return undefined;
  }

  #bytesToBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }

    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  async #safeReadJson<T>(response: Response): Promise<T | null> {
    try {
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }
}
