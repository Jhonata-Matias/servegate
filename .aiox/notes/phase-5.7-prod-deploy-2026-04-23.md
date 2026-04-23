# Phase 5.7 — Production deploy + NFR-3 / AC-7 (INC-2026-04-23-gateway-504)

## Production deploy (completed)

- **When (UTC):** 2026-04-23T17:07:00Z (approx; align to `wrangler` output in CI)
- **Command:** `cd gateway && npx wrangler deploy` (default / top-level worker — `gemma4-gateway`)
- **Worker:** `gemma4-gateway`
- **Version ID:** `df58fa68-82e3-4b6f-86fd-451bbbad4d47`
- **URL:** `https://gemma4-gateway.jhonata-matias.workers.dev`
- **Bindings:** `RATE_LIMIT_KV`, `JOBS_KV` (as reported by wrangler)

> Wrangler 4.x emitted a reminder to pass `--env=""` when multiple environments exist; default deploy targeted the **top-level** production worker (not `env.preview`).

## Smoke imediato (authenticated)

Mesmo protocolo da 5.6: `POST /jobs` → **202**; `GET /jobs/{id}` até **200** com `output.image_b64`; `POST /` → **404**. Executado com sucesso após o deploy.

## NFR-3 / AC-7 — observação 24h (**pendente @qa**)

- **Critério (story AC-7):** após deploy em produção, janela de **24h**; em Cloudflare Analytics verificar `Count(status == 504 AND wallTimeMs >= 60000) == 0`.
- **Início da janela sugerido (UTC):** 2026-04-23T17:08:00Z — usar como `T0` para relatório @qa (ajustar ao horário real do deploy se necessário).
- **Fecho esperado da janela (UTC):** 2026-04-24T17:08:00Z (T0 + 24h).
- **Owner do fechamento:** `@qa` (registrar resultado na story + `qa_report`).

Subtarefa **5.7** na story permanece **aberta** no checklist até existir **evidência documentada** do critério AC-7 acima.
