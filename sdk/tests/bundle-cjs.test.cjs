// Bundle smoke test — verify `instanceof` works in CJS bundle output.
// Run via: node tests/bundle-cjs.test.cjs
const assert = require('node:assert');
const { TimeoutError, RateLimitError, AuthError, ValidationError, NetworkError, FluxClient } = require('../dist/index.cjs');

const timeout = new TimeoutError({ elapsed_ms: 1000, cause: 'poll_exhausted' });
assert.ok(timeout instanceof Error, 'TimeoutError instanceof Error');
assert.ok(timeout instanceof TimeoutError, 'TimeoutError instanceof TimeoutError');
assert.strictEqual(timeout.elapsed_ms, 1000);

const rl = new RateLimitError({ retry_after_seconds: 60, reset_at: '2026-01-01' });
assert.ok(rl instanceof Error);
assert.ok(rl instanceof RateLimitError);
assert.ok(!(rl instanceof TimeoutError), 'RateLimitError NOT instanceof TimeoutError');

const auth = new AuthError();
assert.ok(auth instanceof AuthError);
assert.strictEqual(auth.http_status, 401);

const val = new ValidationError({ field: 'steps', reason: 'must be > 0' });
assert.ok(val instanceof ValidationError);
assert.strictEqual(val.field, 'steps');

const net = new NetworkError({ cause: new Error('ECONNREFUSED') });
assert.ok(net instanceof NetworkError);
assert.strictEqual(net.cause.message, 'ECONNREFUSED');

const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
assert.ok(client instanceof FluxClient);
assert.strictEqual(client.isWarm(), false);
assert.strictEqual(client.getLastWarmTimestamp(), null);

console.log('✅ CJS bundle smoke test passed');
