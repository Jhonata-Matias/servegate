import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import {
  createVideoAccessToken,
  uploadVideoToR2,
  verifyVideoAccessToken,
  VIDEO_URL_TTL_SECONDS,
} from './r2-video.js';
import type { Env } from './types.js';

interface StoredR2Object {
  body: Uint8Array;
  options?: R2PutOptions | undefined;
}

function makeKv(): KVNamespace {
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
  } as unknown as KVNamespace;
}

function makeR2(initial: Record<string, Uint8Array> = {}): R2Bucket & {
  store: Map<string, StoredR2Object>;
} {
  const store = new Map<string, StoredR2Object>(
    Object.entries(initial).map(([key, body]) => [key, { body }]),
  );
  return {
    put: vi.fn(async (key: string, value: Uint8Array, options?: R2PutOptions) => {
      store.set(key, { body: value, options });
      return { key, size: value.byteLength } as R2Object;
    }),
    get: vi.fn(async (key: string) => {
      const found = store.get(key);
      if (!found) return null;
      const body = found.body;
      return {
        key,
        size: body.byteLength,
        body: new Blob([body]).stream(),
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      } as unknown as R2ObjectBody;
    }),
    head: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
    store,
  } as unknown as R2Bucket & { store: Map<string, StoredR2Object> };
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-04T12:00:00Z'));
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('uploadVideoToR2', () => {
  it('writes to R2 with correct key, content-type, and custom metadata', async () => {
    const env = makeEnv();
    const videoBytes = new Uint8Array([0, 1, 2, 3]);

    const result = await uploadVideoToR2(env, 'job-1', btoa('\x00\x01\x02\x03'), {
      submittedAt: '2026-05-04T12:00:00.000Z',
      apiKeyHash: 'hash-1',
    });

    expect(result.objectKey).toBe('videos/job-1.mp4');
    expect(result.sizeBytes).toBe(videoBytes.byteLength);
    expect(result.ttlSeconds).toBe(VIDEO_URL_TTL_SECONDS);
    expect(env.R2_VIDEOS_BUCKET.put).toHaveBeenCalledWith('videos/job-1.mp4', videoBytes, {
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: {
        job_id: 'job-1',
        submitted_at: '2026-05-04T12:00:00.000Z',
        api_key_hash: 'hash-1',
      },
    });
  });

  it('returns a token-signed URL with a 24h expiry', async () => {
    const env = makeEnv();

    const result = await uploadVideoToR2(env, 'job-ttl', btoa('mp4'), {
      submittedAt: '2026-05-04T12:00:00.000Z',
      apiKeyHash: 'hash-ttl',
    });

    const url = new URL(result.videoUrl);
    const token = url.searchParams.get('t') ?? '';
    expect(url.origin).toBe('https://worker.test');
    expect(url.pathname).toBe('/videos/job-ttl');
    await expect(verifyVideoAccessToken(env, 'job-ttl', token)).resolves.toEqual({ valid: true });

    vi.setSystemTime(new Date('2026-05-05T12:00:01Z'));
    await expect(verifyVideoAccessToken(env, 'job-ttl', token)).resolves.toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('uses GATEWAY_ORIGIN before legacy CORS_ALLOWED_ORIGIN for video URLs', async () => {
    const envWithGatewayOrigin = makeEnv({
      GATEWAY_ORIGIN: 'https://gateway.test',
      CORS_ALLOWED_ORIGIN: 'https://cors.test',
    });
    const envWithCorsOnly = makeEnv({ CORS_ALLOWED_ORIGIN: 'https://legacy.test' });

    const preferred = await uploadVideoToR2(envWithGatewayOrigin, 'job-origin-preferred', btoa('mp4'), {
      submittedAt: '2026-05-04T12:00:00.000Z',
      apiKeyHash: 'hash-origin-preferred',
    });
    const legacy = await uploadVideoToR2(envWithCorsOnly, 'job-origin-legacy', btoa('mp4'), {
      submittedAt: '2026-05-04T12:00:00.000Z',
      apiKeyHash: 'hash-origin-legacy',
    });

    expect(new URL(preferred.videoUrl).origin).toBe('https://gateway.test');
    expect(new URL(legacy.videoUrl).origin).toBe('https://legacy.test');
  });
});

describe('GET /videos/:jobId', () => {
  it('returns 200 and streams binary video for a valid token', async () => {
    const env = makeEnv({
      R2_VIDEOS_BUCKET: makeR2({ 'videos/job-ok.mp4': new Uint8Array([1, 2, 3]) }),
    });
    const token = await createVideoAccessToken(env, 'job-ok');

    const res = await worker.fetch(new Request(`https://worker.test/videos/job-ok?t=${token}`), env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Length')).toBe('3');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('returns 401 for an expired token', async () => {
    const env = makeEnv({
      R2_VIDEOS_BUCKET: makeR2({ 'videos/job-expired.mp4': new Uint8Array([1]) }),
    });
    const token = await createVideoAccessToken(env, 'job-expired');
    vi.setSystemTime(new Date('2026-05-05T12:00:01Z'));

    const res = await worker.fetch(new Request(`https://worker.test/videos/job-expired?t=${token}`), env);

    expect(res.status).toBe(401);
  });

  it('returns 401 for a bad signature', async () => {
    const env = makeEnv({
      R2_VIDEOS_BUCKET: makeR2({ 'videos/job-bad.mp4': new Uint8Array([1]) }),
    });
    const otherEnv = makeEnv({ GATEWAY_API_KEY: 'other-secret' });
    const token = await createVideoAccessToken(otherEnv, 'job-bad');

    const res = await worker.fetch(new Request(`https://worker.test/videos/job-bad?t=${token}`), env);

    expect(res.status).toBe(401);
  });

  it('returns 404 for a missing R2 object', async () => {
    const env = makeEnv();
    const token = await createVideoAccessToken(env, 'job-missing');

    const res = await worker.fetch(new Request(`https://worker.test/videos/job-missing?t=${token}`), env);

    expect(res.status).toBe(404);
  });
});
