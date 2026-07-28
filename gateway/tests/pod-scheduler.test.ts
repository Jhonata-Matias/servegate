/**
 * Story 7.1 — POD scheduler tests
 *
 * Covers:
 *   - Morning start cron calls POST /v1/pods/{id}/start
 *   - Evening stop cron calls POST /v1/pods/{id}/stop
 *   - Idle check within 60min → no-op (POD stays warm)
 *   - Idle check over 60min → POST /v1/pods/{id}/stop
 *   - Idle check with no last-request timestamp → no-op (grace)
 *   - Unknown cron pattern → no-op
 *   - Missing POD_ID or API_KEY → no-op (safe)
 *   - Auth header uses RUNPOD_API_KEY as Bearer
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleScheduled } from '../src/pod-scheduler.js';
import type { Env } from '../src/types.js';

function makeKv(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

function makeEnv(kvInitial: Record<string, string> = {}, overrides: Partial<Env> = {}): Env {
  return {
    RATE_LIMIT_KV: makeKv(kvInitial),
    JOBS_KV: makeKv(),
    VIDEOS_KV: makeKv(),
    R2_VIDEOS_BUCKET: {} as R2Bucket,
    GATEWAY_API_KEY: 'test-gateway-key',
    RUNPOD_API_KEY: 'test-runpod-key',
    RUNPOD_ENDPOINT_ID: 'image-endpoint',
    RUNPOD_TEXT_ENDPOINT_ID: 'text-endpoint-id',
    RUNPOD_CODER_POD_ID: 'test-pod-id',
    RUNPOD_CODER_POD_URL: 'https://test-pod-id-11434.proxy.runpod.net/v1/chat/completions',
    ...overrides,
  };
}

function makeCtx() {
  return { waitUntil: vi.fn((p: Promise<unknown>) => { void p; }) };
}

const OK_RESPONSE = () => new Response('{}', { status: 200 });

// ---------------------------------------------------------------------------
// Cron dispatch
// ---------------------------------------------------------------------------

describe('handleScheduled — cron dispatch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => OK_RESPONSE()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('morning start cron POSTs to /v1/pods/{id}/start with Bearer auth', async () => {
    const env = makeEnv();
    await handleScheduled({ cron: '0 11 * * 1-5', scheduledTime: Date.now() }, env, makeCtx());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toContain('/pods/test-pod-id/start');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-runpod-key');
  });

  it('evening stop cron POSTs to /v1/pods/{id}/stop', async () => {
    const env = makeEnv();
    await handleScheduled({ cron: '0 21 * * 1-5', scheduledTime: Date.now() }, env, makeCtx());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toContain('/pods/test-pod-id/stop');
  });

  it('idle-check cron with recent request (< 60min) is NO-OP', async () => {
    const now = Date.now();
    const env = makeEnv({ 'coder:last_request_ms': String(now - 30 * 60 * 1000) }); // 30min ago
    await handleScheduled({ cron: '*/5 13-18 * * 1-5', scheduledTime: now }, env, makeCtx());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('idle-check cron with stale request (> 60min) STOPS the POD', async () => {
    const now = Date.now();
    const env = makeEnv({ 'coder:last_request_ms': String(now - 90 * 60 * 1000) }); // 90min ago
    await handleScheduled({ cron: '*/5 13-18 * * 1-5', scheduledTime: now }, env, makeCtx());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toContain('/pods/test-pod-id/stop');
  });

  it('idle-check cron with no last-request key is NO-OP (grace)', async () => {
    const env = makeEnv({}); // KV empty
    await handleScheduled({ cron: '*/5 13-18 * * 1-5', scheduledTime: Date.now() }, env, makeCtx());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('idle-check cron with corrupted timestamp is NO-OP (defensive)', async () => {
    const env = makeEnv({ 'coder:last_request_ms': 'not-a-number' });
    await handleScheduled({ cron: '*/5 13-18 * * 1-5', scheduledTime: Date.now() }, env, makeCtx());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('idle-check pattern matches multiple minute-hour combinations', async () => {
    const env = makeEnv({ 'coder:last_request_ms': String(Date.now() - 90 * 60 * 1000) });
    // Cloudflare passes the exact cron string that matched; the scheduler should
    // recognize the idle-check by prefix regardless of which specific 5-min tick
    // triggered it.
    for (const cron of ['*/5 13-18 * * 1-5', '*/5 13-18 * * *']) {
      const fetchMock = vi.fn(async () => OK_RESPONSE());
      vi.stubGlobal('fetch', fetchMock);
      await handleScheduled({ cron, scheduledTime: Date.now() }, env, makeCtx());
      expect(fetchMock).toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it('unknown cron pattern is NO-OP (defensive)', async () => {
    const env = makeEnv({ 'coder:last_request_ms': String(Date.now() - 90 * 60 * 1000) });
    await handleScheduled({ cron: '0 0 * * *', scheduledTime: Date.now() }, env, makeCtx());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing RUNPOD_CODER_POD_ID is safe NO-OP', async () => {
    const env = makeEnv();
    delete (env as { RUNPOD_CODER_POD_ID?: string }).RUNPOD_CODER_POD_ID;
    await handleScheduled({ cron: '0 11 * * 1-5', scheduledTime: Date.now() }, env, makeCtx());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing RUNPOD_API_KEY is safe NO-OP', async () => {
    const env = makeEnv();
    (env as { RUNPOD_API_KEY?: string }).RUNPOD_API_KEY = '';
    await handleScheduled({ cron: '0 11 * * 1-5', scheduledTime: Date.now() }, env, makeCtx());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('RunPod 400 (already in state) is treated as success, not error', async () => {
    // start on already-running POD returns 400; scheduler should not blow up.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    const env = makeEnv();
    await expect(
      handleScheduled({ cron: '0 11 * * 1-5', scheduledTime: Date.now() }, env, makeCtx()),
    ).resolves.toBeUndefined();
  });

  it('network error in RunPod call is caught (does not throw)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('econnrefused'); }));
    const env = makeEnv();
    await expect(
      handleScheduled({ cron: '0 21 * * 1-5', scheduledTime: Date.now() }, env, makeCtx()),
    ).resolves.toBeUndefined();
  });
});
