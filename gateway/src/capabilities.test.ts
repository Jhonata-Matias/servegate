import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES_RESPONSE } from './capabilities-constants.js';
import worker from './index.js';
import type { Env } from './types.js';

const mocks = vi.hoisted(() => ({
  validateAuth: vi.fn(),
  buildRateLimitResponse: vi.fn(),
  checkAndIncrement: vi.fn(),
  checkAndRead: vi.fn(),
  checkVideoQuota: vi.fn(),
}));

vi.mock('./auth.js', () => ({
  validateAuth: mocks.validateAuth,
}));

vi.mock('./rate-limit.js', () => ({
  DAILY_LIMIT: 20,
  buildRateLimitResponse: mocks.buildRateLimitResponse,
  checkAndIncrement: mocks.checkAndIncrement,
  checkAndRead: mocks.checkAndRead,
  checkVideoQuota: mocks.checkVideoQuota,
}));

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
    VIDEOS_KV: makeKv(),
    R2_VIDEOS_BUCKET: {} as R2Bucket,
    GATEWAY_API_KEY: 'test-gateway-key',
    RUNPOD_API_KEY: 'test-runpod-key',
    RUNPOD_ENDPOINT_ID: 'image-endpoint',
    RUNPOD_LTX_ENDPOINT_ID: 'ltx-endpoint',
  };
}

function capabilitiesRequest(init: RequestInit = {}): Request {
  return new Request('https://worker.test/capabilities', {
    method: 'GET',
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /capabilities', () => {
  it('returns 200 with JSON content-type and cache headers', async () => {
    const res = await worker.fetch(capabilitiesRequest(), makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('returns the exact capabilities response shape as well-formed JSON', async () => {
    const res = await worker.fetch(capabilitiesRequest(), makeEnv());
    const rawBody = await res.text();

    expect(() => JSON.parse(rawBody)).not.toThrow();
    expect(JSON.parse(rawBody)).toEqual(CAPABILITIES_RESPONSE);
  });

  it('marks all advertised capability surfaces as available', async () => {
    const res = await worker.fetch(capabilitiesRequest(), makeEnv());
    const body = (await res.json()) as typeof CAPABILITIES_RESPONSE;

    expect(Object.keys(body.capabilities).sort()).toEqual(['image', 'text', 'video']);
    expect(body.capabilities.image.available).toBe(true);
    expect(body.capabilities.text.available).toBe(true);
    expect(body.capabilities.video.available).toBe(true);
  });

  it('returns the existing fallback for non-GET methods on /capabilities', async () => {
    const res = await worker.fetch(capabilitiesRequest({ method: 'POST' }), makeEnv());

    expect(res.status).toBe(405);
    await expect(res.json()).resolves.toEqual({
      error: 'method_not_allowed',
      allowed: ['POST /jobs', 'GET /jobs/{id}'],
    });
  });

  it('does not invoke auth or rate-limit checks', async () => {
    const res = await worker.fetch(capabilitiesRequest(), makeEnv());

    expect(res.status).toBe(200);
    expect(mocks.validateAuth).not.toHaveBeenCalled();
    expect(mocks.checkAndIncrement).not.toHaveBeenCalled();
    expect(mocks.checkAndRead).not.toHaveBeenCalled();
    expect(mocks.checkVideoQuota).not.toHaveBeenCalled();
    expect(mocks.buildRateLimitResponse).not.toHaveBeenCalled();
  });
});
