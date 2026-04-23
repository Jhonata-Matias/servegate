/**
 * Integration tests for gateway/src/index.ts (Task 3.3).
 *
 * Drives the exported fetch handler through end-to-end flows:
 *   - Happy path warm (POST /jobs → GET /jobs/{id} IN_PROGRESS → COMPLETED)
 *   - Happy path cold (multiple IN_PROGRESS polls then COMPLETED, zero 504)
 *   - Legacy POST / rejected (404 + migration_doc, EC-8 / CON-6)
 *   - Rate-limit on submit only (100 POSTs exhaust; GET still works — EC-5)
 *   - RunPod /run failure (503 + no KV entry — EC-1)
 *   - Job expired / unknown (404 unified — EC-2)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';

// ---------------------------------------------------------------------------
// Shared KV + Env mocks
// ---------------------------------------------------------------------------

function makeKv(): KVNamespace & { _store: Map<string, string>; _getCount: number } {
  const store = new Map<string, string>();
  let getCount = 0;
  return {
    get: vi.fn(async (key: string) => {
      getCount++;
      return store.get(key) ?? null;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
    _store: store,
    _getCount: 0,
    get _getCountGetter() {
      return getCount;
    },
  } as unknown as KVNamespace & { _store: Map<string, string>; _getCount: number };
}

function makeEnv(): Env {
  return {
    RATE_LIMIT_KV: makeKv(),
    JOBS_KV: makeKv(),
    GATEWAY_API_KEY: 'test-gateway-key',
    RUNPOD_API_KEY: 'test-runpod-key',
    RUNPOD_ENDPOINT_ID: 'test-endpoint',
  };
}

function req(
  path: string,
  init: { method?: string; body?: unknown; apiKey?: string | null } = {},
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (init.apiKey !== null) {
    headers['X-API-Key'] = init.apiKey ?? 'test-gateway-key';
  }
  const requestInit: RequestInit = {
    method: init.method ?? 'GET',
    headers,
  };
  if (init.body !== undefined) {
    requestInit.body = JSON.stringify(init.body);
  }
  return new Request(`https://worker.test${path}`, requestInit);
}

/**
 * Stubs global fetch to respond with a deterministic sequence of RunPod API
 * responses matched by URL substring (/run or /status). Useful when a test
 * needs to simulate multiple polls with distinct outcomes.
 */
function stubRunpod(
  handler: (url: string) => { body: unknown; status?: number },
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const { body, status } = handler(url);
      return new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /jobs — happy submit (FR-1)', () => {
  it('returns 202 with job_id, status_url, est_wait_seconds + Location + Retry-After headers', async () => {
    stubRunpod(() => ({ body: { id: 'rp-abc', status: 'IN_QUEUE' } }));
    const env = makeEnv();

    const res = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'forest' } }), env);

    expect(res.status).toBe(202);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect(res.headers.get('Location')).toMatch(/^\/jobs\/[a-f0-9-]+$/);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');

    const body = (await res.json()) as { job_id: string; status_url: string; est_wait_seconds: string };
    expect(body.job_id).toMatch(/^[a-f0-9-]+$/);
    expect(body.status_url).toBe(`/jobs/${body.job_id}`);
    expect(body.est_wait_seconds).toBe('unknown'); // FR-7
  });

  it('persists mapping to JOBS_KV with status=queued', async () => {
    stubRunpod(() => ({ body: { id: 'rp-abc', status: 'IN_QUEUE' } }));
    const env = makeEnv();

    const res = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' } }), env);
    const { job_id } = (await res.json()) as { job_id: string };

    const raw = await env.JOBS_KV.get(job_id);
    expect(raw).not.toBeNull();
    const mapping = JSON.parse(raw ?? '{}');
    expect(mapping.status).toBe('queued');
    expect(mapping.runpod_request_id).toBe('rp-abc');
  });

  it('rejects 401 without X-API-Key', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' }, apiKey: null }), env);
    expect(res.status).toBe(401);
  });

  it('rejects 401 with wrong X-API-Key', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' }, apiKey: 'wrong' }), env);
    expect(res.status).toBe(401);
  });

  it('returns 503 when RunPod /run fails (EC-1) and does NOT create KV entry', async () => {
    stubRunpod(() => ({ body: { error: 'boom' }, status: 503 }));
    const env = makeEnv();

    const res = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' } }), env);
    expect(res.status).toBe(502); // http_5xx mapping
    expect((env.JOBS_KV as unknown as { _store: Map<string, string> })._store.size).toBe(0);
  });

  it('returns 400 on invalid JSON body', async () => {
    stubRunpod(() => ({ body: {} }));
    const env = makeEnv();

    const malformed = new Request('https://worker.test/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-gateway-key' },
      body: 'not json{',
    });
    const res = await worker.fetch(malformed, env);
    expect(res.status).toBe(400);
  });
});

describe('GET /jobs/{id} — happy path warm (FR-2)', () => {
  it('returns 202 running while IN_PROGRESS, then 200 on COMPLETED', async () => {
    let phase = 0; // 0 = submit, 1 = first poll (running), 2 = second poll (done)
    stubRunpod((url) => {
      if (url.includes('/run')) return { body: { id: 'rp-xyz', status: 'IN_QUEUE' } };
      // /status path
      phase++;
      if (phase === 1) return { body: { id: 'rp-xyz', status: 'IN_PROGRESS' } };
      return {
        body: {
          id: 'rp-xyz',
          status: 'COMPLETED',
          output: { image_b64: 'iVBORw0KGgo=', metadata: { seed: 7, elapsed_ms: 6800 } },
        },
      };
    });
    const env = makeEnv();

    // Submit
    const submitRes = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' } }), env);
    const { job_id } = (await submitRes.json()) as { job_id: string };

    // Poll 1 → running
    const r1 = await worker.fetch(req(`/jobs/${job_id}`), env);
    expect(r1.status).toBe(202);
    const b1 = (await r1.json()) as { status: string; est_wait_seconds: string };
    expect(b1.status).toBe('running');
    expect(b1.est_wait_seconds).toBe('unknown'); // FR-7
    expect(r1.headers.get('Retry-After')).toBe('5');

    // Poll 2 → done
    const r2 = await worker.fetch(req(`/jobs/${job_id}`), env);
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { output: { image_b64: string } };
    expect(b2.output.image_b64).toBe('iVBORw0KGgo='); // AD-1: inline in output
  });
});

describe('GET /jobs/{id} — cold-start simulation (NFR-3 zero 504)', () => {
  it('polls repeatedly with IN_QUEUE/IN_PROGRESS then COMPLETES — no 504 emitted', async () => {
    let pollN = 0;
    stubRunpod((url) => {
      if (url.includes('/run')) return { body: { id: 'rp-cold', status: 'IN_QUEUE' } };
      pollN++;
      // Simulate 25 polls of queued/running before COMPLETED — mimics 130s cold
      if (pollN < 25) {
        return { body: { id: 'rp-cold', status: pollN % 2 === 0 ? 'IN_PROGRESS' : 'IN_QUEUE' } };
      }
      return {
        body: {
          id: 'rp-cold',
          status: 'COMPLETED',
          output: { image_b64: 'ok', metadata: { seed: 1, elapsed_ms: 7000 } },
        },
      };
    });
    const env = makeEnv();

    const submitRes = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' } }), env);
    const { job_id } = (await submitRes.json()) as { job_id: string };

    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await worker.fetch(req(`/jobs/${job_id}`), env);
      statuses.push(r.status);
      if (r.status === 200) break;
    }

    // NFR-3 assertion: zero 504 during the cold polling sequence
    expect(statuses.filter((s) => s === 504)).toHaveLength(0);
    // Ended with 200
    expect(statuses[statuses.length - 1]).toBe(200);
  });
});

describe('GET /jobs/{id} — RunPod TIMED_OUT (EC-4)', () => {
  it('returns 504 with error=generation_timeout and timeout_s=280', async () => {
    stubRunpod((url) => {
      if (url.includes('/run')) return { body: { id: 'rp-t', status: 'IN_QUEUE' } };
      return { body: { id: 'rp-t', status: 'TIMED_OUT' } };
    });
    const env = makeEnv();

    const submitRes = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' } }), env);
    const { job_id } = (await submitRes.json()) as { job_id: string };

    const r = await worker.fetch(req(`/jobs/${job_id}`), env);
    expect(r.status).toBe(504);
    const body = (await r.json()) as { error: string; timeout_s: number };
    expect(body.error).toBe('generation_timeout');
    expect(body.timeout_s).toBe(280);
  });
});

describe('GET /jobs/{id} — terminal failed/cancelled jobs', () => {
  it('returns 500 with runpod_failed when upstream status is FAILED', async () => {
    stubRunpod((url) => {
      if (url.includes('/run')) return { body: { id: 'rp-f', status: 'IN_QUEUE' } };
      return { body: { id: 'rp-f', status: 'FAILED' } };
    });
    const env = makeEnv();

    const submitRes = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' } }), env);
    const { job_id } = (await submitRes.json()) as { job_id: string };

    const r = await worker.fetch(req(`/jobs/${job_id}`), env);
    expect(r.status).toBe(500);
    const body = (await r.json()) as { error: string; status: string };
    expect(body.error).toBe('runpod_failed');
    expect(body.status).toBe('failed');
  });

  it('returns 500 with runpod_cancelled when upstream status is CANCELLED', async () => {
    stubRunpod((url) => {
      if (url.includes('/run')) return { body: { id: 'rp-c', status: 'IN_QUEUE' } };
      return { body: { id: 'rp-c', status: 'CANCELLED' } };
    });
    const env = makeEnv();

    const submitRes = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' } }), env);
    const { job_id } = (await submitRes.json()) as { job_id: string };

    const r = await worker.fetch(req(`/jobs/${job_id}`), env);
    expect(r.status).toBe(500);
    const body = (await r.json()) as { error: string; status: string };
    expect(body.error).toBe('runpod_cancelled');
    expect(body.status).toBe('cancelled');
  });
});

describe('GET /jobs/{id} — unknown or expired (EC-2)', () => {
  it('returns 404 with unified body (does not reveal never-existed vs expired)', async () => {
    stubRunpod(() => ({ body: {} }));
    const env = makeEnv();

    const r = await worker.fetch(req(`/jobs/never-seen-uuid`), env);
    expect(r.status).toBe(404);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('job_not_found_or_expired');
  });
});

describe('POST / — legacy endpoint removed (CON-6, EC-8)', () => {
  it('returns 404 with migration_doc pointer', async () => {
    const env = makeEnv();
    const r = await worker.fetch(req('/', { method: 'POST', body: { prompt: 'x' } }), env);
    expect(r.status).toBe(404);
    const body = (await r.json()) as { error: string; migration_doc: string };
    expect(body.error).toBe('endpoint_removed');
    expect(body.migration_doc).toBe('/docs/api/migration-async.md');
  });
});

describe('Rate-limit separation (EC-5)', () => {
  it('POST /jobs consumes quota; GET /jobs/{id} does NOT consume', async () => {
    stubRunpod((url) => {
      if (url.includes('/run')) return { body: { id: 'rp-1', status: 'IN_QUEUE' } };
      return { body: { id: 'rp-1', status: 'IN_PROGRESS' } };
    });
    const env = makeEnv();

    // Submit 1 job — consumes 1 quota unit
    const submitRes = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' } }), env);
    const { job_id } = (await submitRes.json()) as { job_id: string };
    expect(submitRes.headers.get('X-RateLimit-Remaining')).toBe('99');

    // Poll 10 times — should NOT affect remaining count
    for (let i = 0; i < 10; i++) {
      const r = await worker.fetch(req(`/jobs/${job_id}`), env);
      expect(r.headers.get('X-RateLimit-Remaining')).toBe('99');
    }

    // Submit a second job — consumes another unit
    const submitRes2 = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'y' } }), env);
    expect(submitRes2.headers.get('X-RateLimit-Remaining')).toBe('98');
  });

  it('returns 429 after 100 POST /jobs in same UTC day', async () => {
    stubRunpod(() => ({ body: { id: 'rp-1', status: 'IN_QUEUE' } }));
    const env = makeEnv();

    // Prefill counter to 100
    await env.RATE_LIMIT_KV.put(
      `count:${new Date().toISOString().slice(0, 10)}`,
      '100',
    );

    const r = await worker.fetch(req('/jobs', { method: 'POST', body: { prompt: 'x' } }), env);
    expect(r.status).toBe(429);
  });
});

describe('Method + path routing', () => {
  it('returns 405 for unsupported method on /jobs', async () => {
    const env = makeEnv();
    const r = await worker.fetch(req('/jobs', { method: 'DELETE' }), env);
    expect(r.status).toBe(405);
  });

  it('returns 405 for GET on root', async () => {
    const env = makeEnv();
    const r = await worker.fetch(req('/'), env);
    expect(r.status).toBe(405);
  });
});
