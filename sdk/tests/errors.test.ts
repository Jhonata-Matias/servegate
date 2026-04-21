import { describe, it, expect } from 'vitest';
import {
  AuthError,
  ColdStartError,
  NetworkError,
  RateLimitError,
  ValidationError,
} from '../src/errors.js';

describe('error classes', () => {
  it('ColdStartError instanceof Error and ColdStartError', () => {
    const e = new ColdStartError({ duration_ms: 180000, retry_count: 3, last_http_status: 504 });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ColdStartError);
    expect(e.name).toBe('ColdStartError');
    expect(e.duration_ms).toBe(180000);
    expect(e.retry_count).toBe(3);
    expect(e.last_http_status).toBe(504);
    expect(e.message).toContain('180000ms');
  });

  it('ColdStartError works without optional last_http_status', () => {
    const e = new ColdStartError({ duration_ms: 100000, retry_count: 2 });
    expect(e.last_http_status).toBeUndefined();
  });

  it('RateLimitError exposes retry_after_seconds and reset_at', () => {
    const e = new RateLimitError({
      retry_after_seconds: 3600,
      reset_at: '2026-04-22T00:00:00Z',
      limit: 100,
    });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(RateLimitError);
    expect(e.name).toBe('RateLimitError');
    expect(e.retry_after_seconds).toBe(3600);
    expect(e.reset_at).toBe('2026-04-22T00:00:00Z');
    expect(e.limit).toBe(100);
  });

  it('AuthError defaults to http_status 401', () => {
    const e = new AuthError();
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AuthError);
    expect(e.name).toBe('AuthError');
    expect(e.http_status).toBe(401);
  });

  it('ValidationError exposes field and reason', () => {
    const e = new ValidationError({ field: 'steps', reason: 'must be > 0' });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.name).toBe('ValidationError');
    expect(e.field).toBe('steps');
    expect(e.reason).toBe('must be > 0');
    expect(e.message).toContain('steps');
  });

  it('NetworkError wraps cause', () => {
    const cause = new Error('ECONNREFUSED');
    const e = new NetworkError({ cause });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(NetworkError);
    expect(e.name).toBe('NetworkError');
    expect(e.cause).toBe(cause);
    expect(e.message).toContain('ECONNREFUSED');
  });

  it('errors are NOT instanceof each other', () => {
    const cold = new ColdStartError({ duration_ms: 1, retry_count: 1 });
    const auth = new AuthError();
    expect(cold).not.toBeInstanceOf(AuthError);
    expect(auth).not.toBeInstanceOf(ColdStartError);
    expect(auth).not.toBeInstanceOf(RateLimitError);
  });
});
