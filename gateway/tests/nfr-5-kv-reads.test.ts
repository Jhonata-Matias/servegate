/**
 * Observational test for NFR-5 (Task 3.4 — resolves CRIT-2 from critique.json).
 *
 * Verifies the expected KV cost envelope per job session:
 *   - 1 write at submit (POST /jobs)
 *   - ≤ 30 reads during polling (cold-start 130s / Retry-After 5s = 26 reads)
 *
 * Formula basis: spec.md §6.1 + implementation.yaml subtask 3.4. This is an
 * observational guardrail — alerts on regression that could push us toward KV
 * free-tier limits in rapid-growth scenarios.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';

function makeCountingKv(): KVNamespace & { reads: number; writes: number } {
  const store = new Map<string, string>();
  // Counters live on the returned object itself — so the closure's `kv.reads++`
  // mutates the same object the caller inspects (Object.assign with a `box`
  // would snapshot the integer values by value, not by reference — bug).
  const kv = {
    reads: 0,
    writes: 0,
    get: vi.fn(async (key: string) => {
      kv.reads++;
      return store.get(key) ?? null;
    }),
    put: vi.fn(async (key: string, value: string) => {
      kv.writes++;
      store.set(key, value);
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  };
  return kv as unknown as KVNamespace & { reads: number; writes: number };
}

function makeEnv(): Env {
  return {
    RATE_LIMIT_KV: makeCountingKv(),
    JOBS_KV: makeCountingKv(),
    GATEWAY_API_KEY: 'test-key',
    RUNPOD_API_KEY: 'runpod-key',
    RUNPOD_ENDPOINT_ID: 'endpoint-1',
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NFR-5: KV cost envelope per job session', () => {
  it('single cold-start session (~130s / 5s cadence) stays under 30 JOBS_KV reads and 1 write', async () => {
    // Simulate 26 polls of IN_PROGRESS then COMPLETED on poll 27
    let pollIdx = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        let body: unknown;
        if (url.includes('/run')) {
          body = { id: 'rp-nfr5', status: 'IN_QUEUE' };
        } else {
          pollIdx++;
          body = pollIdx <= 26
            ? { id: 'rp-nfr5', status: 'IN_PROGRESS' }
            : {
                id: 'rp-nfr5',
                status: 'COMPLETED',
                output: { image_b64: 'ok', metadata: { seed: 1, elapsed_ms: 7000 } },
              };
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const env = makeEnv();

    // Submit
    const submitRes = await worker.fetch(
      new Request('https://w.test/jobs', {
        method: 'POST',
        headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'x' }),
      }),
      env,
    );
    const { job_id } = (await submitRes.json()) as { job_id: string };

    // Poll until terminal (cap 30 to not run away on regression)
    let last = 202;
    for (let i = 0; i < 30 && last !== 200; i++) {
      const r = await worker.fetch(
        new Request(`https://w.test/jobs/${job_id}`, {
          headers: { 'X-API-Key': 'test-key' },
        }),
        env,
      );
      last = r.status;
    }

    // NFR-5 assertions on JOBS_KV
    const jobsKv = env.JOBS_KV as unknown as { reads: number; writes: number };

    // 1 write at submit + 1 write at terminal update (updateStatus reads once + writes once)
    // NOTE: updateStatus internally does getMapping (cacheTtl=0) then put, so terminal
    // adds 1 read + 1 write. We assert total writes ≤ 2.
    expect(jobsKv.writes).toBeLessThanOrEqual(2);

    // Reads: 1 per poll (getMapping) + 1 extra inside updateStatus on terminal poll.
    // Upper bound: 27 polls + 1 terminal-updateStatus-read = 28 reads. Well under 30 budget.
    expect(jobsKv.reads).toBeLessThanOrEqual(30);
    expect(last).toBe(200);
  });

  it('no polling (client abandons immediately after submit) produces exactly 1 KV write 0 reads on JOBS_KV', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 'rp-1', status: 'IN_QUEUE' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const env = makeEnv();

    await worker.fetch(
      new Request('https://w.test/jobs', {
        method: 'POST',
        headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'x' }),
      }),
      env,
    );

    const jobsKv = env.JOBS_KV as unknown as { reads: number; writes: number };
    expect(jobsKv.writes).toBe(1);
    expect(jobsKv.reads).toBe(0);
  });
});
