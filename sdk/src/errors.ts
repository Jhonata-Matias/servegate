/**
 * Typed error hierarchy for @gemma4/flux-client.
 * All errors extend Error and are designed to work with `instanceof` in both CJS and ESM bundles.
 */

export class ColdStartError extends Error {
  readonly duration_ms: number;
  readonly retry_count: number;
  readonly last_http_status?: number;

  constructor(args: { duration_ms: number; retry_count: number; last_http_status?: number; message?: string }) {
    super(args.message ?? `Cold start exceeded retry budget after ${args.retry_count} retries (${args.duration_ms}ms total)`);
    this.name = 'ColdStartError';
    this.duration_ms = args.duration_ms;
    this.retry_count = args.retry_count;
    if (args.last_http_status !== undefined) {
      this.last_http_status = args.last_http_status;
    }
    Object.setPrototypeOf(this, ColdStartError.prototype);
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
