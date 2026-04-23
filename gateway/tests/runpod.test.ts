/**
 * Unit tests for gateway/src/runpod.ts (Task 3.2).
 *
 * Covers:
 *   - submitJob parses /run response and returns runpod_request_id
 *   - getStatus parses /status response with all 6 status enum values
 *   - mapStatus correctly maps each RunPod enum to gateway enum
 *   - RunpodUpstreamError has correct .kind for each failure path
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RunpodUpstreamError,
  getStatus,
  mapStatus,
  submitJob,
} from '../src/runpod.js';
import type { Env, RunpodStatus } from '../src/types.js';

function makeEnv(): Env {
  return {
    RATE_LIMIT_KV: {} as KVNamespace,
    JOBS_KV: {} as KVNamespace,
    GATEWAY_API_KEY: 'gateway-test-key',
    RUNPOD_API_KEY: 'runpod-test-key',
    RUNPOD_ENDPOINT_ID: 'test-endpoint-id',
  };
}

function mockFetchOnce(
  body: unknown,
  init: { status?: number } = {},
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submitJob', () => {
  it('parses /run response and returns {id, status:"IN_QUEUE"}', async () => {
    mockFetchOnce({ id: 'rp-abc', status: 'IN_QUEUE' });
    const env = makeEnv();

    const result = await submitJob(env, { prompt: 'test', steps: 4 });

    expect(result.id).toBe('rp-abc');
    expect(result.status).toBe('IN_QUEUE');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v2/test-endpoint-id/run'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer runpod-test-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('wraps fetch body under { input: ... }', async () => {
    mockFetchOnce({ id: 'rp-1', status: 'IN_QUEUE' });
    const env = makeEnv();

    await submitJob(env, { prompt: 'forest' });

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const init = call?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ input: { prompt: 'forest' } });
  });

  it('throws RunpodUpstreamError(bad_shape) when response missing id/status', async () => {
    mockFetchOnce({ id: 'rp-1' }); // missing status
    const env = makeEnv();

    await expect(submitJob(env, {})).rejects.toBeInstanceOf(RunpodUpstreamError);
  });

  it('throws RunpodUpstreamError(http_5xx) for 500s', async () => {
    mockFetchOnce({ error: 'boom' }, { status: 503 });
    const env = makeEnv();

    await expect(submitJob(env, {})).rejects.toMatchObject({
      kind: 'http_5xx',
      upstreamStatus: 503,
    });
  });

  it('throws RunpodUpstreamError(http_4xx) for 401', async () => {
    mockFetchOnce({ error: 'unauthorized' }, { status: 401 });
    const env = makeEnv();

    await expect(submitJob(env, {})).rejects.toMatchObject({
      kind: 'http_4xx',
      upstreamStatus: 401,
    });
  });

  it('throws RunpodUpstreamError(network) when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('DNS fail');
      }),
    );
    const env = makeEnv();

    await expect(submitJob(env, {})).rejects.toMatchObject({
      kind: 'network',
    });
  });
});

describe('getStatus', () => {
  it('parses /status response with all 6 enum values', async () => {
    const env = makeEnv();
    const all: RunpodStatus[] = [
      'IN_QUEUE',
      'IN_PROGRESS',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'TIMED_OUT',
    ];
    for (const status of all) {
      mockFetchOnce({ id: 'rp-1', status });
      const result = await getStatus(env, 'rp-1');
      expect(result.status).toBe(status);
    }
  });

  it('surfaces output.image_b64 when COMPLETED (AD-1 inline verification)', async () => {
    mockFetchOnce({
      id: 'rp-1',
      status: 'COMPLETED',
      output: {
        image_b64: 'iVBORw0KGgo=',
        metadata: { seed: 42, elapsed_ms: 6800 },
      },
    });
    const env = makeEnv();

    const result = await getStatus(env, 'rp-1');

    expect(result.output?.image_b64).toBe('iVBORw0KGgo=');
    expect(result.output?.metadata?.seed).toBe(42);
  });

  it('calls correct URL with auth header', async () => {
    mockFetchOnce({ id: 'rp-xyz', status: 'IN_QUEUE' });
    const env = makeEnv();

    await getStatus(env, 'rp-xyz');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v2/test-endpoint-id/status/rp-xyz'),
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer runpod-test-key' },
      }),
    );
  });

  it('throws bad_shape when response lacks required fields', async () => {
    mockFetchOnce({ status: 'COMPLETED' }); // missing id
    const env = makeEnv();

    await expect(getStatus(env, 'rp-1')).rejects.toBeInstanceOf(RunpodUpstreamError);
  });
});

describe('mapStatus', () => {
  it('maps all 6 RunPod states to gateway enum correctly', () => {
    expect(mapStatus('IN_QUEUE')).toBe('queued');
    expect(mapStatus('IN_PROGRESS')).toBe('running');
    expect(mapStatus('COMPLETED')).toBe('completed');
    expect(mapStatus('FAILED')).toBe('failed');
    expect(mapStatus('CANCELLED')).toBe('cancelled');
    expect(mapStatus('TIMED_OUT')).toBe('timeout');
  });
});

describe('RunpodUpstreamError', () => {
  it('preserves kind and upstreamStatus for caller inspection', () => {
    const e = new RunpodUpstreamError('boom', 'http_5xx', 503);
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('http_5xx');
    expect(e.upstreamStatus).toBe(503);
    expect(e.name).toBe('RunpodUpstreamError');
  });
});
