// Bundle smoke test — verify `instanceof` works in ESM bundle output.
// Run via: node tests/bundle-esm.test.mjs
import assert from 'node:assert';
import { ColdStartError, RateLimitError, AuthError, ValidationError, NetworkError, FluxClient } from '../dist/index.js';

const cold = new ColdStartError({ duration_ms: 1000, retry_count: 1 });
assert.ok(cold instanceof Error, 'ColdStartError instanceof Error');
assert.ok(cold instanceof ColdStartError, 'ColdStartError instanceof ColdStartError');
assert.strictEqual(cold.duration_ms, 1000);

const rl = new RateLimitError({ retry_after_seconds: 60, reset_at: '2026-01-01' });
assert.ok(rl instanceof RateLimitError);
assert.ok(!(rl instanceof ColdStartError));

const auth = new AuthError();
assert.ok(auth instanceof AuthError);
assert.strictEqual(auth.http_status, 401);

const val = new ValidationError({ field: 'steps', reason: 'must be > 0' });
assert.ok(val instanceof ValidationError);

const net = new NetworkError({ cause: new Error('ECONNREFUSED') });
assert.ok(net instanceof NetworkError);

const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
assert.ok(client instanceof FluxClient);
assert.strictEqual(client.isWarm(), false);

console.log('✅ ESM bundle smoke test passed');
