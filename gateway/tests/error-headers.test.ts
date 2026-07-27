/**
 * Story 7.1.1 — Regression tests: every error response from /v1/generate must
 * emit `x-request-id`. Commit 07a6a2c added the header to success paths only,
 * causing VS Code Copilot BYOK to crash with `Cannot read properties of
 * undefined (reading 'headerRequestId')` on transient 502s from the Qwen POD.
 *
 * These tests lock the fix in place for the three canonical error codes:
 *   - 502 upstream_error (POD unreachable / 5xx)
 *   - 429 rate_limit_exceeded (token budget exhausted, gemma4:e4b path)
 *   - 401 invalid_api_key (auth failure early-return)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';

function makeKv(initial: Record<string, string> = {}): KVNamespace & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
    store,
  } as unknown as KVNamespace & { store: Map<string, string> };
}

function makeEnv(initialTokens?: string): Env {
  return {
    RATE_LIMIT_KV: makeKv(initialTokens ? { 'tokens:2026-04-24': initialTokens } : {}),
    JOBS_KV: makeKv(),
    VIDEOS_KV: makeKv(),
    R2_VIDEOS_BUCKET: {} as R2Bucket,
    GATEWAY_API_KEY: 'test-gateway-key',
    RUNPOD_API_KEY: 'test-runpod-key',
    RUNPOD_ENDPOINT_ID: 'image-endpoint',
    RUNPOD_TEXT_ENDPOINT_ID: 'text-endpoint',
    CORS_ALLOWED_ORIGIN: 'https://app.example',
  };
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext;
}

function request(body: unknown, init: RequestInit = {}): Request {
  const requestInit: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'test-gateway-key',
      ...(init.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
  };
  return new Request('https://worker.test/v1/generate', requestInit);
}

function stubJsonUpstream(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(body, {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

const REQUEST_ID_RE = /^chatcmpl-[a-f0-9-]{36}$/;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Story 7.1.1 — error responses include x-request-id', () => {
  it('502 upstream_error (upstream 5xx) carries x-request-id', async () => {
    stubJsonUpstream({ error: 'upstream boom' }, 503);
    const res = await worker.fetch(
      request({ messages: [{ role: 'user', content: 'hi' }], stream: false }),
      makeEnv(),
      makeCtx(),
    );

    expect(res.status).toBe(502);
    expect(res.headers.get('x-request-id')).toMatch(REQUEST_ID_RE);
  });

  it('429 rate_limit_exceeded (token budget exhausted) carries x-request-id', async () => {
    const res = await worker.fetch(
      request({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 2048 }),
      makeEnv('49999'),
      makeCtx(),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('x-request-id')).toMatch(REQUEST_ID_RE);
  });

  it('401 invalid_api_key (missing auth) carries x-request-id', async () => {
    const req = new Request('https://worker.test/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(401);
    expect(res.headers.get('x-request-id')).toMatch(REQUEST_ID_RE);
  });
});
