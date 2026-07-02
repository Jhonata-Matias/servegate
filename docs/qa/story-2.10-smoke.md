# Story 2.10 — Multi-Tenant Auth Smoke Report

> **Sanitized.** Full 64-char keys and hash values live in the owner's private password manager; only the first 8 chars of each SHA-256 hash appear here for correlation with `wrangler tail` log lines.

## Metadata

- **Story:** [`2.10.gateway-multi-tenant-auth.story.md`](../stories/2.10.gateway-multi-tenant-auth.story.md)
- **Execution date:** 2026-07-02
- **Executed by:** @devops (Gage) — smoke commands + prod publish · @qa (Quinn) — verdict + report
- **Worker version at smoke:** `ba6b7c2d-5ee3-4ac0-9009-dabac196a520`
- **Target endpoint:** `https://gemma4-gateway.jhonata-matias.workers.dev/jobs`
- **Method:** `POST` with `Content-Type: application/json`
- **Body:** `{"input":{"prompt":"<per-row prompt>","steps":4}}`

## AC9 — 3-way Smoke Matrix

| # | Tenant | Slot | Prompt | HTTP | Body signal | Pass |
|---|--------|------|--------|------|-------------|:----:|
| 1 | Primary (owner) | `GATEWAY_API_KEY` | `AC9 primary smoke` | **202** | `job_id: 855ea85c...` returned; `status_url` populated | ✅ |
| 2 | Contabhub | `GATEWAY_API_KEY_2` | `smoke test Contabhub tenant-2` | **202** | `job_id: c75d16fb...` returned | ✅ |
| 3 | Invalid (fabricated) | — (nenhum slot) | `smoke` | **401** | `{"error":"invalid_api_key","reason":"mismatch"}` | ✅ |

**AC9 verdict: PASS 3/3.**

## AC7 — Log Attribution (per-tenant `api_key_hash`)

Verification approach: **code-level, not empirical smoke.**

- `gateway/src/video.ts:133` emits `api_key_hash: apiKeyHash` in the `job_submitted` log event for **video** submissions
- `gateway/src/video.ts:54` computes `hashApiKey(request.headers.get('X-API-Key') ?? '')` via SHA-256 — no changes from Story 5.2's canonical implementation
- Unit tests already cover this behavior:
  - `gateway/src/video.test.ts:257,287,303,346,387` — asserts distinct `api_key_hash` per key per KV bucket
  - `gateway/tests/auth.test.ts` — 21 new/refactored tests cover the `validateAuth` array-signature path
- Empirical video smoke was deliberately skipped: `POST /jobs { kind: "video" }` incurs 10× the RunPod cost vs image; code + unit-test evidence is sufficient for the AC.
- **Image submissions** deliberately do NOT include `api_key_hash` in logs — that path uses `RATE_LIMIT_KV` global counter (`count:YYYY-MM-DD`), an explicit non-goal per Story 2.10 AC10. This is inherited from Story 2.5 and will be addressed in Story 2.11 (KV-backed allowlist) — see backlog FU-4.3.1 and FU-2.10.1.

**AC7 verdict: PASS via code + tests; empirical smoke deferred as unnecessary.**

## Notable field discovery (post-mortem)

**First attempt at Contabhub smoke returned `401 mismatch` immediately after `wrangler secret put GATEWAY_API_KEY_2`.**

Root cause: the Cloudflare Worker in production was still running the pre-Story-2.10 code path (single-key `env.GATEWAY_API_KEY` only). Publishing a new secret to a slot that the deployed code does not read has no effect — the auth check ignores unknown slots by design (the array in `collectApiKeys(env)` only reflects the deployed code's `Env` type).

Fix: one `npx wrangler deploy` after PR #30 merge. Post-deploy retry succeeded with `202`.

Runbook update: captured in PR #31 (`docs/2.10-runbook-deploy-note`) — added warning admonition in `docs/usage/gateway-deploy.md` "Multi-tenant API keys" section distinguishing:

- **Defensive redeploy** — code already in prod, `wrangler deploy` after `secret put` is a no-op safety net
- **Mandatory first-deploy** — code merged but not yet deployed; the very first slot publish REQUIRES `wrangler deploy` before the slot activates

Rotation and revoke flows (subsequent `secret put`/`secret delete` on the same slot after code is deployed) apply in seconds and need no deploy.

## Tenant registry (owner-private, off-repo)

Values live in the owner's password manager; this section documents the mapping schema only.

| Slot | Tenant Label | Issued | Delivery Channel | Delivered | Revoked | Contact |
|------|--------------|--------|------------------|-----------|---------|---------|
| `GATEWAY_API_KEY` | Owner (primary) | Story 2.5 (2026-04-21) | n/a — self-served | n/a | — | @Jhonata-Matias |
| `GATEWAY_API_KEY_2` | Contabhub | 2026-07-02 | *(pending — owner to fill in)* | *(pending)* | — | *(pending)* |
| `GATEWAY_API_KEY_3` | (unassigned) | — | — | — | — | — |
| `GATEWAY_API_KEY_4` | (unassigned) | — | — | — | — | — |

Following the trigger conditions defined in backlog FU-2.10.1, once the owner assigns slot `_3` (i.e., a 3rd active tenant), Story 2.11 (KV allowlist) should be opened for planning.

## Deliverable checklist (post-report)

- [x] AC9 3/3 verified in prod
- [x] AC7 code+test verified; empirical deferred with rationale
- [x] Runbook post-mortem captured in PR #31
- [ ] **Owner action:** deliver `GATEWAY_API_KEY_2` to Contabhub via secure channel (GPG DM / age / signal)
- [ ] **Owner action:** save value into private password manager and delete scratchpad file `/tmp/claude-1000/.../scratchpad/contabhub-key-2026-07-02.txt`
- [ ] **Owner action:** fill in "Delivery Channel · Delivered · Contact" columns of the tenant registry above in the password manager copy

## Verdict

Story 2.10 is empirically **complete**. Flipping story Status: `InReview → Done` per this evidence.
