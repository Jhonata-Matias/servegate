import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
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

function makeEnv(): Env {
  return {
    RATE_LIMIT_KV: makeKv(),
    JOBS_KV: makeKv(),
    GATEWAY_API_KEY: 'test-gateway-key',
    RUNPOD_API_KEY: 'test-runpod-key',
    RUNPOD_ENDPOINT_ID: 'image-endpoint',
    RUNPOD_LTX_ENDPOINT_ID: 'ltx-endpoint',
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
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
});
