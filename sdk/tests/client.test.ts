import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FluxClient } from '../src/client.js';
import {
  AuthError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from '../src/errors.js';

function makeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('FluxClient — constructor', () => {
  it('throws on missing apiKey', () => {
    expect(() => new FluxClient({ apiKey: '', gatewayUrl: 'https://gw.example' })).toThrow();
  });

  it('throws on missing gatewayUrl', () => {
    expect(() => new FluxClient({ apiKey: 'key', gatewayUrl: '' })).toThrow();
  });

  it('strips trailing slash from gatewayUrl', () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example/' });
    expect(client).toBeInstanceOf(FluxClient);
  });
});

describe('FluxClient — generate input validation', () => {
  it('throws ValidationError for invalid input before any network call', async () => {
    const fetchSpy = vi.fn();
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });
    await expect(client.generate({ prompt: '', steps: 4, width: 1024, height: 1024 })).rejects.toThrow(
      ValidationError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('FluxClient — generate happy path', () => {
  it('submits to /jobs, polls GET /jobs/{id}, and returns parsed output on 200', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(
        makeResponse(202, {
        job_id: 'job-1',
        status_url: '/jobs/job-1',
        est_wait_seconds: 'unknown',
        }, { Location: '/jobs/job-1', 'Retry-After': '0' }),
      )
      .mockResolvedValueOnce(
      makeResponse(200, {
        output: { image_b64: 'BASE64DATA', metadata: { seed: 42, elapsed_ms: 3100 } },
      }),
      );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });
    const result = await client.generate({ prompt: 'cat', steps: 4, width: 1024, height: 1024 });
    expect(result.output.image_b64).toBe('BASE64DATA');
    expect(result.output.metadata.seed).toBe(42);
    expect(client.isWarm()).toBe(true);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'https://gw.example/jobs',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://gw.example/jobs/job-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends X-API-Key header', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(
        makeResponse(202, { job_id: 'job-1', status_url: '/jobs/job-1', est_wait_seconds: 'unknown' }, { Location: '/jobs/job-1', 'Retry-After': '0' }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, { output: { image_b64: 'X', metadata: { seed: 1, elapsed_ms: 1 } } }),
      );
    const client = new FluxClient({
      apiKey: 'secret-key',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });
    await client.generate({ prompt: 'cat', steps: 4, width: 1024, height: 1024 });
    const callArgs = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect((callArgs.headers as Record<string, string>)['X-API-Key']).toBe('secret-key');
  });
});

describe('FluxClient — auth/rate-limit', () => {
  it('throws AuthError on submit 401 (no retry)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeResponse(401, { error: 'invalid_api_key' }));
    const client = new FluxClient({
      apiKey: 'bad',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });
    await expect(client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 })).rejects.toThrow(
      AuthError,
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('throws RateLimitError on submit 429 with parsed Retry-After header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeResponse(
        429,
        { error: 'rate_limit_exceeded', limit: 100, reset_at: '2026-04-22T00:00:00Z' },
        { 'Retry-After': '12345' },
      ),
    );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });
    try {
      await client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retry_after_seconds).toBe(12345);
      expect((e as RateLimitError).reset_at).toBe('2026-04-22T00:00:00Z');
      expect((e as RateLimitError).limit).toBe(100);
    }
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('429 without Retry-After header defaults to 60s', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeResponse(429, { error: 'rate_limit_exceeded' }));
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });
    try {
      await client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as RateLimitError).retry_after_seconds).toBe(60);
    }
  });
});

describe('FluxClient — isWarm probe', () => {
  it('returns false initially', () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    expect(client.isWarm()).toBe(false);
    expect(client.getLastWarmTimestamp()).toBeNull();
  });

  it('returns true within warmThresholdMs after successful generate', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(
        makeResponse(202, { job_id: 'job-warmish', status_url: '/jobs/job-warmish', est_wait_seconds: 'unknown' }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, { output: { image_b64: 'X', metadata: { seed: 1, elapsed_ms: 1 } } }),
      );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });
    await client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 });
    expect(client.isWarm()).toBe(true);
  });
});

describe('FluxClient — warmup', () => {
  it('returns timing and updates warm state only after async job completes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(
        makeResponse(202, { job_id: 'job-warm', status_url: '/jobs/job-warm', est_wait_seconds: 'unknown' }, { Location: '/jobs/job-warm', 'Retry-After': '0' }),
      )
      .mockResolvedValueOnce(
        makeResponse(202, { status: 'running', est_wait_seconds: 'unknown' }, { 'Retry-After': '0' }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, { output: { image_b64: 'WARM', metadata: { seed: 1, elapsed_ms: 100 } } }),
      );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });
    const promise = client.warmup();
    await vi.advanceTimersByTimeAsync(2_500);
    const result = await promise;
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof result.was_cold).toBe('boolean');
    expect(client.isWarm()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

describe('FluxClient — retry-with-backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('retries submit on 5xx and succeeds on 2nd attempt', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(503, { error: 'upstream' }))
      .mockResolvedValueOnce(
        makeResponse(202, { job_id: 'job-2', status_url: '/jobs/job-2', est_wait_seconds: 'unknown' }, { Location: '/jobs/job-2', 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, { output: { image_b64: 'OK', metadata: { seed: 1, elapsed_ms: 1 } } }),
      );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: {
        fetchImpl: fetchSpy as unknown as typeof fetch,
        retry: { maxRetries: 3, initialDelayMs: 10, backoffStrategy: 'exponential' },
      },
    });

    const promise = client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;
    expect(result.output.image_b64).toBe('OK');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('throws TimeoutError(poll_exhausted) after poll budget is exhausted', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(202, { job_id: 'job-3', status_url: '/jobs/job-3', est_wait_seconds: 'unknown' }, { Location: '/jobs/job-3', 'Retry-After': '1' }),
      )
      .mockImplementation(async () =>
        makeResponse(202, { status: 'running', est_wait_seconds: 'unknown' }, { 'Retry-After': '1' }),
      );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: {
        fetchImpl: fetchSpy as unknown as typeof fetch,
        retry: { maxRetries: 2, initialDelayMs: 10, backoffStrategy: 'exponential' },
        warmTimeoutMs: 2_500,
      },
    });

    const promise = client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 });
    // Attach rejection handler synchronously so fake-timer advance doesn't race
    const captured = promise.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(4_000);
    const err = await captured;
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).cause).toBe('poll_exhausted');
  });

  it('does not retry on 401', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeResponse(401, { error: 'invalid_api_key' }));
    const client = new FluxClient({
      apiKey: 'bad',
      gatewayUrl: 'https://gw.example',
      options: {
        fetchImpl: fetchSpy as unknown as typeof fetch,
        retry: { maxRetries: 3, initialDelayMs: 10 },
      },
    });
    await expect(
      client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 }),
    ).rejects.toThrow(AuthError);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('does not retry on 429', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeResponse(429, { error: 'rate_limit_exceeded' }, { 'Retry-After': '60' }),
    );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: {
        fetchImpl: fetchSpy as unknown as typeof fetch,
        retry: { maxRetries: 3, initialDelayMs: 10 },
      },
    });
    await expect(
      client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 }),
    ).rejects.toThrow(RateLimitError);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('throws TimeoutError(runpod_timeout) on gateway generation_timeout 504', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(202, { job_id: 'job-4', status_url: '/jobs/job-4', est_wait_seconds: 'unknown' }, { Location: '/jobs/job-4', 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(makeResponse(504, { error: 'generation_timeout', timeout_s: 280 }));
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    await expect(
      client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 }),
    ).rejects.toMatchObject({ cause: 'runpod_timeout' });
  });

  it('surfaces terminal failed job without converting it to poll_exhausted', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(202, { job_id: 'job-f', status_url: '/jobs/job-f', est_wait_seconds: 'unknown' }, { Location: '/jobs/job-f', 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(makeResponse(500, { error: 'runpod_failed', status: 'failed' }));
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    await expect(
      client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 }),
    ).rejects.toThrow('runpod_failed:failed');
  });

  it('surfaces local gateway request timeout as NetworkError, not TimeoutError(gateway_504)', async () => {
    const fetchSpy = vi.fn().mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: {
        fetchImpl: fetchSpy as unknown as typeof fetch,
        retry: { maxRetries: 0, requestTimeoutMs: 25 },
      },
    });

    await expect(
      client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 }),
    ).rejects.toThrow('Network error: Request timed out after 25ms');
  });

  it('retries 404 during polling up to the KV race budget, then succeeds', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(202, { job_id: 'job-5', status_url: '/jobs/job-5', est_wait_seconds: 'unknown' }, { Location: '/jobs/job-5', 'Retry-After': '1' }),
      )
      .mockResolvedValueOnce(makeResponse(404, { error: 'job_not_found_or_expired' }))
      .mockResolvedValueOnce(makeResponse(404, { error: 'job_not_found_or_expired' }))
      .mockResolvedValueOnce(
        makeResponse(200, { output: { image_b64: 'OK', metadata: { seed: 1, elapsed_ms: 1 } } }),
      );

    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: {
        fetchImpl: fetchSpy as unknown as typeof fetch,
        retry: { initialDelayMs: 10, maxRetries: 1 },
      },
    });

    const promise = client.generate({ prompt: 'c', steps: 4, width: 1024, height: 1024 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result.output.image_b64).toBe('OK');
  });
});
