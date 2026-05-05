import { afterEach, describe, expect, it, vi } from 'vitest';
import { FluxClient } from '../src/client.js';
import { RateLimitError, TimeoutError } from '../src/errors.js';
import type { GenerateVideoOutput } from '../src/index.js';

function makeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function makeBinaryResponse(status: number, bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(bytes, { status, headers });
}

const videoOutput: GenerateVideoOutput = {
  video_url: 'https://r2.example/videos/job-1.mp4?sig=abc',
  duration_seconds: 5.04,
  width: 704,
  height: 512,
  fps: 24,
  size_bytes: 820742,
  metrics: {
    queue_seconds: 0.8,
    execution_seconds: 86.8,
    wallclock_seconds: 87.6,
  },
};

function videoSubmit(jobId = 'video-1'): Response {
  return makeResponse(
    202,
    {
      job_id: jobId,
      status_url: `/jobs/${jobId}`,
      est_wait_seconds: { p50: 90, p95: 200, first_call_max: 600 },
    },
    { Location: `/jobs/${jobId}`, 'Retry-After': '5' },
  );
}

function videoDone(): Response {
  return makeResponse(200, {
    status: 'completed',
    output: { ...videoOutput, url_ttl_seconds: 86400 },
    metrics: videoOutput.metrics,
  });
}

describe('FluxClient — generateVideo', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves GenerateVideoOutput for a valid prompt', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(videoSubmit())
      .mockResolvedValueOnce(videoDone());
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    const result = await client.generateVideo({ prompt: 'A meadow at sunset' });

    expect(result).toEqual(videoOutput);
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toEqual({ kind: 'video', prompt: 'A meadow at sunset' });
  });

  it('resolves with a prompt and image data URL', async () => {
    const image = 'data:image/jpeg;base64,/9j/4AAQ';
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(videoSubmit())
      .mockResolvedValueOnce(videoDone());
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    await expect(client.generateVideo({ prompt: 'soft wind', image })).resolves.toEqual(videoOutput);
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['image']).toBe(image);
  });

  it('fetches an https image URL and submits it as a data URL', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(makeBinaryResponse(200, bytes, { 'Content-Type': 'image/jpeg', 'Content-Length': '4' }))
      .mockResolvedValueOnce(videoSubmit())
      .mockResolvedValueOnce(videoDone());
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    await client.generateVideo({ prompt: 'animate this', image: 'https://cdn.example/input.jpg' });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'https://cdn.example/input.jpg',
      expect.objectContaining({ method: 'GET' }),
    );
    const body = JSON.parse((fetchSpy.mock.calls[1]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['image']).toBe('data:image/jpeg;base64,/9j/2Q==');
  });

  it('reports progress from pending poll responses', async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(videoSubmit())
      .mockResolvedValueOnce(
        makeResponse(
          202,
          {
            status: 'running',
            progress: { phase: 'inferencing', percent_estimate: 40, est_wait_seconds: 50 },
          },
          { 'Retry-After': '1' },
        ),
      )
      .mockResolvedValueOnce(videoDone());
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    const promise = client.generateVideo({ prompt: 'rain', onProgress });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toEqual(videoOutput);
    expect(onProgress).toHaveBeenCalledWith({
      phase: 'inferencing',
      percent_estimate: 40,
      est_wait_seconds: 50,
    });
  });

  it('rejects with TimeoutError when the poll budget is exhausted', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(videoSubmit())
      .mockImplementation(() => Promise.resolve(makeResponse(202, { status: 'running' }, { 'Retry-After': '1' })));
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    const promise = client.generateVideo({ prompt: 'rain', timeoutMs: 2_500 }).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(4_000);
    const err = await promise;

    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).cause).toBe('poll_exhausted');
  });

  it('rejects with AbortError and stops polling after abort', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(videoSubmit())
      .mockResolvedValueOnce(makeResponse(202, { status: 'running' }, { 'Retry-After': '5' }));
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });
    const ac = new AbortController();

    const promise = client.generateVideo({ prompt: 'rain', signal: ac.signal }).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    ac.abort();
    const err = await promise;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects 429 rate_limit_exceeded as RateLimitError with reset_at', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeResponse(
        429,
        { error: 'rate_limit_exceeded', limit: 20, reset_at: '2026-05-05T03:00:00.000Z' },
        { 'Retry-After': '3600' },
      ),
    );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    await expect(client.generateVideo({ prompt: 'rain' })).rejects.toMatchObject({
      name: 'RateLimitError',
      retry_after_seconds: 3600,
      reset_at: '2026-05-05T03:00:00.000Z',
      limit: 20,
    } satisfies Partial<RateLimitError>);
  });

  it('retries transient poll 5xx three times with 1s/3s/9s backoff and succeeds', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(videoSubmit())
      .mockResolvedValueOnce(makeResponse(502, { error: 'upstream_error' }))
      .mockResolvedValueOnce(makeResponse(502, { error: 'upstream_error' }))
      .mockResolvedValueOnce(makeResponse(502, { error: 'upstream_error' }))
      .mockResolvedValueOnce(videoDone());
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    const promise = client.generateVideo({ prompt: 'rain' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(9_000);

    await expect(promise).resolves.toEqual(videoOutput);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('surfaces the gateway error after poll 5xx retries are exhausted', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(videoSubmit())
      .mockResolvedValueOnce(makeResponse(502, { error: 'upstream_error' }))
      .mockResolvedValueOnce(makeResponse(502, { error: 'upstream_error' }))
      .mockResolvedValueOnce(makeResponse(502, { error: 'upstream_error' }))
      .mockResolvedValueOnce(makeResponse(502, { error: 'upstream_error' }));
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    const promise = client.generateVideo({ prompt: 'rain' }).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(13_000);

    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('upstream_error');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('text2video delegates to generateVideo({ prompt })', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    const spy = vi.spyOn(client, 'generateVideo').mockResolvedValue(videoOutput);

    await expect(client.text2video('A meadow')).resolves.toEqual(videoOutput);

    expect(spy).toHaveBeenCalledWith({ prompt: 'A meadow' });
  });

  it('image2video delegates to generateVideo({ prompt, image })', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    const spy = vi.spyOn(client, 'generateVideo').mockResolvedValue(videoOutput);
    const image = 'data:image/png;base64,iVBORw0KGgo=';

    await expect(client.image2video(image, 'Animate it')).resolves.toEqual(videoOutput);

    expect(spy).toHaveBeenCalledWith({ prompt: 'Animate it', image });
  });
});

const integrationIt = process.env['SDK_INTEGRATION'] === 'live' ? it : it.skip;

describe('FluxClient — video live integration', () => {
  integrationIt('generates a video through the configured live gateway', async () => {
    const apiKey = process.env['GATEWAY_API_KEY'];
    const gatewayUrl = process.env['GATEWAY_URL'];
    if (!apiKey || !gatewayUrl) {
      throw new Error('GATEWAY_API_KEY and GATEWAY_URL are required when SDK_INTEGRATION=live');
    }

    const client = new FluxClient({ apiKey, gatewayUrl });
    const result = await client.text2video('A close-up of a meadow at sunset', {
      num_frames: 121,
      fps: 24,
      timeoutMs: 900_000,
    });

    expect(result.video_url).toMatch(/^https:\/\//);
    expect(result.duration_seconds).toBeGreaterThan(0);
    expect(result.size_bytes).toBeGreaterThan(0);
  }, 910_000);
});
