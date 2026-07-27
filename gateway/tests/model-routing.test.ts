/**
 * Story 7.1 — Multi-model routing tests
 *
 * Covers:
 *   - resolveModelUpstream unit (5 cases: gemma4, qwen3-coder, unknown, secrets missing)
 *   - handleGenerate integration: URL contains correct endpoint per model + auth flavor
 *   - Model not found for unknown models (SUPPORTED_MODELS gate)
 *   - Model not found when qwen3-coder secret is unset (partial-rollback state)
 *   - /v1/models catalog contains both gemma4:e4b and qwen3-coder:30b
 *   - POD-mode auth: qwen3-coder requests do NOT include Bearer auth header
 *   - Serverless-mode auth: gemma4 requests DO include Bearer auth header
 *   - Last-request timestamp in RATE_LIMIT_KV for POD idle-shutdown tracker
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

const CODER_POD_URL = 'https://test-pod-id-11434.proxy.runpod.net/v1/chat/completions';

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
    RUNPOD_CODER_POD_ID: 'test-pod-id',
    RUNPOD_CODER_POD_URL: CODER_POD_URL,
    CORS_ALLOWED_ORIGIN: 'https://app.example',
    ...overrides,
  };
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn((p: Promise<unknown>) => {
      // Force-await queued microtasks so KV writes complete before assertions.
      void p;
    }),
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
// resolveModelUpstream — unit
// ---------------------------------------------------------------------------

describe('resolveModelUpstream', () => {
  it('resolves gemma4:e4b to Serverless URL with Bearer auth flag', () => {
    const env = makeEnv();
    const t = generateInternals.resolveModelUpstream('gemma4:e4b', env);
    expect(t).not.toBeNull();
    expect(t!.url).toContain('api.runpod.ai');
    expect(t!.url).toContain('text-endpoint-id');
    expect(t!.url).toContain('/openai/v1/chat/completions');
    expect(t!.requiresRunpodAuth).toBe(true);
  });

  it('resolves qwen3-coder:30b to POD URL with anonymous auth flag', () => {
    const env = makeEnv();
    const t = generateInternals.resolveModelUpstream('qwen3-coder:30b', env);
    expect(t).not.toBeNull();
    expect(t!.url).toBe(CODER_POD_URL);
    expect(t!.requiresRunpodAuth).toBe(false);
  });

  it('returns null for unknown model id', () => {
    const env = makeEnv();
    expect(generateInternals.resolveModelUpstream('gpt-4o', env)).toBeNull();
    expect(generateInternals.resolveModelUpstream('', env)).toBeNull();
  });

  it('returns null when gemma4 secret is unset', () => {
    // exactOptionalPropertyTypes forbids passing `undefined` as an override —
    // simulate an unset secret by deleting the field after construction.
    const env = makeEnv();
    delete (env as { RUNPOD_TEXT_ENDPOINT_ID?: string }).RUNPOD_TEXT_ENDPOINT_ID;
    expect(generateInternals.resolveModelUpstream('gemma4:e4b', env)).toBeNull();
  });

  it('returns null when qwen3-coder POD URL is unset (partial rollback state)', () => {
    const env = makeEnv();
    delete (env as { RUNPOD_CODER_POD_URL?: string }).RUNPOD_CODER_POD_URL;
    expect(generateInternals.resolveModelUpstream('qwen3-coder:30b', env)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleGenerate — routing integration (fetch stub captures URL + headers)
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

  it('routes gemma4:e4b to Serverless URL with Bearer auth', async () => {
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
    const upstreamInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(upstreamUrl).toContain('text-endpoint-id');
    expect(upstreamUrl).toContain('api.runpod.ai');
    const authHeader = (upstreamInit.headers as Record<string, string>).Authorization;
    expect(authHeader).toBe('Bearer test-runpod-key');
  });

  it('routes qwen3-coder:30b to POD URL WITHOUT Bearer auth', async () => {
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
    const upstreamInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(upstreamUrl).toBe(CODER_POD_URL);
    // POD proxy is anonymous — no Bearer header
    const authHeader = (upstreamInit.headers as Record<string, string>).Authorization;
    expect(authHeader).toBeUndefined();
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

  it('returns model_not_found when qwen3-coder POD URL unset (partial rollback)', async () => {
    const env = makeEnv();
    delete (env as { RUNPOD_CODER_POD_URL?: string }).RUNPOD_CODER_POD_URL;
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

  it('writes last-request timestamp to RATE_LIMIT_KV on qwen3-coder request (for POD idle-shutdown scheduler)', async () => {
    const env = makeEnv();
    const req = chatRequest({
      model: 'qwen3-coder:30b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(200);
    const kvStore = (env.RATE_LIMIT_KV as unknown as { store: Map<string, string> }).store;
    const ts = kvStore.get('coder:last_request_ms');
    expect(ts).toBeDefined();
    const parsed = Number(ts);
    expect(Number.isFinite(parsed)).toBe(true);
    // Timestamp should be recent (within last 5 seconds)
    expect(Math.abs(Date.now() - parsed)).toBeLessThan(5000);
  });

  it('does NOT write last-request timestamp on gemma4:e4b requests (only POD models tracked)', async () => {
    const env = makeEnv();
    const req = chatRequest({
      model: 'gemma4:e4b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(200);
    const kvStore = (env.RATE_LIMIT_KV as unknown as { store: Map<string, string> }).store;
    expect(kvStore.get('coder:last_request_ms')).toBeUndefined();
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
    expect(generateInternals.SUPPORTED_MODELS).toEqual(['gemma4:e4b', 'qwen3-coder:30b']);
  });
});
