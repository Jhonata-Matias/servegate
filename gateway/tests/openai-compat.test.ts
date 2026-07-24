/**
 * Story 1.1 — OpenAI compatibility contract tests.
 *
 * Covers:
 *   - FR-1: POST /v1/chat/completions alias
 *   - FR-2: GET /v1/models + GET /v1/models/{id}
 *   - FR-4: Dual auth (validateAuthDual + dualAuthResponse)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dualAuthResponse, validateAuthDual } from '../src/auth.js';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

function makeEnv(): Env {
  return {
    RATE_LIMIT_KV: makeKv(),
    JOBS_KV: makeKv(),
    VIDEOS_KV: makeKv(),
    R2_VIDEOS_BUCKET: {} as R2Bucket,
    GATEWAY_API_KEY: 'test-gateway-key',
    RUNPOD_API_KEY: 'runpod-key',
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

// ---------------------------------------------------------------------------
// FR-1: POST /v1/chat/completions alias
// ---------------------------------------------------------------------------

describe('POST /v1/chat/completions (FR-1)', () => {
  it('returns 200 with OpenAI-shaped JSON for non-streaming request', async () => {
    stubJsonUpstream({
      object: 'chat.completion',
      model: 'gemma4:e4b',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { total_tokens: 5 },
    });

    const req = new Request('https://worker.test/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-gateway-key',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Say OK' }], stream: false }),
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.object).toBe('chat.completion');
    expect(body.model).toBe('gemma4:e4b');
    // Story 1.1 FR-3: id and created must be present
    expect(body.id).toMatch(/^chatcmpl-/);
    expect(typeof body.created).toBe('number');
  });

  it('returns 405 for GET on /v1/chat/completions', async () => {
    const req = new Request('https://worker.test/v1/chat/completions', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-gateway-key' },
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(405);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('returns 405 for PUT on /v1/chat/completions', async () => {
    const req = new Request('https://worker.test/v1/chat/completions', {
      method: 'PUT',
      headers: { 'X-API-Key': 'test-gateway-key' },
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(405);
  });

  it('returns 405 for DELETE on /v1/chat/completions', async () => {
    const req = new Request('https://worker.test/v1/chat/completions', {
      method: 'DELETE',
      headers: { 'X-API-Key': 'test-gateway-key' },
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(405);
  });

  it('accepts Authorization: Bearer as auth on /v1/chat/completions', async () => {
    stubJsonUpstream({
      object: 'chat.completion',
      model: 'gemma4:e4b',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { total_tokens: 5 },
    });

    const req = new Request('https://worker.test/v1/chat/completions', {
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
});

// ---------------------------------------------------------------------------
// FR-2: GET /v1/models
// ---------------------------------------------------------------------------

describe('GET /v1/models (FR-2)', () => {
  it('returns 200 with model list when authenticated via X-API-Key', async () => {
    const req = new Request('https://worker.test/v1/models', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-gateway-key' },
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    const model = (body.data as Array<Record<string, unknown>>)[0]!;
    expect(model.id).toBe('gemma4:e4b');
    expect(model.object).toBe('model');
    expect(model.owned_by).toBe('servegate');
    expect(model.created).toBe(1700000000);
  });

  it('returns 200 with model list when authenticated via Authorization: Bearer', async () => {
    const req = new Request('https://worker.test/v1/models', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-gateway-key' },
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.object).toBe('list');
  });

  it('returns 401 without authentication', async () => {
    const req = new Request('https://worker.test/v1/models', { method: 'GET' });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('returns 401 with wrong key', async () => {
    const req = new Request('https://worker.test/v1/models', {
      method: 'GET',
      headers: { 'X-API-Key': 'wrong-key' },
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(401);
  });

  it('returns 200 for GET /v1/models/gemma4:e4b', async () => {
    const req = new Request('https://worker.test/v1/models/gemma4:e4b', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-gateway-key' },
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe('gemma4:e4b');
    expect(body.object).toBe('model');
  });

  it('returns 404 for GET /v1/models/nonexistent', async () => {
    const req = new Request('https://worker.test/v1/models/nonexistent', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-gateway-key' },
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
    expect((body.error as Record<string, unknown>).code).toBe('model_not_found');
  });

  it('does not consume token quota (no rate-limit headers on /v1/models)', async () => {
    const req = new Request('https://worker.test/v1/models', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-gateway-key' },
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(200);
    // /v1/models does NOT return token rate-limit headers
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FR-4: Dual auth (validateAuthDual)
// ---------------------------------------------------------------------------

describe('validateAuthDual (FR-4)', () => {
  const KEY = 'test-key-12345';

  function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request('https://gateway.example/v1/models', {
      method: 'GET',
      headers,
    });
  }

  it('returns ok when only X-API-Key is present and valid', () => {
    const req = makeRequest({ 'X-API-Key': KEY });
    expect(validateAuthDual(req, [KEY])).toEqual({ ok: true });
  });

  it('returns ok when only Authorization: Bearer is present and valid', () => {
    const req = makeRequest({ Authorization: `Bearer ${KEY}` });
    expect(validateAuthDual(req, [KEY])).toEqual({ ok: true });
  });

  it('returns ok when both headers carry the same valid key', () => {
    const req = makeRequest({
      'X-API-Key': KEY,
      Authorization: `Bearer ${KEY}`,
    });
    expect(validateAuthDual(req, [KEY])).toEqual({ ok: true });
  });

  it('returns divergent when both headers carry different values', () => {
    const req = makeRequest({
      'X-API-Key': KEY,
      Authorization: 'Bearer different-key',
    });
    expect(validateAuthDual(req, [KEY])).toEqual({ ok: false, reason: 'divergent' });
  });

  it('returns missing when neither header is present', () => {
    const req = makeRequest();
    expect(validateAuthDual(req, [KEY])).toEqual({ ok: false, reason: 'missing' });
  });

  it('returns invalid when key does not match any in allowlist', () => {
    const req = makeRequest({ 'X-API-Key': 'wrong-key' });
    expect(validateAuthDual(req, [KEY])).toEqual({ ok: false, reason: 'invalid' });
  });

  it('returns invalid when Bearer token does not match', () => {
    const req = makeRequest({ Authorization: 'Bearer wrong-key' });
    expect(validateAuthDual(req, [KEY])).toEqual({ ok: false, reason: 'invalid' });
  });

  it('matches against multi-tenant allowlist (position N)', () => {
    const keys = ['k1', 'k2', 'k3'];
    const req = makeRequest({ 'X-API-Key': 'k3' });
    expect(validateAuthDual(req, keys)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// FR-4: dualAuthResponse
// ---------------------------------------------------------------------------

describe('dualAuthResponse (FR-4)', () => {
  it('returns 401 with divergent message', async () => {
    const res = dualAuthResponse({ ok: false, reason: 'divergent' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe('invalid_api_key');
    expect(err.type).toBe('authentication_error');
    expect(err.message).toContain('Conflicting');
  });

  it('returns 401 with missing message', async () => {
    const res = dualAuthResponse({ ok: false, reason: 'missing' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe('invalid_api_key');
    expect(err.message).toContain('Missing');
  });

  it('returns 401 with invalid message', async () => {
    const res = dualAuthResponse({ ok: false, reason: 'invalid' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    expect(err.code).toBe('invalid_api_key');
    expect(err.message).toContain('Invalid');
  });
});

// ---------------------------------------------------------------------------
// FR-3: Envelope normalization — id constant across frames
// ---------------------------------------------------------------------------

describe('Envelope normalization (FR-3)', () => {
  it('injects id and created into non-streaming /v1/generate response', async () => {
    stubJsonUpstream({
      object: 'chat.completion',
      model: 'gemma4:e4b',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { total_tokens: 5 },
    });

    const req = new Request('https://worker.test/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-gateway-key',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: false }),
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toMatch(/^chatcmpl-/);
    expect(typeof body.created).toBe('number');
    expect(body.object).toBe('chat.completion');
  });
});