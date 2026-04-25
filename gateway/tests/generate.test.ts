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
  if (init.signal) {
    requestInit.signal = init.signal;
  }
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('POST /v1/generate contract', () => {
  it('returns non-streaming OpenAI-shaped JSON with rate-limit headers', async () => {
    stubJsonUpstream({
      object: 'chat.completion',
      model: 'gemma4:e4b',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { total_tokens: 12 },
    });
    const env = makeEnv();
    const ctx = makeCtx();

    const res = await worker.fetch(
      request({ messages: [{ role: 'user', content: 'Say OK' }], stream: false }),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('50000');
    expect(res.headers.get('X-Gateway-Model')).toBe('gemma4:e4b');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
    expect(await res.json()).toMatchObject({ object: 'chat.completion', usage: { total_tokens: 12 } });
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });

  it('accepts Authorization: Bearer as auth without changing auth.ts', async () => {
    stubJsonUpstream({
      object: 'chat.completion',
      model: 'gemma4:e4b',
      choices: [],
      usage: { total_tokens: 1 },
    });
    const req = new Request('https://worker.test/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-gateway-key',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: false }),
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(200);
  });

  it('rejects missing messages with 400', async () => {
    const res = await worker.fetch(request({ stream: false }), makeEnv(), makeCtx());

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_messages' });
  });

  it('rejects invalid JSON with 400', async () => {
    const req = new Request('https://worker.test/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-gateway-key' },
      body: 'not-json{',
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_json' });
  });

  it('rejects body over 2MB with 413', async () => {
    const res = await worker.fetch(
      request({ messages: [{ role: 'user', content: 'x' }] }, { headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } }),
      makeEnv(),
      makeCtx(),
    );

    expect(res.status).toBe(413);
  });

  it('returns 429 when token budget would be exceeded', async () => {
    const res = await worker.fetch(
      request({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 2048 }),
      makeEnv('49999'),
      makeCtx(),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('1');
  });

  it('maps upstream 5xx to 502', async () => {
    stubJsonUpstream({ error: 'upstream' }, 503);
    const res = await worker.fetch(
      request({ messages: [{ role: 'user', content: 'hi' }], stream: false }),
      makeEnv(),
      makeCtx(),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_error' });
  });

  it('returns CORS preflight headers', async () => {
    const res = await worker.fetch(new Request('https://worker.test/anything', { method: 'OPTIONS' }), makeEnv());

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization, X-API-Key');
  });
});
