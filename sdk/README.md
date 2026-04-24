# `@jhonata-matias/flux-client`

[![alpha](https://img.shields.io/badge/status-alpha-orange)](../docs/legal/TERMS.md) [![license MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

TypeScript SDK para o gateway de geração de imagens FLUX do projeto **servegate** (ex-gemma4). Encapsula chamadas ao gateway autenticado (Story 2.5), trata cold-start realista (~130s, ADR-0001 Path A) via `warmup()` + polling assíncrono transparente, e expõe error classes tipadas para UX flows diferenciados.

## v0.3.0 — Image editing (2026-04-24)

`v0.3.0` adds `client.edit()` for image-to-image edits through the same async submit/poll gateway contract. This is strictly additive: `generate()`, `GenerateInput`, `GenerateOutput`, and typed errors remain compatible with `v0.2.x`.

## ⚠️ v0.2.0 — Breaking change (2026-04-23)

`v0.2.0` migra o SDK para o contrato **async submit/poll** do gateway (`POST /jobs` + `GET /jobs/{id}`). Consumers do `v0.1.x` precisam atualizar — o gateway não responde mais no endpoint legado `POST /`.

**Principais mudanças:**

- `generate()` mantém a mesma assinatura pública, mas internamente submete e polla até completar (`Retry-After` respeitado)
- `ColdStartError` foi **removido** — cold-start deixou de ser um erro terminal
- `TimeoutError` novo expõe `cause: 'poll_exhausted' | 'gateway_504' | 'runpod_timeout'` e `elapsedMs?`

Guia completo de migração: [`docs/api/migration-async.md`](../docs/api/migration-async.md). Raw HTTP contract: [`docs/api/reference.md`](../docs/api/reference.md).

## ⚠️ ALPHA STATUS

This SDK is in **alpha** (v0.x). Breaking changes expected. Do not use in production without understanding:

- **No SLA:** single-endpoint, single-owner personal project
- **Breaking changes:** minor version bumps may introduce API changes (follow `CHANGELOG.md`)
- **Limited support:** best-effort via GitHub issues
- **Rate limits:** 100 images/day global across all users during alpha
- **Terms required:** see [Terms of Use](../docs/legal/TERMS.md) and [Privacy Statement](../docs/legal/PRIVACY.md)

For onboarding (API key request), see [dev-onboarding.md](../docs/usage/dev-onboarding.md).

> **Note:** Scope `@jhonata-matias` matches GitHub Packages owner do repo `Jhonata-Matias/servegate` (renamed from `gemma4` on 2026-04-22; old URLs auto-redirect via GitHub).

## Install

Configure `.npmrc` no projeto consumer para autenticar com GitHub Packages:

```
@jhonata-matias:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Onde `GITHUB_TOKEN` é um Personal Access Token com scope `read:packages`.

```bash
npm install @jhonata-matias/flux-client
```

**Requisitos:** Node.js >= 18 (usa native `fetch` + `AbortController`).

## Quickstart

```typescript
import { FluxClient, TimeoutError, RateLimitError, AuthError } from '@jhonata-matias/flux-client';

const client = new FluxClient({
  apiKey: process.env.GATEWAY_API_KEY!,
  gatewayUrl: 'https://gemma4-gateway.jhonata-matias.workers.dev',
});

// Pre-warm on app init (background) — evita primeira request pagar 130s
await client.warmup();

try {
  const result = await client.generate({
    prompt: 'a cat on a sofa, photorealistic',
    steps: 4,
    width: 1024,
    height: 1024,
  });
  console.log('image_b64 length:', result.output.image_b64.length);
  console.log('elapsed_ms:', result.output.metadata.elapsed_ms);
} catch (e) {
  if (e instanceof TimeoutError) {
    console.error(`Generation timed out (cause: ${e.cause}${e.elapsedMs ? `, after ${e.elapsedMs}ms` : ''})`);
  } else if (e instanceof RateLimitError) {
    console.error(`Rate limit. Retry in ${e.retry_after_seconds}s (resets at ${e.reset_at})`);
  } else if (e instanceof AuthError) {
    console.error('Auth failed — check GATEWAY_API_KEY');
  } else {
    throw e;
  }
}
```

## API Reference

### `new FluxClient({ apiKey, gatewayUrl, options? })`

| Param | Type | Description |
|---|---|---|
| `apiKey` | `string` | Gateway API key (sent via `X-API-Key` header) |
| `gatewayUrl` | `string` | Base URL do gateway (Story 2.5 Cloudflare Worker) |
| `options.retry` | `Partial<RetryConfig>` | Override retry config (defaults below) |
| `options.warmThresholdMs` | `number` | TTL do estado "warm" para `isWarm()` (default 30000) |
| `options.fetchImpl` | `typeof fetch` | Override fetch (testing) |

### Methods

#### `warmup(options?: { timeout?: number }): Promise<WarmupResult>`

Dispara request mínima para pre-aquecer worker. Retorna `{ duration_ms, was_cold }`. Default timeout 180s.

#### `generate(input: GenerateInput): Promise<GenerateOutput>`

Gera imagem. Valida input strict (rejeita `steps=0`, `width=0`, etc. com `ValidationError` antes de network). Retry-with-backoff em 5xx/timeout/network; throw imediato em 401/429.

#### `edit(input: EditInput): Promise<GenerateOutput>`

Edita uma imagem existente usando Qwen-Image-Edit. Reusa o mesmo submit/poll de `generate()`; o SDK envia `input_image_b64` para acionar a branch i2i no handler.

```typescript
import { FluxClient, ValidationError } from '@jhonata-matias/flux-client';
import { readFileSync, writeFileSync } from 'node:fs';

const client = new FluxClient({ apiKey: process.env.GATEWAY_API_KEY!, gatewayUrl: process.env.GATEWAY_URL! });

try {
  const result = await client.edit({
    prompt: 'make the jacket green while keeping the background unchanged',
    image: readFileSync('input.png'),
    strength: 0.85,
    steps: 8,
    seed: 42,
  });
  writeFileSync('edited.png', Buffer.from(result.output.image_b64, 'base64'));
  console.log(result.output.metadata.output_width, result.output.metadata.output_height);
} catch (e) {
  if (e instanceof ValidationError) console.error(e.field, e.reason);
  else throw e;
}
```

`EditInput.image` accepts `Buffer`, `Uint8Array`, `Blob`, or raw base64 string. Client-side validation rejects:

- exact `1:1` images, because Qwen-Image-Edit has a documented square-input coherence issue
- decoded payloads over `8 MB`
- images over `1 MP`, unless `autoDownsample: true` is passed in Node.js with optional `sharp` installed
- unsupported magic bytes; only PNG, JPEG, and WebP are accepted
- `strength` outside `(0.0, 1.0]` or `steps` outside `4-50`

Troubleshooting guidance:

- If the output looks zoomed or shifted, the handler still resizes the final PNG to the effective input dimensions and reports both Qwen-generated and output dimensions in metadata.
- If backgrounds change unexpectedly, make the prompt explicit: "keep the background unchanged".
- If you need HEIC/HEIF from mobile uploads, convert to PNG/JPEG/WebP before calling `edit()`.

#### `isWarm(): boolean`

Pure state check (zero network) — `true` se warmup ou generate sucedeu nos últimos `warmThresholdMs`.

#### `getLastWarmTimestamp(): number | null`

Timestamp do último success (warmup ou generate); `null` se nunca aqueceu.

### Default `RetryConfig`

```typescript
{
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffStrategy: 'exponential',  // delays: 1s → 2s → 4s
  coldTimeoutMs: 180_000,           // first attempt
  warmTimeoutMs: 30_000,            // subsequent attempts
}
```

### Error Hierarchy

| Class | Quando | Propriedades |
|---|---|---|
| `TimeoutError` | Poll budget esgotado, gateway 504, ou RunPod `TIMED_OUT` | `cause: 'poll_exhausted' \| 'gateway_504' \| 'runpod_timeout'`, `elapsedMs?` |
| `RateLimitError` | HTTP 429 (sem retry automático) | `retry_after_seconds`, `reset_at`, `limit?` |
| `AuthError` | HTTP 401 (sem retry) | `http_status` |
| `ValidationError` | Input inválido (pre-network) | `field`, `reason` |
| `NetworkError` | Falha de fetch (DNS, connection refused) | `cause: Error` |

Todas testáveis via `instanceof` em CJS e ESM bundles.

## Custom retry config

```typescript
const client = new FluxClient({
  apiKey: '...',
  gatewayUrl: '...',
  options: {
    retry: {
      maxRetries: 5,
      initialDelayMs: 500,
      backoffStrategy: 'linear',
      coldTimeoutMs: 240_000,
    },
  },
});
```

## Development

```bash
npm install
npm run typecheck    # tsc --noEmit
npm run test         # vitest
npm run build        # tsup → dist/ (CJS + ESM + d.ts)
npm run pack:dry     # validate tarball contents
```

## References

- [API Reference](../docs/api/reference.md) — raw HTTP contract
- [Developer Onboarding](../docs/usage/dev-onboarding.md) — access request + first call
- [ADR-0003](../docs/architecture/adr-0003-image-to-image-model-selection.md) — Qwen-Image-Edit model selection
- Epic 2 PRD: `docs/prd/epic-2-consumer-integration.md`
- ADR-0001 (Path A cold-start strategy): `docs/architecture/adr-0001-flux-cold-start.md`
- Gateway (Story 2.5): `docs/stories/2.5.gateway-rate-limit-cloudflare.story.md`
- This SDK story: `docs/stories/2.2.typescript-sdk-flux-client.story.md`

## Model License Provenance

The SDK remains MIT licensed. Image editing inference is powered by self-hosted Qwen-Image-Edit components documented in ADR-0003: Qwen-Image-Edit UNet, Qwen2.5-VL encoder, and Qwen VAE are Apache 2.0. The Lightning 8-step LoRA artifact must be verified by `@devops` before upload; if a compatible LoRA is not available, the deployment falls back to the 50-step Apache-only path.

## Contact

Primary channel for access requests, bugs, and feature ideas: [open an issue](https://github.com/Jhonata-Matias/servegate/issues/new/choose).

Response SLA (alpha): 3–7 business days, best-effort. For security issues use [private vulnerability reporting](https://github.com/Jhonata-Matias/servegate/security/advisories/new).

See the root [README — Contact](../README.md#contact) for the full support policy.

## License

MIT — see `LICENSE`.
