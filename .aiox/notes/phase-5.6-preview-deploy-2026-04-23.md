# Phase 5.6 — Preview deploy + smoke (INC-2026-04-23-gateway-504)

Status: verified

Date (UTC): 2026-04-23

## Deploy

- Command: `cd gateway && npx wrangler deploy --env preview` (equivalent: `npm run deploy:preview`)
- Worker: `gemma4-gateway-preview`
- Version ID: `d56fbd8e-58c8-4cbe-bb0f-c8e313816af8`
- URL: `https://gemma4-gateway-preview.jhonata-matias.workers.dev`
- Bindings confirmed by wrangler: `RATE_LIMIT_KV`, `JOBS_KV`

## Smoke (authenticated)

All against the preview URL above; `X-API-Key` from operator env (`GATEWAY_API_KEY`, not logged here).

### POST /jobs (FR-1)

- HTTP **202**
- Body: `job_id` (UUID), `status_url`, `est_wait_seconds: "unknown"`
- Headers: `Location: /jobs/{uuid}`, `Retry-After: 5`, `X-RateLimit-*` present

### GET /jobs/{id} until completion (FR-2)

- Job `fe55b1b1-93a0-4081-a685-9281bb6a8049`: **200** with `output.image_b64` present (first cycle).
- Second job (warm path): **202** then **200** with `image_b64` within a few polls.

### POST / legacy (AC-8)

- HTTP **404**
- Body includes `error`, `migration_doc: "/docs/api/migration-async.md"`

## Gate

`gate-preview-smoke-passes` criteria from `implementation.yaml` satisfied on preview.
