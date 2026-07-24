import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
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

function generateRequest(signal?: AbortSignal): Request {
  return new Request('https://worker.test/v1/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'test-gateway-key',
    },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
    ...(signal ? { signal } : {}),
  });
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
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

describe('SSE pass-through', () => {
  it('passes upstream SSE frames through unchanged enough for clients', async () => {
    const frames = Array.from({ length: 5 }, (_, i) =>
      `data: {"choices":[{"delta":{"content":"${i}"}}]}\n\n`,
    );
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(frames)));

    const res = await worker.fetch(generateRequest(), makeEnv(), makeCtx());
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect((text.match(/data:/g) ?? [])).toHaveLength(5);
    expect(text).toContain('"content":"4"');
  });

  it('threads client abort signal to upstream fetch', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(['data: {"ok":true}\n\n'])));
    const req = generateRequest(controller.signal);

    await worker.fetch(req, makeEnv(), makeCtx());

    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(req.signal);
  });

  it('tolerates partial frames and enriches them with id/created (Story 1.1 FR-3)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(['data: {"a"', ':1}\n\n'])));

    const res = await worker.fetch(generateRequest(), makeEnv(), makeCtx());
    const text = await res.text();

    // Story 1.1 FR-3: envelope normalization injects id, created, model into every frame.
    // The partial frame "data: {"a":1}" is parsed and enriched.
    expect(text).toContain('"a":1');
    expect(text).toContain('"id":"chatcmpl-');
    expect(text).toContain('"created":');
    expect(text).toContain('"model":"gemma4:e4b"');
  });

  it('closes gracefully when upstream omits [DONE] sentinel (with envelope enrichment)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(['data: {"done":false}\n\n'])));

    const res = await worker.fetch(generateRequest(), makeEnv(), makeCtx());

    // Story 1.1 FR-3: frame is enriched with id, created, model
    const text = await res.text();
    expect(text).toContain('"done":false');
    expect(text).toContain('"id":"chatcmpl-');
    expect(text).toContain('"created":');
  });
});
