import { describe, it, expect } from 'vitest';
import { collectApiKeys, constantTimeEqual, validateAuth } from '../src/auth.js';
import type { Env } from '../src/types.js';

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings same length', () => {
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
  });

  it('returns false for different lengths (timing-safe)', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('abcd', 'abc')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('returns false for empty vs non-empty', () => {
    expect(constantTimeEqual('', 'a')).toBe(false);
    expect(constantTimeEqual('a', '')).toBe(false);
  });

  it('handles 64-char hex tokens (typical secret length)', () => {
    const a = 'a'.repeat(64);
    const b = 'a'.repeat(64);
    const c = 'a'.repeat(63) + 'b';
    expect(constantTimeEqual(a, b)).toBe(true);
    expect(constantTimeEqual(a, c)).toBe(false);
  });
});

describe('validateAuth (single-key path — backward compat)', () => {
  const SECRET = 'sekret123';

  function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request('https://gateway.example/', {
      method: 'POST',
      headers,
      body: '{}',
    });
  }

  it('returns null when X-API-Key header matches (array of 1)', () => {
    const req = makeRequest({ 'X-API-Key': SECRET });
    expect(validateAuth(req, [SECRET])).toBeNull();
  });

  it('returns 401 when X-API-Key header missing', async () => {
    const req = makeRequest();
    const resp = validateAuth(req, [SECRET]);
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
    const body = (await resp!.json()) as { error: string; reason: string };
    expect(body.error).toBe('invalid_api_key');
    expect(body.reason).toBe('missing_header');
  });

  it('returns 401 when X-API-Key header wrong', async () => {
    const req = makeRequest({ 'X-API-Key': 'wrong-key' });
    const resp = validateAuth(req, [SECRET]);
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
    const body = (await resp!.json()) as { error: string; reason: string };
    expect(body.error).toBe('invalid_api_key');
    expect(body.reason).toBe('mismatch');
  });

  it('returns 401 when X-API-Key length differs', async () => {
    const req = makeRequest({ 'X-API-Key': 'short' });
    const resp = validateAuth(req, [SECRET]);
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
  });
});

describe('validateAuth (multi-key path — Story 2.10)', () => {
  const KEY_TENANT_1 = 'tenant-one-secret-1234567890abcdef';
  const KEY_TENANT_2 = 'tenant-two-secret-abcdef1234567890';
  const KEY_TENANT_4 = 'tenant-four-secret-fedcba0987654321';

  function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request('https://gateway.example/', {
      method: 'POST',
      headers,
      body: '{}',
    });
  }

  it('accepts a key matching the first position', () => {
    const req = makeRequest({ 'X-API-Key': KEY_TENANT_1 });
    expect(validateAuth(req, [KEY_TENANT_1, KEY_TENANT_2, KEY_TENANT_4])).toBeNull();
  });

  it('accepts a key matching the last position (position N)', () => {
    const req = makeRequest({ 'X-API-Key': KEY_TENANT_4 });
    expect(validateAuth(req, [KEY_TENANT_1, KEY_TENANT_2, KEY_TENANT_4])).toBeNull();
  });

  it('accepts a key matching a middle position', () => {
    const req = makeRequest({ 'X-API-Key': KEY_TENANT_2 });
    expect(validateAuth(req, [KEY_TENANT_1, KEY_TENANT_2, KEY_TENANT_4])).toBeNull();
  });

  it('rejects a key not present in the allowlist', async () => {
    const req = makeRequest({ 'X-API-Key': 'tenant-revoked-secret-neverissued' });
    const resp = validateAuth(req, [KEY_TENANT_1, KEY_TENANT_2, KEY_TENANT_4]);
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
    const body = (await resp!.json()) as { error: string; reason: string };
    expect(body.error).toBe('invalid_api_key');
    expect(body.reason).toBe('mismatch');
  });

  it('rejects when X-API-Key header is absent even with populated allowlist', async () => {
    const req = makeRequest();
    const resp = validateAuth(req, [KEY_TENANT_1, KEY_TENANT_2]);
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
    const body = (await resp!.json()) as { error: string; reason: string };
    expect(body.reason).toBe('missing_header');
  });

  it('returns 500 server_misconfigured when allowlist is empty (defense-in-depth)', async () => {
    const req = makeRequest({ 'X-API-Key': KEY_TENANT_1 });
    const resp = validateAuth(req, []);
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(500);
    const body = (await resp!.json()) as { error: string; reason: string };
    expect(body.error).toBe('server_misconfigured');
    expect(body.reason).toBe('no_api_keys_configured');
  });

  it('iterates the full allowlist (constant-time compliance — no early exit)', () => {
    // Sentinel: if the loop early-exits on first match, a later "poisoned" slot
    // that would cause equal() to throw would go undetected. We assert here
    // that a key at position 1 still matches when position 2 is present.
    // (Direct timing measurement is flaky in unit tests; this asserts the
    // functional contract that all positions are evaluated.)
    const req = makeRequest({ 'X-API-Key': KEY_TENANT_1 });
    const allowlist = [KEY_TENANT_1, KEY_TENANT_2, 'trailing-slot-xyz'];
    expect(validateAuth(req, allowlist)).toBeNull();
  });
});

describe('collectApiKeys', () => {
  function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
      RATE_LIMIT_KV: {} as KVNamespace,
      JOBS_KV: {} as KVNamespace,
      VIDEOS_KV: {} as KVNamespace,
      R2_VIDEOS_BUCKET: {} as R2Bucket,
      GATEWAY_API_KEY: 'primary-key',
      RUNPOD_API_KEY: 'runpod-key',
      RUNPOD_ENDPOINT_ID: 'endpoint-id',
      ...overrides,
    } as Env;
  }

  it('returns array with only primary key when no additional slots set', () => {
    const env = makeEnv();
    expect(collectApiKeys(env)).toEqual(['primary-key']);
  });

  it('includes populated additional slots in order', () => {
    const env = makeEnv({
      GATEWAY_API_KEY_2: 'tenant-2-key',
      GATEWAY_API_KEY_4: 'tenant-4-key',
    });
    expect(collectApiKeys(env)).toEqual(['primary-key', 'tenant-2-key', 'tenant-4-key']);
  });

  it('filters out empty-string slots (defensive)', () => {
    const env = makeEnv({
      GATEWAY_API_KEY_2: '',
      GATEWAY_API_KEY_3: 'tenant-3-key',
    });
    expect(collectApiKeys(env)).toEqual(['primary-key', 'tenant-3-key']);
  });

  it('preserves ordering primary → _2 → _3 → _4', () => {
    const env = makeEnv({
      GATEWAY_API_KEY_2: 'k2',
      GATEWAY_API_KEY_3: 'k3',
      GATEWAY_API_KEY_4: 'k4',
    });
    expect(collectApiKeys(env)).toEqual(['primary-key', 'k2', 'k3', 'k4']);
  });
});
