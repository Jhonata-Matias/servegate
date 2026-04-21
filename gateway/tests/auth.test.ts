import { describe, it, expect } from 'vitest';
import { constantTimeEqual, validateAuth } from '../src/auth.js';

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

describe('validateAuth', () => {
  const SECRET = 'sekret123';

  function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request('https://gateway.example/', {
      method: 'POST',
      headers,
      body: '{}',
    });
  }

  it('returns null when X-API-Key header matches', () => {
    const req = makeRequest({ 'X-API-Key': SECRET });
    expect(validateAuth(req, SECRET)).toBeNull();
  });

  it('returns 401 when X-API-Key header missing', async () => {
    const req = makeRequest();
    const resp = validateAuth(req, SECRET);
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
    const body = (await resp!.json()) as { error: string; reason: string };
    expect(body.error).toBe('invalid_api_key');
    expect(body.reason).toBe('missing_header');
  });

  it('returns 401 when X-API-Key header wrong', async () => {
    const req = makeRequest({ 'X-API-Key': 'wrong-key' });
    const resp = validateAuth(req, SECRET);
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
    const body = (await resp!.json()) as { error: string; reason: string };
    expect(body.error).toBe('invalid_api_key');
    expect(body.reason).toBe('mismatch');
  });

  it('returns 401 when X-API-Key length differs', async () => {
    const req = makeRequest({ 'X-API-Key': 'short' });
    const resp = validateAuth(req, SECRET);
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
  });
});
