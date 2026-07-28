/**
 * Story 7.1 — Multi-model routing tests (incl. Ollama translation layer)
 *
 * Covers:
 *   - resolveModelUpstream unit (5 cases: gemma4, qwen3-coder, unknown, secrets missing)
 *   - Serverless (openai) path: gemma4:e4b hits RunPod OpenAI-compat + Bearer auth
 *   - Ollama (translated) path: qwen3-coder:30b hits POD /api/chat (not /v1/*)
 *   - Ollama translation: `tool_calls[]` extracted to OpenAI shape with `type: "function"` + stringified args
 *   - Ollama translation: request `max_tokens` becomes `options.num_predict`
 *   - SSE wrap for streaming clients (fake-stream single-chunk + [DONE])
 *   - JSON return for non-streaming clients
 *   - Model not found for unknown models (SUPPORTED_MODELS gate)
 *   - Model not found when qwen3-coder secret is unset (partial-rollback state)
 *   - /v1/models catalog contains both gemma4:e4b and qwen3-coder:30b
 *   - Last-request timestamp tracker for POD idle-shutdown
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateInternals } from '../src/generate.js';
import { translateOllamaToOpenAI } from '../src/runpod-text.js';
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

const CODER_POD_URL = 'https://test-pod-id-11434.proxy.runpod.net/v1/chat/completions';
const EXPECTED_OLLAMA_URL = 'https://test-pod-id-11434.proxy.runpod.net/api/chat';

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
    waitUntil: vi.fn((p: Promise<unknown>) => { void p; }),
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

function makeOpenAIUpstreamCompletion(): unknown {
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

function makeOllamaUpstreamCompletion(withToolCall = false): unknown {
  const msg: {
    role: string;
    content: string;
    tool_calls?: Array<{ id?: string; function: { name: string; arguments: unknown } }>;
  } = {
    role: 'assistant',
    content: withToolCall ? '' : 'ok',
  };
  if (withToolCall) {
    msg.tool_calls = [
      { id: 'call_ollama_1', function: { name: 'list_directory', arguments: { path: '/tmp' } } },
    ];
  }
  return {
    model: 'qwen3-coder:30b',
    created_at: '2026-07-27T20:00:00Z',
    message: msg,
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 15,
    eval_count: 8,
  };
}

/**
 * Story 7.1.4 — Wraps a single Ollama completion into an NDJSON stream Response
 * so tests match the new production path (Ollama /api/chat with stream:true
 * emits one JSON object per line, terminated by a `done:true` chunk).
 */
function makeOllamaNDJSONResponse(completion: unknown): Response {
  const encoder = new TextEncoder();
  const line = JSON.stringify(completion) + '\n';
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

// ---------------------------------------------------------------------------
// resolveModelUpstream — unit
// ---------------------------------------------------------------------------

describe('resolveModelUpstream', () => {
  it('resolves gemma4:e4b to Serverless URL with Bearer auth + apiFormat=openai', () => {
    const env = makeEnv();
    const t = generateInternals.resolveModelUpstream('gemma4:e4b', env);
    expect(t).not.toBeNull();
    expect(t!.url).toContain('api.runpod.ai');
    expect(t!.url).toContain('text-endpoint-id');
    expect(t!.url).toContain('/openai/v1/chat/completions');
    expect(t!.requiresRunpodAuth).toBe(true);
    expect(t!.apiFormat).toBe('openai');
  });

  it('resolves qwen3-coder:30b to POD URL with anonymous auth + apiFormat=ollama', () => {
    const env = makeEnv();
    const t = generateInternals.resolveModelUpstream('qwen3-coder:30b', env);
    expect(t).not.toBeNull();
    expect(t!.url).toBe(CODER_POD_URL);
    expect(t!.requiresRunpodAuth).toBe(false);
    expect(t!.apiFormat).toBe('ollama');
  });

  it('returns null for unknown model id', () => {
    const env = makeEnv();
    expect(generateInternals.resolveModelUpstream('gpt-4o', env)).toBeNull();
    expect(generateInternals.resolveModelUpstream('', env)).toBeNull();
  });

  it('returns null when gemma4 secret is unset', () => {
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
// translateOllamaToOpenAI — unit
// ---------------------------------------------------------------------------

describe('translateOllamaToOpenAI', () => {
  it('translates plain content response with finish_reason=stop', () => {
    const ollama = makeOllamaUpstreamCompletion(false) as Parameters<typeof translateOllamaToOpenAI>[0];
    const oa = translateOllamaToOpenAI(ollama, 'qwen3-coder:30b');
    expect(oa.object).toBe('chat.completion');
    expect(oa.model).toBe('qwen3-coder:30b');
    expect(oa.choices[0]!.message.content).toBe('ok');
    expect(oa.choices[0]!.message.tool_calls).toBeUndefined();
    expect(oa.choices[0]!.finish_reason).toBe('stop');
    expect(oa.usage).toEqual({ prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 });
  });

  it('translates tool_calls response with type=function + stringified args + finish_reason=tool_calls', () => {
    const ollama = makeOllamaUpstreamCompletion(true) as Parameters<typeof translateOllamaToOpenAI>[0];
    const oa = translateOllamaToOpenAI(ollama, 'qwen3-coder:30b');
    expect(oa.choices[0]!.message.content).toBeNull();
    expect(oa.choices[0]!.message.tool_calls).toHaveLength(1);
    const tc = oa.choices[0]!.message.tool_calls![0]!;
    expect(tc.id).toBe('call_ollama_1');
    expect(tc.type).toBe('function');
    expect(tc.function.name).toBe('list_directory');
    // Arguments must be a JSON string per OpenAI spec, even when Ollama gave us an object.
    expect(tc.function.arguments).toBe(JSON.stringify({ path: '/tmp' }));
    expect(oa.choices[0]!.finish_reason).toBe('tool_calls');
  });

  it('preserves string-form arguments when Ollama emits them as string (no double-encoding)', () => {
    const ollama = {
      model: 'qwen3-coder:30b',
      created_at: '2026-07-27T20:00:00Z',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'fn', arguments: '{"x":1}' } }],
      },
      done: true,
      done_reason: 'stop',
    };
    const oa = translateOllamaToOpenAI(
      ollama as unknown as Parameters<typeof translateOllamaToOpenAI>[0],
      'qwen3-coder:30b',
    );
    expect(oa.choices[0]!.message.tool_calls![0]!.function.arguments).toBe('{"x":1}');
  });

  it('assigns a synthetic id to tool_calls that lack one', () => {
    const ollama = {
      model: 'qwen3-coder:30b',
      created_at: '2026-07-27T20:00:00Z',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'fn', arguments: {} } }],
      },
      done: true,
    };
    const oa = translateOllamaToOpenAI(
      ollama as unknown as Parameters<typeof translateOllamaToOpenAI>[0],
      'qwen3-coder:30b',
    );
    const id = oa.choices[0]!.message.tool_calls![0]!.id;
    expect(id).toMatch(/^call_/);
    expect(id.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// handleGenerate — routing integration
// ---------------------------------------------------------------------------

describe('handleGenerate — routing by model field', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gemma4:e4b hits Serverless URL with Bearer auth (openai apiFormat)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(makeOpenAIUpstreamCompletion(), { status: 200 })),
    );
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
    expect((upstreamInit.headers as Record<string, string>).Authorization).toBe('Bearer test-runpod-key');
  });

  it('qwen3-coder:30b hits POD /api/chat (NOT /v1/chat/completions) without Bearer auth (ollama apiFormat)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeOllamaNDJSONResponse(makeOllamaUpstreamCompletion(false))),
    );
    const env = makeEnv();
    const req = chatRequest({
      model: 'qwen3-coder:30b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(200);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const upstreamUrl = fetchMock.mock.calls[0]![0] as string;
    const upstreamInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(upstreamUrl).toBe(EXPECTED_OLLAMA_URL);
    expect((upstreamInit.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('Ollama route converts OpenAI max_tokens to options.num_predict in the upstream request body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeOllamaNDJSONResponse(makeOllamaUpstreamCompletion(false))),
    );
    const env = makeEnv();
    const req = chatRequest({
      model: 'qwen3-coder:30b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 42,
      temperature: 0.5,
      stream: false,
    });
    await worker.fetch(req, env, makeCtx());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const upstreamBody = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(upstreamBody.stream).toBe(true);
    expect(upstreamBody.options).toBeDefined();
    expect((upstreamBody.options as Record<string, unknown>).num_predict).toBe(42);
    expect((upstreamBody.options as Record<string, unknown>).temperature).toBe(0.5);
  });

  it('Ollama route: response arrives in OpenAI shape with tool_calls when Ollama emitted them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeOllamaNDJSONResponse(makeOllamaUpstreamCompletion(true))),
    );
    const env = makeEnv();
    const req = chatRequest({
      model: 'qwen3-coder:30b',
      messages: [{ role: 'user', content: 'list files' }],
      max_tokens: 200,
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      choices: Array<{
        message: { tool_calls?: Array<{ type: string; function: { name: string; arguments: string } }> };
        finish_reason: string;
      }>;
    };
    const tc = body.choices[0]!.message.tool_calls;
    expect(tc).toBeDefined();
    expect(tc![0]!.type).toBe('function');
    expect(tc![0]!.function.name).toBe('list_directory');
    expect(tc![0]!.function.arguments).toBe(JSON.stringify({ path: '/tmp' }));
    expect(body.choices[0]!.finish_reason).toBe('tool_calls');
  });

  it('Ollama route with client stream:true returns SSE with data: [DONE] terminator', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeOllamaNDJSONResponse(makeOllamaUpstreamCompletion(false))),
    );
    const env = makeEnv();
    const req = chatRequest({
      model: 'qwen3-coder:30b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      // stream defaults to true when omitted (client can also send explicit true)
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toContain('text/event-stream');
    const text = await resp.text();
    expect(text).toContain('data: [DONE]');
    // Content chunk shape check
    expect(text).toContain('"object":"chat.completion.chunk"');
  });

  it('defaults to gemma4:e4b (openai endpoint) when model is omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(makeOpenAIUpstreamCompletion(), { status: 200 })),
    );
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
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 200 })));
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
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns model_not_found when qwen3-coder POD URL unset (partial rollback)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(makeOpenAIUpstreamCompletion(), { status: 200 })),
    );
    const env = makeEnv();
    delete (env as { RUNPOD_CODER_POD_URL?: string }).RUNPOD_CODER_POD_URL;
    const qwenReq = chatRequest({
      model: 'qwen3-coder:30b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const qwenResp = await worker.fetch(qwenReq, env, makeCtx());
    expect(qwenResp.status).toBe(404);
    // gemma4 keeps working in the same worker
    const gemmaReq = chatRequest({
      model: 'gemma4:e4b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const gemmaResp = await worker.fetch(gemmaReq, env, makeCtx());
    expect(gemmaResp.status).toBe(200);
  });

  it('writes last-request timestamp to RATE_LIMIT_KV on qwen3-coder request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeOllamaNDJSONResponse(makeOllamaUpstreamCompletion(false))),
    );
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
    expect(Math.abs(Date.now() - Number(ts))).toBeLessThan(5000);
  });

  it('does NOT write last-request timestamp on gemma4:e4b requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(makeOpenAIUpstreamCompletion(), { status: 200 })),
    );
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
// Rate-limit bypass for qwen3-coder (POD flat-rate — token budget doesn't apply)
// ---------------------------------------------------------------------------

describe('rate-limit — qwen3-coder bypass', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('qwen3-coder request passes even when today token bucket is over the daily limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeOllamaNDJSONResponse(makeOllamaUpstreamCompletion(false))),
    );
    // Prime KV with today's counter well above the 50k daily budget
    const today = new Date().toISOString().slice(0, 10);
    const kv = makeKv({ [`tokens:${today}`]: '999999' });
    const env = makeEnv({ RATE_LIMIT_KV: kv });
    const req = chatRequest({
      model: 'qwen3-coder:30b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 8192, // VS Code default — under normal rules this reserves ~8.5k
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    // NO 429 — bypass in effect
    expect(resp.status).toBe(200);
  });

  it('gemma4:e4b request STILL respects the 50k daily token budget (regression check)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(makeOpenAIUpstreamCompletion(), { status: 200 })),
    );
    const today = new Date().toISOString().slice(0, 10);
    const kv = makeKv({ [`tokens:${today}`]: '999999' });
    const env = makeEnv({ RATE_LIMIT_KV: kv });
    const req = chatRequest({
      model: 'gemma4:e4b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
      stream: false,
    });
    const resp = await worker.fetch(req, env, makeCtx());
    expect(resp.status).toBe(429);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limit_exceeded');
  });

  it('qwen3-coder request does NOT increment the shared token counter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeOllamaNDJSONResponse(makeOllamaUpstreamCompletion(false))),
    );
    const kv = makeKv();
    const env = makeEnv({ RATE_LIMIT_KV: kv });
    const req = chatRequest({
      model: 'qwen3-coder:30b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
      stream: false,
    });
    await worker.fetch(req, env, makeCtx());
    // Bypass covers both check AND record — token counter stays absent
    const today = new Date().toISOString().slice(0, 10);
    const store = (kv as unknown as { store: Map<string, string> }).store;
    expect(store.has(`tokens:${today}`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /v1/models catalog
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
// SUPPORTED_MODELS invariant
// ---------------------------------------------------------------------------

describe('SUPPORTED_MODELS invariant', () => {
  it('exposes exactly the models advertised in /v1/models catalog', () => {
    expect(generateInternals.SUPPORTED_MODELS).toEqual(['gemma4:e4b', 'qwen3-coder:30b']);
  });
});
