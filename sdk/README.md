# `@jhonata-matias/flux-client`

[![alpha](https://img.shields.io/badge/status-alpha-orange)](../docs/legal/TERMS.md) [![license MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

TypeScript SDK para o gateway de geração de imagens FLUX do projeto **servegate** (ex-gemma4). Encapsula chamadas ao gateway autenticado (Story 2.5), trata cold-start realista (~130s, ADR-0001 Path A) via `warmup()` + retry-with-backoff, e expõe error classes tipadas para UX flows diferenciados.

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
import { FluxClient, ColdStartError, RateLimitError, AuthError } from '@jhonata-matias/flux-client';

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
  if (e instanceof ColdStartError) {
    console.error(`Server taking too long (${e.duration_ms}ms across ${e.retry_count} retries)`);
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
| `ColdStartError` | Cold timeout esgotou retries | `duration_ms`, `retry_count`, `last_http_status?` |
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
- Epic 2 PRD: `docs/prd/epic-2-consumer-integration.md`
- ADR-0001 (Path A cold-start strategy): `docs/architecture/adr-0001-flux-cold-start.md`
- Gateway (Story 2.5): `docs/stories/2.5.gateway-rate-limit-cloudflare.story.md`
- This SDK story: `docs/stories/2.2.typescript-sdk-flux-client.story.md`

## Contact

Primary channel for access requests, bugs, and feature ideas: [open an issue](https://github.com/Jhonata-Matias/servegate/issues/new/choose).

Response SLA (alpha): 3–7 business days, best-effort. For security issues use [private vulnerability reporting](https://github.com/Jhonata-Matias/servegate/security/advisories/new).

See the root [README — Contact](../README.md#contact) for the full support policy.

## License

MIT — see `LICENSE`.
