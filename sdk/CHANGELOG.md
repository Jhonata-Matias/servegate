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

## [0.4.0] — 2026-04-29

### Added

- Added optional `EditInput.image2?: EditImageInput` for multi-image i2i. When provided, the request payload includes `input_image_b64_2` so the gateway/handler can route to the `TextEncodeQwenImageEditPlus` workflow with two reference images.
- Added optional dimension fields on `GenerateMetadata` for the second image: `input_width_2`, `input_height_2`, `source_width_2`, `source_height_2`, `input_downsampled_2`.

### Changed

- Refactored edit input validation: `image` and `image2` share the same rules (PNG/JPEG/WebP magic bytes, ≤ 8 MB decoded, non-square, ≤ 1 MP with optional `autoDownsample`). Errors raised for the second image surface with `field: 'image2'` for clear diagnostics.

### Backwards compatibility

- 100% backwards compatible. Existing `edit({prompt, image})` calls continue to use `TextEncodeQwenImageEdit` (single-image path) with no payload changes.

### Operator notes (server-side)

- This SDK release pairs with a serverless handler upgrade to `qwen_image_edit_2509_fp8_e4m3fn.safetensors` and a ComfyUI revision exposing `TextEncodeQwenImageEditPlus`. The SDK is forward-compatible: 1-image calls work against any deployment of the gateway/handler at v0.3.x or later; 2-image calls require the 2509 weights + Plus node to be deployed.

## [0.3.0] — 2026-04-24

### Added

- Added `FluxClient.edit(input: EditInput): Promise<GenerateOutput>` for image-to-image edits through the existing async submit/poll gateway contract.
- Added exported `EditInput` and `EditImageInput` types.
- Added client-side validation for edit images: PNG/JPEG/WebP magic bytes, decoded payload <= 8 MB, non-square aspect ratio, <= 1 MP input, `strength` range `(0.0, 1.0]`, and `steps` range `4-50`.
- Added opt-in `autoDownsample: true` support for Node.js consumers that install optional `sharp`; without opt-in, images above 1 MP throw `ValidationError`.
- Added pt-BR SDK README with `edit()` usage and troubleshooting.

### Changed

- Package version bumped to `0.3.0`; this release is strictly additive for existing `generate()` consumers.
- `GenerateMetadata` now includes optional i2i dimension fields when the server returns them.

### License

- SDK license remains MIT.
- README documents upstream Qwen-Image-Edit Apache 2.0 provenance and the Lightning LoRA verification requirement before deployment.

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
