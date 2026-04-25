import { describe, expect, it, vi } from 'vitest';
import {
  checkTokenBudgetAndReserve,
  readTokenBudget,
  recordTokenUsage,
  TOKEN_DAILY_LIMIT,
  tokenDayKey,
} from '../src/rate-limit.js';

function makeKv(initialValue: string | null = null): KVNamespace {
  let stored = initialValue;
  return {
    get: vi.fn(async () => stored),
    put: vi.fn(async (_key: string, value: string) => {
      stored = value;
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

describe('tokenDayKey', () => {
  it('uses tokens:YYYY-MM-DD in UTC', () => {
    expect(tokenDayKey(new Date('2026-04-24T23:59:00Z'))).toBe('tokens:2026-04-24');
  });
});

describe('checkTokenBudgetAndReserve', () => {
  const now = new Date('2026-04-24T12:00:00Z');

  it('allows when estimate fits under budget', async () => {
    const kv = makeKv('1000');
    const result = await checkTokenBudgetAndReserve(kv, 2000, now);

    expect(result.allowed).toBe(true);
    expect(result.state.used).toBe(1000);
    expect(result.state.remaining).toBe(TOKEN_DAILY_LIMIT - 1000);
  });

  it('allows exact budget boundary', async () => {
    const kv = makeKv(String(TOKEN_DAILY_LIMIT - 500));
    const result = await checkTokenBudgetAndReserve(kv, 500, now);

    expect(result.allowed).toBe(true);
  });

  it('rejects when estimate exceeds budget', async () => {
    const kv = makeKv(String(TOKEN_DAILY_LIMIT - 499));
    const result = await checkTokenBudgetAndReserve(kv, 500, now);

    expect(result.allowed).toBe(false);
    expect(result.state.remaining).toBe(499);
    expect(kv.put).not.toHaveBeenCalled();
  });
});

describe('recordTokenUsage / readTokenBudget', () => {
  const now = new Date('2026-04-24T12:00:00Z');

  it('records post-flight usage with 48h TTL', async () => {
    const kv = makeKv('100');
    const state = await recordTokenUsage(kv, 42, now);

    expect(state.used).toBe(142);
    expect(kv.put).toHaveBeenCalledWith('tokens:2026-04-24', '142', {
      expirationTtl: 48 * 3600,
    });
  });

  it('reads current token budget without mutating', async () => {
    const kv = makeKv('1234');
    const state = await readTokenBudget(kv, now);

    expect(state.used).toBe(1234);
    expect(state.remaining).toBe(TOKEN_DAILY_LIMIT - 1234);
    expect(kv.put).not.toHaveBeenCalled();
  });
});
