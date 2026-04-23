/**
 * Typed error hierarchy for @jhonata-matias/flux-client.
 * All errors extend Error and are designed to work with `instanceof` in both CJS and ESM bundles.
 */

export type TimeoutCause = 'poll_exhausted' | 'gateway_504' | 'runpod_timeout';

export class TimeoutError extends Error {
  readonly elapsed_ms: number;
  override readonly cause: TimeoutCause;

  constructor(args: { elapsed_ms: number; cause: TimeoutCause; message?: string }) {
    super(args.message ?? `Generation timed out after ${args.elapsed_ms}ms (${args.cause})`);
    this.name = 'TimeoutError';
    this.elapsed_ms = args.elapsed_ms;
    this.cause = args.cause;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

export class RateLimitError extends Error {
  readonly retry_after_seconds: number;
  readonly reset_at: string;
  readonly limit?: number;

  constructor(args: { retry_after_seconds: number; reset_at: string; limit?: number; message?: string }) {
    super(args.message ?? `Rate limit exceeded. Retry after ${args.retry_after_seconds}s (resets at ${args.reset_at})`);
    this.name = 'RateLimitError';
    this.retry_after_seconds = args.retry_after_seconds;
    this.reset_at = args.reset_at;
    if (args.limit !== undefined) {
      this.limit = args.limit;
    }
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class AuthError extends Error {
  readonly http_status: number;

  constructor(args: { http_status?: number; message?: string } = {}) {
    super(args.message ?? 'Authentication failed (invalid or missing API key)');
    this.name = 'AuthError';
    this.http_status = args.http_status ?? 401;
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

export class ValidationError extends Error {
  readonly field: string;
  readonly reason: string;

  constructor(args: { field: string; reason: string; message?: string }) {
    super(args.message ?? `Validation failed for field "${args.field}": ${args.reason}`);
    this.name = 'ValidationError';
    this.field = args.field;
    this.reason = args.reason;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NetworkError extends Error {
  override readonly cause: Error;

  constructor(args: { cause: Error; message?: string }) {
    super(args.message ?? `Network error: ${args.cause.message}`);
    this.name = 'NetworkError';
    this.cause = args.cause;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}
