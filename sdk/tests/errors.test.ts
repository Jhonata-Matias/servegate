import { describe, it, expect } from 'vitest';
import {
  AuthError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from '../src/errors.js';

describe('error classes', () => {
  it('TimeoutError instanceof Error and TimeoutError', () => {
    const e = new TimeoutError({ elapsed_ms: 180000, cause: 'poll_exhausted' });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(TimeoutError);
    expect(e.name).toBe('TimeoutError');
    expect(e.elapsed_ms).toBe(180000);
    expect(e.cause).toBe('poll_exhausted');
    expect(e.message).toContain('180000ms');
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
    const timeout = new TimeoutError({ elapsed_ms: 1, cause: 'gateway_504' });
    const auth = new AuthError();
    expect(timeout).not.toBeInstanceOf(AuthError);
    expect(auth).not.toBeInstanceOf(TimeoutError);
    expect(auth).not.toBeInstanceOf(RateLimitError);
  });
});
