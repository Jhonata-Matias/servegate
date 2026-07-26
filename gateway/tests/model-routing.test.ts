/**
 * Story 7.1 — Multi-model routing tests
 *
 * Covers:
 *   - resolveModelEndpoint unit (5 cases: gemma4, qwen3-coder, unknown, secrets missing)
 *   - handleGenerate integration: URL contains correct endpoint ID per model
 *   - Model not found for unknown models (SUPPORTED_MODELS gate)
 *   - Model not found when qwen3-coder:30b secret is unset (partial-rollback state)
 *   - /v1/models catalog contains both gemma4:e4b and qwen3-coder:30b
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateInternals } from '../src/generate.js';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';

// ---------------------------------------------------------------------------
// Test helpers (mirrors gateway/tests/generate.test.ts convention)
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

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    RATE_LIMIT_KV: makeKv(),
    JOBS_KV: makeKv(),
    VIDEOS_KV: makeKv(),
    R2_VIDEOS_BUCKET: {} as R2Bucket,
    GATEWAY_API_KEY: 'test-gateway-key',
    RUNPOD_API_KEY: 'test-runpod-key',
    RUNPOD_ENDPOINT_ID: 'image-endpoint',
    RUNPOD_TEXT_ENDPOINT_ID: 'text-endpoint-id',
    RUNPOD_CODER_ENDPOINT_ID: 'coder-endpoint-id',
    CORS_ALLOWED_ORIGIN: 'https://app.example',
    ...overrides,
  };
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext;
}

function chatRequest(body: unknown, path = '/v1/chat/completions'): Request {
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'test-gateway-key',
    },
    body: JSON.stringify(body),
  });
}

function makeUpstreamCompletion(): unknown {
  return {
    id: 'upstream-id-ignored',
    object: 'chat.completion',
    created: 0,
    model: 'ignored',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: { total_tokens: 3, prompt_tokens: 2, completion_tokens: 1 },
  };
}

// ---------------------------------------------------------------------------
// resolveModelEndpoint — unit
// ---------------------------------------------------------------------------

describe('resolveModelEndpoint', () => {
  it('resolves gemma4:e4b to RUNPOD_TEXT_ENDPOINT_ID', () => {
    const env = makeEnv();
    expect(generateInternals.resolveModelEndpoint('gemma4:e4b', env)).toBe('text-endpoint-id');
  });

  it('resolves qwen3-coder:30b to RUNPOD_CODER_ENDPOINT_ID', () => {
    const env = makeEnv();
    expect(generateInternals.resolveModelEndpoint('qwen3-coder:30b', env)).toBe('coder-endpoint-id');
  });

  it('returns null for unknown model id', () => {
    const env = makeEnv();
    expect(generateInternals.resolveModelEndpoint('gpt-4o', env)).toBeNull();
    expect(generateInternals.resolveModelEndpoint('', env)).toBeNull();
  });

  it('returns null when gemma4 secret is unset', () => {
    // exactOptionalPropertyTypes forbids passing `undefined` as an override —
    // simulate an unset secret by deleting the field after construction.
    const env = makeEnv();
    delete (env as { RUNPOD_TEXT_ENDPOINT_ID?: string }).RUNPOD_TEXT_ENDPOINT_ID;
    expect(generateInternals.resolveModelEndpoint('gemma4:e4b', env)).toBeNull();
  });

  it('returns null when qwen3-coder secret is unset (partial rollback state)', () => {
    const env = makeEnv();
    delete (env as { RUNPOD_CODER_ENDPOINT_ID?: string }).RUNPOD_CODER_ENDPOINT_ID;
    expect(generateInternals.resolveModelEndpoint('qwen3-coder:30b', env)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleGenerate — routing integration (fetch stub captures URL)
// ---------------------------------------------------------------------------

describe('handleGenerate — routing by model field', () => {
  beforeEach(() => {
    // Capture upstream URL — asserted in each test
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(makeUpstreamCompletion(), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes gemma4:e4b to RUNPOD_TEXT_ENDPOINT_ID upstream URL', async () => {
    const env = makeEnv();
    const req = chatRequest({
      model: 'gemma4:e4b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(200);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    const upstreamUrl = fetchMock.mock.calls[0]![0] as string;
    expect(upstreamUrl).toContain('text-endpoint-id');
    expect(upstreamUrl).not.toContain('coder-endpoint-id');
  });

  it('routes qwen3-coder:30b to RUNPOD_CODER_ENDPOINT_ID upstream URL', async () => {
    const env = makeEnv();
    const req = chatRequest({
      model: 'qwen3-coder:30b',
      messages: [{ role: 'user', content: 'write a fibonacci function' }],
      max_tokens: 100,
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(200);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    const upstreamUrl = fetchMock.mock.calls[0]![0] as string;
    expect(upstreamUrl).toContain('coder-endpoint-id');
    expect(upstreamUrl).not.toContain('text-endpoint-id');
  });

  it('defaults to gemma4:e4b (text endpoint) when model is omitted', async () => {
    const env = makeEnv();
    const req = chatRequest({
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(200);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const upstreamUrl = fetchMock.mock.calls[0]![0] as string;
    expect(upstreamUrl).toContain('text-endpoint-id');
  });

  it('returns model_not_found for unknown model id (SUPPORTED_MODELS gate)', async () => {
    const env = makeEnv();
    const req = chatRequest({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: { code: string; type: string } };
    expect(body.error.code).toBe('model_not_found');
    expect(body.error.type).toBe('invalid_request_error');
    // fetch should NOT have been called — request failed before upstream
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns model_not_found when qwen3-coder secret unset (partial rollback)', async () => {
    const env = makeEnv();
    delete (env as { RUNPOD_CODER_ENDPOINT_ID?: string }).RUNPOD_CODER_ENDPOINT_ID;
    const req = chatRequest({
      model: 'qwen3-coder:30b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('model_not_found');
    // gemma4 requests in the same worker should keep working
    const gemmaReq = chatRequest({
      model: 'gemma4:e4b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const gemmaResp = await worker.fetch(gemmaReq, env, makeCtx());
    expect(gemmaResp.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// /v1/models catalog — includes both models
// ---------------------------------------------------------------------------

describe('/v1/models catalog', () => {
  it('lists both gemma4:e4b and qwen3-coder:30b', async () => {
    const env = makeEnv();
    const req = new Request('https://worker.test/v1/models', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-gateway-key' },
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { object: string; data: Array<{ id: string; owned_by: string }> };
    expect(body.object).toBe('list');
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain('gemma4:e4b');
    expect(ids).toContain('qwen3-coder:30b');
  });

  it('GET /v1/models/qwen3-coder:30b returns single model', async () => {
    const env = makeEnv();
    // URL-encode the ':' in the model id
    const req = new Request('https://worker.test/v1/models/qwen3-coder:30b', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-gateway-key' },
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string; object: string; owned_by: string };
    expect(body.id).toBe('qwen3-coder:30b');
    expect(body.object).toBe('model');
    expect(body.owned_by).toBe('servegate');
  });

  it('GET /v1/models/nonexistent returns 404 model_not_found', async () => {
    const env = makeEnv();
    const req = new Request('https://worker.test/v1/models/nonexistent', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-gateway-key' },
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('model_not_found');
  });
});

// ---------------------------------------------------------------------------
// SUPPORTED_MODELS invariant — canary for adding/removing models
// ---------------------------------------------------------------------------

describe('SUPPORTED_MODELS invariant', () => {
  it('exposes exactly the models advertised in /v1/models catalog', () => {
    // Both symbols exported from generateInternals; if these drift, /v1/models and
    // /v1/chat/completions disagree on what a client can request.
    expect(generateInternals.SUPPORTED_MODELS).toEqual(['gemma4:e4b', 'qwen3-coder:30b']);
  });
});
