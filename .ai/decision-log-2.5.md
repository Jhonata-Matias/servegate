# Decision Log — Story 2.5 (Cloudflare Worker Gateway)

**Mode:** YOLO (autonomous, with HALT points for credential ops)
**Started:** 2026-04-21T20:10:00-03:00
**Branch:** `feature/2.5-gateway-cloudflare`
**Base commit:** `6c5c699` (post SDK publish)

## YOLO Limitations — HALT Points

Story 2.5 envolve operações que NÃO podem ser executadas autonomamente em Claude Code (requer browser, real credentials, real Cloudflare account):

| Task | Operation | Why HALT |
|---|---|---|
| 1.3 | `wrangler login` | Browser OAuth flow |
| 2.3 | `wrangler kv:namespace create` (real) | Cloudflare account API call |
| 7 | `wrangler secret put GATEWAY_API_KEY` etc | Requires user-generated secret values + interactive prompt |
| 9 | `wrangler deploy` | Real deploy to production Cloudflare account |
| 9.4 | `gateway/tests/smoke-101.sh` real run | Requires deployed endpoint |
| 10 | Day boundary reset test | Requires waiting for 00:00 UTC OR system clock manipulation |

**Approach:** Implementar TODO o code + tests + docs. Marcar tasks de HALT como `[ ]` com nota "(HALT — requires user action)". User executa essas manualmente.

## Pre-flight Decisions

### D1 — Location: `gateway/` top-level

- **Alternatives:**
  1. `gateway/` — **CHOSEN** — alinha com `sdk/` e `serverless/` patterns
  2. `packages/gateway/` — rejected: zero monorepo precedent
- **Reason:** consistency com structure existente

### D2 — Wrangler version: latest stable (4.x)

- **Decision:** `wrangler@^4.0.0` em devDeps (não global)
- **Reason:** local install evita conflict entre projetos; reproducible via npm install

### D3 — TypeScript + tsconfig strict

- **Decision:** TS 5.5+ strict mode (matching SDK Story 2.2 conventions)
- **Reason:** consistency + catches bugs early

### D4 — Test framework: vitest (consistent com SDK)

- **Decision:** vitest para unit tests de pure functions (auth helpers, rate-limit math)
- **Caveat:** Worker integration tests requerem `wrangler dev` (HALT até user roda local)

### D5 — Constant-time comparison para auth

- **Decision:** crypto.subtle.timingSafeEqual ou implementação manual
- **Reason:** Story 2.5 Task 3 explicit "constant-time (timing attack basics)"; padrão de segurança standard

### D6 — KV namespace ID em wrangler.toml

- **Decision:** Placeholder em wrangler.toml + documentação clara em README do gateway
- **Reason:** ID real só existe após `wrangler kv:namespace create` (HALT user action)

### D7 — Secrets management via wrangler

- **Decision:** `wrangler secret put` (não dotenv) — Cloudflare native
- **Reason:** Worker runtime acessa via `env.SECRET_NAME`; secrets criptografados no Cloudflare side

### D8 — Domain: workers.dev free tier

- **Decision:** `gemma4-gateway.<account>.workers.dev` (free subdomain)
- **Reason:** MVP per Story 2.5 Task 1; custom domain = future

## Implementation Log

(populated during execution)
