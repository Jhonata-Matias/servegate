import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { checkVideoQuota, incrementVideoQuotaPostFlight } from './rate-limit.js';
import type { Env } from './types.js';

function makeKv(): KVNamespace & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

function makeR2(): R2Bucket & { _store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return {
    put: vi.fn(async (key: string, value: Uint8Array) => {
      store.set(key, value);
      return { key, size: value.byteLength } as R2Object;
    }),
    get: vi.fn(async (key: string) => {
      const body = store.get(key);
      if (!body) return null;
      return {
        key,
        size: body.byteLength,
        body: new Blob([body]).stream(),
      } as unknown as R2ObjectBody;
    }),
    head: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
    _store: store,
  } as unknown as R2Bucket & { _store: Map<string, Uint8Array> };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    RATE_LIMIT_KV: makeKv(),
    JOBS_KV: makeKv(),
    VIDEOS_KV: makeKv(),
    R2_VIDEOS_BUCKET: makeR2(),
    GATEWAY_API_KEY: 'test-gateway-key',
    RUNPOD_API_KEY: 'test-runpod-key',
    RUNPOD_ENDPOINT_ID: 'image-endpoint',
    RUNPOD_LTX_ENDPOINT_ID: 'ltx-endpoint',
    CORS_ALLOWED_ORIGIN: 'https://worker.test',
    ...overrides,
  };
}

function req(body: unknown): Request {
  return new Request('https://worker.test/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'test-gateway-key',
    },
    body: JSON.stringify(body),
  });
}

function getReq(path: string): Request {
  return new Request(`https://worker.test${path}`, {
    method: 'GET',
    headers: {
      'X-API-Key': 'test-gateway-key',
    },
  });
}

function stubRunpod(
  body: unknown = { id: 'rp-video', status: 'IN_QUEUE' },
  init: { status?: number } = {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-04T12:00:00Z'));
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function hashApiKey(apiKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('POST /jobs kind=video', () => {
  it('accepts a valid text-to-video request', async () => {
    const fetchMock = stubRunpod();
    const env = makeEnv();

    const res = await worker.fetch(req({ kind: 'video', prompt: 'meadow at sunset' }), env);

    expect(res.status).toBe(202);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect(res.headers.get('Location')).toMatch(/^\/jobs\/[a-f0-9-]+$/);
    const body = (await res.json()) as {
      job_id: string;
      status_url: string;
      est_wait_seconds: { p50: number; p95: number; first_call_max: number };
    };
    expect(body.job_id).toMatch(/^[a-f0-9-]+$/);
    expect(body.status_url).toBe(`/jobs/${body.job_id}`);
    expect(body.est_wait_seconds).toEqual({ p50: 90, p95: 200, first_call_max: 600 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v2/ltx-endpoint/run'),
      expect.any(Object),
    );
    const rawMapping = await env.JOBS_KV.get(body.job_id);
    expect(JSON.parse(rawMapping ?? '{}')).toMatchObject({ kind: 'video', runpod_request_id: 'rp-video' });
  });

  it('accepts a valid image-to-video request', async () => {
    stubRunpod();
    const env = makeEnv();
    const image = `data:image/jpeg;base64,${btoa('jpeg bytes')}`;

    const res = await worker.fetch(req({ kind: 'video', prompt: 'make it move', image }), env);

    expect(res.status).toBe(202);
    const body = (await res.json()) as { job_id: string };
    expect(body.job_id).toMatch(/^[a-f0-9-]+$/);
  });

  it('rejects an empty prompt', async () => {
    stubRunpod();
    const res = await worker.fetch(req({ kind: 'video', prompt: '   ' }), makeEnv());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_input',
      field: 'prompt',
    });
  });

  it('rejects a prompt over 2000 chars', async () => {
    stubRunpod();
    const res = await worker.fetch(req({ kind: 'video', prompt: 'x'.repeat(2001) }), makeEnv());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_input',
      field: 'prompt',
    });
  });

  it('rejects image data over 12MB decoded', async () => {
    stubRunpod();
    const oversizedBase64 = 'A'.repeat(16 * 1024 * 1024 + 4);
    const res = await worker.fetch(
      req({ kind: 'video', prompt: 'x', image: `data:image/png;base64,${oversizedBase64}` }),
      makeEnv(),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_input',
      field: 'image',
    });
  });

  it('rejects num_frames=200 as out of range', async () => {
    stubRunpod();
    const res = await worker.fetch(req({ kind: 'video', prompt: 'x', num_frames: 200 }), makeEnv());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_input',
      field: 'num_frames',
    });
  });

  it('rejects unsupported body fields', async () => {
    stubRunpod();
    const res = await worker.fetch(
      req({ kind: 'video', prompt: 'x', weird_field: true }),
      makeEnv(),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'invalid_input',
      field: 'weird_field',
      reason: 'unsupported field',
    });
  });

  it('routes POST /jobs without kind through the existing image flow', async () => {
    const fetchMock = stubRunpod({ id: 'rp-image', status: 'IN_QUEUE' });
    const env = makeEnv();

    const res = await worker.fetch(req({ prompt: 'forest' }), env);

    expect(res.status).toBe(202);
    const body = (await res.json()) as { est_wait_seconds: string };
    expect(body.est_wait_seconds).toBe('unknown');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v2/image-endpoint/run'),
      expect.any(Object),
    );
  });

  it('rejects an unsupported kind', async () => {
    stubRunpod();
    const res = await worker.fetch(req({ kind: 'banana', prompt: 'x' }), makeEnv());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'unsupported_kind',
      supported: ['image', 'video'],
    });
  });

  it('maps RunPod 500s to upstream_error', async () => {
    stubRunpod({ error: 'boom' }, { status: 500 });

    const res = await worker.fetch(req({ kind: 'video', prompt: 'x' }), makeEnv());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: 'upstream_error',
      retryable: true,
    });
  });

  it('returns 429 with Story 5.2 AC5 shape when video quota is at limit', async () => {
    const fetchMock = stubRunpod();
    const env = makeEnv();
    const apiKeyHash = await hashApiKey('test-gateway-key');
    await env.VIDEOS_KV.put(`videos:2026-05-04:${apiKeyHash}`, '20');

    const res = await worker.fetch(req({ kind: 'video', prompt: 'x' }), env);

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({
      error: 'rate_limit_exceeded',
      reset_at: '2026-05-05T00:00:00.000Z',
      limit: 20,
      period_remaining_seconds: 12 * 3600,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps image quota in RATE_LIMIT_KV and video quota in VIDEOS_KV', async () => {
    const fetchMock = stubRunpod({ id: 'rp-any', status: 'IN_QUEUE' });
    const imageEnv = makeEnv();

    const imageRes = await worker.fetch(req({ prompt: 'forest' }), imageEnv);

    expect(imageRes.status).toBe(202);
    expect(imageEnv.RATE_LIMIT_KV.get).toHaveBeenCalledWith('count:2026-05-04');
    expect(imageEnv.RATE_LIMIT_KV.put).toHaveBeenCalledWith('count:2026-05-04', '1', {
      expirationTtl: 48 * 3600,
    });
    expect(imageEnv.VIDEOS_KV.get).not.toHaveBeenCalled();
    expect(imageEnv.VIDEOS_KV.put).not.toHaveBeenCalled();

    fetchMock.mockClear();
    const videoEnv = makeEnv();
    const apiKeyHash = await hashApiKey('test-gateway-key');

    const videoRes = await worker.fetch(req({ kind: 'video', prompt: 'meadow' }), videoEnv);

    expect(videoRes.status).toBe(202);
    expect(videoEnv.VIDEOS_KV.get).toHaveBeenCalledWith(`videos:2026-05-04:${apiKeyHash}`);
    expect(videoEnv.RATE_LIMIT_KV.get).not.toHaveBeenCalled();
    expect(videoEnv.RATE_LIMIT_KV.put).not.toHaveBeenCalled();
  });
});

describe('GET /jobs kind=video', () => {
  it('returns 202 with Retry-After while the RunPod video job is in progress', async () => {
    const fetchMock = stubRunpod({ id: 'rp-video-status', status: 'IN_PROGRESS' });
    const env = makeEnv();
    const apiKeyHash = await hashApiKey('test-gateway-key');
    await env.JOBS_KV.put('job-video-running', JSON.stringify({
      job_id: 'job-video-running',
      runpod_request_id: 'rp-video-status',
      runpod_endpoint_id: 'ltx-endpoint',
      kind: 'video',
      status: 'queued',
      created_at: Date.now(),
      submitted_at: new Date().toISOString(),
      api_key_hash: apiKeyHash,
    }));

    const res = await worker.fetch(getReq('/jobs/job-video-running'), env);

    expect(res.status).toBe(202);
    expect(res.headers.get('Retry-After')).toBe('5');
    await expect(res.json()).resolves.toMatchObject({
      status: 'running',
      est_wait_seconds: 'unknown',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v2/ltx-endpoint/status/rp-video-status'),
      expect.any(Object),
    );
  });

  it('uploads completed video output to R2 and increments quota only once across polls', async () => {
    const fetchMock = stubRunpod({
      id: 'rp-video-done',
      status: 'COMPLETED',
      delayTime: 800,
      executionTime: 86800,
      output: {
        video_b64: btoa('mp4-bytes'),
        metadata: {
          duration_seconds: 5.04,
          width: 704,
          height: 512,
          fps: 24,
        },
      },
    });
    const env = makeEnv();
    const apiKeyHash = await hashApiKey('test-gateway-key');
    await env.JOBS_KV.put('job-video-done', JSON.stringify({
      job_id: 'job-video-done',
      runpod_request_id: 'rp-video-done',
      runpod_endpoint_id: 'ltx-endpoint',
      kind: 'video',
      status: 'queued',
      created_at: Date.now(),
      submitted_at: '2026-05-04T12:00:00.000Z',
      api_key_hash: apiKeyHash,
    }));

    const first = await worker.fetch(getReq('/jobs/job-video-done'), env);

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      status: 'completed',
      output: {
        video_url: expect.stringMatching(/^https:\/\/worker\.test\/videos\/job-video-done\?t=/),
        duration_seconds: 5.04,
        width: 704,
        height: 512,
        fps: 24,
        size_bytes: 9,
        url_ttl_seconds: 86400,
      },
      metrics: {
        queue_seconds: 0.8,
        execution_seconds: 86.8,
        wallclock_seconds: 87.6,
      },
    });
    expect(env.R2_VIDEOS_BUCKET.put).toHaveBeenCalledTimes(1);
    expect(env.R2_VIDEOS_BUCKET.put).toHaveBeenCalledWith(
      'videos/job-video-done.mp4',
      new TextEncoder().encode('mp4-bytes'),
      expect.objectContaining({
        httpMetadata: { contentType: 'video/mp4' },
        customMetadata: {
          job_id: 'job-video-done',
          submitted_at: '2026-05-04T12:00:00.000Z',
          api_key_hash: apiKeyHash,
        },
      }),
    );
    await expect(env.VIDEOS_KV.get(`videos:2026-05-04:${apiKeyHash}`)).resolves.toBe('1');

    fetchMock.mockClear();
    vi.mocked(env.R2_VIDEOS_BUCKET.put).mockClear();
    vi.mocked(env.VIDEOS_KV.put).mockClear();

    const second = await worker.fetch(getReq('/jobs/job-video-done'), env);

    expect(second.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(env.R2_VIDEOS_BUCKET.put).not.toHaveBeenCalled();
    expect(env.VIDEOS_KV.put).not.toHaveBeenCalled();
    await expect(second.json()).resolves.toMatchObject({
      status: 'completed',
      output: {
        duration_seconds: 5.04,
        size_bytes: 9,
        url_ttl_seconds: 86400,
      },
    });
  });

  it('keeps kind=image polling on the existing inline output flow', async () => {
    const fetchMock = stubRunpod({
      id: 'rp-image-done',
      status: 'COMPLETED',
      output: { image_b64: 'iVBORw0KGgo=', metadata: { seed: 7, elapsed_ms: 6800 } },
    });
    const env = makeEnv();
    await env.JOBS_KV.put('job-image-done', JSON.stringify({
      job_id: 'job-image-done',
      runpod_request_id: 'rp-image-done',
      kind: 'image',
      status: 'queued',
      created_at: Date.now(),
    }));

    const res = await worker.fetch(getReq('/jobs/job-image-done'), env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      output: { image_b64: 'iVBORw0KGgo=', metadata: { seed: 7, elapsed_ms: 6800 } },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v2/image-endpoint/status/rp-image-done'),
      expect.any(Object),
    );
    expect(env.R2_VIDEOS_BUCKET.put).not.toHaveBeenCalled();
    expect(env.VIDEOS_KV.put).not.toHaveBeenCalled();
  });
});

describe('video quota helpers', () => {
  it('allows under-limit checks at count 0 and below limit without incrementing', async () => {
    const env = makeEnv();
    const apiKeyHash = 'hash-under-limit';

    await expect(checkVideoQuota(env, apiKeyHash, '2026-05-04')).resolves.toEqual({
      allowed: true,
      limit: 20,
      count: 0,
      resetAt: '2026-05-05T00:00:00.000Z',
    });
    expect(env.VIDEOS_KV.put).not.toHaveBeenCalled();

    await env.VIDEOS_KV.put(`videos:2026-05-04:${apiKeyHash}`, '19');
    await expect(checkVideoQuota(env, apiKeyHash, '2026-05-04')).resolves.toEqual({
      allowed: true,
      limit: 20,
      count: 19,
      resetAt: '2026-05-05T00:00:00.000Z',
    });
  });

  it('is idempotent per jobId on post-flight increment', async () => {
    const env = makeEnv();

    await expect(
      incrementVideoQuotaPostFlight(env, 'hash-idempotent', '2026-05-04', 'job-1'),
    ).resolves.toEqual({ incremented: true, count: 1 });
    await expect(
      incrementVideoQuotaPostFlight(env, 'hash-idempotent', '2026-05-04', 'job-1'),
    ).resolves.toEqual({ incremented: false, count: 1 });

    await expect(env.VIDEOS_KV.get('videos:2026-05-04:hash-idempotent')).resolves.toBe('1');
  });

  it('advances the counter for different jobIds', async () => {
    const env = makeEnv();

    await expect(
      incrementVideoQuotaPostFlight(env, 'hash-multi', '2026-05-04', 'job-1'),
    ).resolves.toEqual({ incremented: true, count: 1 });
    await expect(
      incrementVideoQuotaPostFlight(env, 'hash-multi', '2026-05-04', 'job-2'),
    ).resolves.toEqual({ incremented: true, count: 2 });

    await expect(env.VIDEOS_KV.get('videos:2026-05-04:hash-multi')).resolves.toBe('2');
  });

  it('sets 48h TTL on counter and marker writes', async () => {
    const env = makeEnv();

    await incrementVideoQuotaPostFlight(env, 'hash-ttl', '2026-05-04', 'job-ttl');

    expect(env.VIDEOS_KV.put).toHaveBeenCalledWith('videos:2026-05-04:hash-ttl', '1', {
      expirationTtl: 48 * 3600,
    });
    expect(env.VIDEOS_KV.put).toHaveBeenCalledWith(
      'videos:2026-05-04:hash-ttl:job:job-ttl',
      '1',
      { expirationTtl: 48 * 3600 },
    );
  });

  it('uses custom VIDEO_DAILY_LIMIT and rejects at that count', async () => {
    const env = makeEnv({ VIDEO_DAILY_LIMIT: '5' });
    await env.VIDEOS_KV.put('videos:2026-05-04:hash-custom-limit', '5');

    await expect(checkVideoQuota(env, 'hash-custom-limit', '2026-05-04')).resolves.toEqual({
      allowed: false,
      limit: 5,
      count: 5,
      resetAt: '2026-05-05T00:00:00.000Z',
    });
  });
});
