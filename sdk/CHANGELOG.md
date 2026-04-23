# Changelog

All notable changes to `@jhonata-matias/flux-client` will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semver](https://semver.org/) with alpha caveats noted below.

## Alpha versioning policy (v0.x)

During alpha (v0.x), the following applies:

- **MINOR** bumps (v0.1 → v0.2) **may include breaking changes** (deviation from semver)
- **PATCH** bumps (v0.1.0 → v0.1.1) are backward-compatible within a minor
- Breaking changes in MINOR will be explicitly marked with **⚠️ BREAKING** in this CHANGELOG
- After v1.0.0 (beta/stable), strict semver applies

## [Unreleased]

### Planned for v0.2 (tech debt backlog per Epic 2 PRD v0.5 TD5-TD6)

- Add `MAX_STEPS` and `MAX_DIMENSION` constants to `validateGenerateInput` (upper bounds validation)
- Classify warmup errors as `AuthError`/`RateLimitError` (currently generic Error)
- Add 4 missing coverage tests (NetworkError direct, warmup timeout, linear backoff, safeReadJson failure)
- Add `@vitest/coverage-v8` devDep

## [0.2.0] — 2026-04-23

### ⚠️ BREAKING

- Removed `ColdStartError`. Cold-start is no longer a terminal error; `generate()` now absorbs it via the async submit/poll flow.
- Added `TimeoutError` with `cause: 'poll_exhausted' | 'gateway_504' | 'runpod_timeout'`.

**Migration**

```ts
// v0.1.x
try {
  await client.generate(input);
} catch (e) {
  if (e instanceof ColdStartError) {
    // old handling
  }
}

// v0.2.0
try {
  await client.generate(input);
} catch (e) {
  if (e instanceof TimeoutError) {
    // new handling
  }
}
```

### Changed

- `generate(input)` preserves its public signature but now submits via `POST /jobs` and polls `GET /jobs/{id}` internally.
- Poll cadence now respects gateway `Retry-After` headers.
- Polling is bounded by `ClientOptions.warmTimeoutMs` (default `180000` ms).
- `warmup()` now submits a minimal async job to `/jobs` instead of calling the removed legacy `POST /`.

## [0.1.0] — 2026-04-21

### Added

- Initial SDK release, published to GitHub Packages (`@jhonata-matias/flux-client`)
- `FluxClient` class with `warmup()`, `generate(input)`, `isWarm()`, `getLastWarmTimestamp()`
- Strict input validation via `validateGenerateInput` — rejects non-integer steps/width/height, empty prompt, invalid types before network
- 5 typed error classes (all extend Error, `instanceof` works in CJS + ESM bundles):
  - `ColdStartError` — cold timeout exhausted retries
  - `RateLimitError` — HTTP 429 with `retry_after_seconds`, `reset_at`, optional `limit`
  - `AuthError` — HTTP 401
  - `ValidationError` — pre-network input validation with `field`, `reason`
  - `NetworkError` — wraps fetch failures (DNS, connection refused)
- Retry-with-backoff (default: max 3, exponential 1s→2s→4s)
- Cold-aware timeouts: 180s first attempt, 30s subsequent
- Configurable via `ClientOptions` (retry config, warmThresholdMs, custom fetchImpl for testing)
- Dual CJS + ESM build via tsup (10.4 KB CJS + 10.2 KB ESM + 3.9 KB types)
- Zero runtime dependencies (native `fetch` + `AbortController`)
- Node.js >= 18 required
- README with executable quickstart
- MIT license

### Security

- `RUNPOD_API_KEY` NEVER embedded in SDK — SDK only knows gateway URL + X-API-Key (verified via `grep -r "RUNPOD_API_KEY" sdk/src` → 0 matches)
- `apiKey` passed via constructor only, sent via `X-API-Key` header, never logged

### Known limitations (see v0.2 planned above)

- Warmup errors surface as generic `Error` — not classified as Auth/RateLimit
- `validateGenerateInput` validates `>0` but not upper bounds (e.g., `steps=1000` passes client validation, gets rejected by gateway/RunPod with 4xx)
- Linear backoff strategy untested (only exponential covered by current test suite)
- Coverage report tool (`@vitest/coverage-v8`) not installed — manual test analysis only

### Migration from pre-0.1.0

If you used the pre-alpha local SDK (`@gemma4/flux-client` scope):
- **Rename scope:** `@gemma4/flux-client` → `@jhonata-matias/flux-client` (required for GitHub Packages)
- **Update `.npmrc`:** `@jhonata-matias:registry=https://npm.pkg.github.com`
- No API breaking changes — imports and usage identical

---

**Repository:** https://github.com/Jhonata-Matias/servegate (renamed from `gemma4` on 2026-04-22)
**Issues:** https://github.com/Jhonata-Matias/servegate/issues
**License:** MIT
