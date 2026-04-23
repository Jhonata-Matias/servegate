/**
 * Unit tests for gateway/src/storage.ts (Task 3.1).
 *
 * Covers FR-3 KV mapping lifecycle:
 *   - putMapping uses submit TTL (6h) by default
 *   - getMapping returns null for missing keys and malformed JSON
 *   - updateStatus transitions apply correct TTL (30min for terminal, preserved otherwise)
 *   - cacheTtl parameter propagates to KV read call (ASM-1 mitigation)
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_READ_CACHE_TTL_SEC,
  getMapping,
  putMapping,
  TTL_AFTER_COMPLETION_SEC,
  TTL_ON_SUBMIT_SEC,
  updateStatus,
} from '../src/storage.js';
import type { JobMapping } from '../src/types.js';

function makeKvMock(initialValue: string | null = null): KVNamespace {
  let stored: string | null = initialValue;
  return {
    get: vi.fn(async (_key: string, _options?: { cacheTtl?: number }) => stored),
    put: vi.fn(async (_key: string, value: string, _options?: { expirationTtl?: number }) => {
      stored = value;
    }),
    delete: vi.fn(async () => {
      stored = null;
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

function makeMapping(overrides: Partial<JobMapping> = {}): JobMapping {
  return {
    job_id: 'abcdef01-2345-6789-abcd-ef0123456789',
    runpod_request_id: 'runpod-req-xyz',
    status: 'queued',
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

describe('putMapping', () => {
  it('serializes JSON and uses submit TTL by default', async () => {
    const kv = makeKvMock();
    const mapping = makeMapping();

    await putMapping(kv, mapping);

    expect(kv.put).toHaveBeenCalledWith(
      mapping.job_id,
      JSON.stringify(mapping),
      { expirationTtl: TTL_ON_SUBMIT_SEC },
    );
  });

  it('respects custom expirationTtl override', async () => {
    const kv = makeKvMock();
    const mapping = makeMapping();

    await putMapping(kv, mapping, { expirationTtl: 60 });

    expect(kv.put).toHaveBeenCalledWith(
      mapping.job_id,
      expect.any(String),
      { expirationTtl: 60 },
    );
  });
});

describe('getMapping', () => {
  it('returns null for missing key', async () => {
    const kv = makeKvMock(null);
    const result = await getMapping(kv, 'missing-id');
    expect(result).toBeNull();
  });

  it('returns parsed JobMapping when present', async () => {
    const mapping = makeMapping({ status: 'running' });
    const kv = makeKvMock(JSON.stringify(mapping));

    const result = await getMapping(kv, mapping.job_id);

    expect(result).toEqual(mapping);
  });

  it('returns null for malformed JSON (corrupted entry)', async () => {
    const kv = makeKvMock('not-json{');
    const result = await getMapping(kv, 'bad-id');
    expect(result).toBeNull();
  });

  it('passes default cacheTtl=30 to KV read (KV API minimum)', async () => {
    const kv = makeKvMock(JSON.stringify(makeMapping()));
    await getMapping(kv, 'id');
    expect(kv.get).toHaveBeenCalledWith('id', { cacheTtl: DEFAULT_READ_CACHE_TTL_SEC });
  });

  it('respects cacheTtl:0 as KV get without cacheTtl option (strong read)', async () => {
    const kv = makeKvMock(JSON.stringify(makeMapping()));
    await getMapping(kv, 'id', { cacheTtl: 0 });
    expect(kv.get).toHaveBeenCalledWith('id');
  });
});

describe('updateStatus', () => {
  it('returns null if mapping does not exist (race/expired)', async () => {
    const kv = makeKvMock(null);
    const result = await updateStatus(kv, 'missing', 'completed');
    expect(result).toBeNull();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('writes terminal status with 30min TTL and completed_at timestamp', async () => {
    const original = makeMapping({ status: 'running' });
    const kv = makeKvMock(JSON.stringify(original));

    const before = Date.now();
    const result = await updateStatus(kv, original.job_id, 'completed');
    const after = Date.now();

    expect(result?.status).toBe('completed');
    expect(result?.completed_at).toBeGreaterThanOrEqual(before);
    expect(result?.completed_at).toBeLessThanOrEqual(after);

    expect(kv.put).toHaveBeenCalledWith(
      original.job_id,
      expect.any(String),
      { expirationTtl: TTL_AFTER_COMPLETION_SEC },
    );
  });

  it('writes non-terminal status (running) preserving approximate remaining TTL', async () => {
    // created_at in the recent past — updateStatus should keep a substantial TTL
    const original = makeMapping({
      status: 'queued',
      created_at: Date.now() - 60 * 1000, // 60s ago
    });
    const kv = makeKvMock(JSON.stringify(original));

    await updateStatus(kv, original.job_id, 'running');

    const putCall = (kv.put as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === original.job_id && c[2] != null,
    );
    expect(putCall).toBeDefined();
    const ttl = (putCall?.[2] as { expirationTtl: number }).expirationTtl;

    // Should be roughly (6h - 60s) → about 21540s. Just assert it's > 5min floor
    // and <= original budget.
    expect(ttl).toBeGreaterThan(5 * 60);
    expect(ttl).toBeLessThanOrEqual(TTL_ON_SUBMIT_SEC);
  });

  it('persists error_code when provided on terminal update', async () => {
    const original = makeMapping({ status: 'running' });
    const kv = makeKvMock(JSON.stringify(original));

    const result = await updateStatus(kv, original.job_id, 'failed', {
      error_code: 'runpod_failed',
    });

    expect(result?.status).toBe('failed');
    expect(result?.error_code).toBe('runpod_failed');
  });

  it('handles all 6 terminal/non-terminal JobStatus values', async () => {
    const states: Array<'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'> = [
      'queued',
      'running',
      'completed',
      'failed',
      'cancelled',
      'timeout',
    ];
    for (const status of states) {
      const original = makeMapping();
      const kv = makeKvMock(JSON.stringify(original));
      const result = await updateStatus(kv, original.job_id, status);
      expect(result?.status).toBe(status);
    }
  });
});
