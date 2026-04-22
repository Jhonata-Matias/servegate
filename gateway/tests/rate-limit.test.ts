import { describe, it, expect, vi } from 'vitest';
import {
  buildRateLimitResponse,
  checkAndIncrement,
  dayKey,
  DAILY_LIMIT,
  nextUtcMidnightIso,
  secondsUntilNextUtcMidnight,
} from '../src/rate-limit.js';

describe('dayKey', () => {
  it('returns count:YYYY-MM-DD format in UTC', () => {
    const d = new Date('2026-04-21T15:30:00Z');
    expect(dayKey(d)).toBe('count:2026-04-21');
  });

  it('uses UTC date even when local timezone differs', () => {
    // 2026-04-21T23:30:00 UTC-3 = 2026-04-22T02:30:00 UTC → key uses UTC date
    const d = new Date('2026-04-22T02:30:00Z');
    expect(dayKey(d)).toBe('count:2026-04-22');
  });
});

describe('secondsUntilNextUtcMidnight', () => {
  it('computes seconds correctly mid-day', () => {
    const d = new Date('2026-04-21T12:00:00Z');
    expect(secondsUntilNextUtcMidnight(d)).toBe(12 * 3600);
  });

  it('returns ~86400 just after midnight', () => {
    const d = new Date('2026-04-21T00:00:01Z');
    const seconds = secondsUntilNextUtcMidnight(d);
    expect(seconds).toBeGreaterThanOrEqual(86399);
    expect(seconds).toBeLessThanOrEqual(86400);
  });

  it('returns small positive just before midnight', () => {
    const d = new Date('2026-04-21T23:59:30Z');
    expect(secondsUntilNextUtcMidnight(d)).toBe(30);
  });
});

describe('nextUtcMidnightIso', () => {
  it('returns ISO of next 00:00 UTC', () => {
    const d = new Date('2026-04-21T15:30:00Z');
    expect(nextUtcMidnightIso(d)).toBe('2026-04-22T00:00:00.000Z');
  });
});

// Mock KVNamespace for testability
function makeKvMock(initialValue: string | null = null): KVNamespace {
  let stored = initialValue;
  return {
    get: vi.fn(async () => stored),
    put: vi.fn(async (_key: string, value: string) => {
      stored = value;
    }),
    // Required by KVNamespace interface but unused in our code
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

describe('checkAndIncrement', () => {
  const NOW = new Date('2026-04-21T12:00:00Z');

  it('increments from 0 to 1 on first request', async () => {
    const kv = makeKvMock(null);
    const result = await checkAndIncrement(kv, NOW);
    expect(result.allowed).toBe(true);
    expect(result.state.count).toBe(1);
    expect(result.state.remaining).toBe(99);
    expect(kv.put).toHaveBeenCalledWith('count:2026-04-21', '1', { expirationTtl: 48 * 3600 });
  });

  it('increments from N to N+1 when under limit', async () => {
    const kv = makeKvMock('50');
    const result = await checkAndIncrement(kv, NOW);
    expect(result.allowed).toBe(true);
    expect(result.state.count).toBe(51);
    expect(result.state.remaining).toBe(49);
  });

  it('allows request 100 (last allowed)', async () => {
    const kv = makeKvMock('99');
    const result = await checkAndIncrement(kv, NOW);
    expect(result.allowed).toBe(true);
    expect(result.state.count).toBe(100);
    expect(result.state.remaining).toBe(0);
  });

  it('rejects request 101 (over limit, no increment)', async () => {
    const kv = makeKvMock('100');
    const result = await checkAndIncrement(kv, NOW);
    expect(result.allowed).toBe(false);
    expect(result.state.count).toBe(100);
    expect(result.state.remaining).toBe(0);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('rejects when count > limit (defensive — should not happen but allowed)', async () => {
    const kv = makeKvMock('150');
    const result = await checkAndIncrement(kv, NOW);
    expect(result.allowed).toBe(false);
    expect(result.state.count).toBe(150);
    expect(result.state.remaining).toBe(0);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('parses non-numeric KV value as 0', async () => {
    const kv = makeKvMock('garbage');
    const result = await checkAndIncrement(kv, NOW);
    expect(result.allowed).toBe(true);
    expect(result.state.count).toBe(1);
  });

  it('uses TTL of 48 hours on put', async () => {
    const kv = makeKvMock(null);
    await checkAndIncrement(kv, NOW);
    expect(kv.put).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      expirationTtl: 48 * 3600,
    });
  });
});

describe('buildRateLimitResponse', () => {
  it('returns 429 with Retry-After header + structured body', async () => {
    const state = {
      count: 100,
      remaining: 0,
      resetAt: '2026-04-22T00:00:00.000Z',
      secondsUntilReset: 12345,
    };
    const resp = buildRateLimitResponse(state);
    expect(resp.status).toBe(429);
    expect(resp.headers.get('Retry-After')).toBe('12345');
    expect(resp.headers.get('X-RateLimit-Limit')).toBe(String(DAILY_LIMIT));
    expect(resp.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(resp.headers.get('X-RateLimit-Reset')).toBe('2026-04-22T00:00:00.000Z');

    const body = (await resp.json()) as { error: string; limit: number; reset_at: string };
    expect(body.error).toBe('rate_limit_exceeded');
    expect(body.limit).toBe(DAILY_LIMIT);
    expect(body.reset_at).toBe('2026-04-22T00:00:00.000Z');
  });
});
