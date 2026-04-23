# Spec: Gateway Async Submit/Poll Pattern (Incident INC-2026-04-23-gateway-504)

> **Story ID:** INC-2026-04-23-gateway-504
> **Complexity:** STANDARD (totalScore=12 per complexity.json)
> **Generated:** 2026-04-23T14:05:00Z
> **Status:** Draft (Phase 4 output, pending @qa critique)
> **Pipeline inputs:** requirements.json (PM-validated), complexity.json (Architect-scored), research.json (Analyst-verified)

---

## 1. Overview

Este spec define a refatoração arquitetural do gateway servegate de um proxy HTTP síncrono (POST `/` → `/runsync` da RunPod) para um padrão async submit/poll (POST `/jobs` retorna 202; GET `/jobs/{id}` retorna resultado quando pronto). A mudança elimina a causa raiz do incident reportado: em cold-start (~130s conforme ADR-0001), Cloudflare Workers aborta a conexão em 60s resultando em HTTP 504 para o cliente — cenário impossível de remediar em arquitetura síncrona.

O spec cobre simultaneamente (escopo único por escolha do user):
- **Mudança arquitetural** (FR-1 a FR-3, FR-6): novo contrato async
- **Hot-fix de timeout** (FR-4): alinhar env var RunPod para 280s
- **Simplificações MVP** (FR-7): `est_wait_seconds: "unknown"` literal

### 1.1 Goals

- **Zero HTTP 504 em primeira invocação após idle** (NFR-3) — cold-start vira condição de polling, não erro
- **Submit <2s p95** (NFR-1) — cliente nunca segura conexão por tempo material
- **Paridade de testabilidade**: testável via Postman/curl sem SDK (INT-1)
- **Backward compat zero**: single contract POST `/jobs` + GET `/jobs/{id}` (CON-6)
- **SLA warm ≤10s p95** (NFR-2) preservado do Epic 2

### 1.2 Non-Goals

Derivados de CON-5, CON-6, e resoluções em `_meta.resolutions`:

- **POST `/` NÃO será mantido** com fallback 503 — é removido (CON-6)
- **SEM webhook callbacks** (OQ-3 deferred)
- **SEM cron warmup edge** (OQ-4 deferred)
- **SEM heurística est_wait** — sempre literal `"unknown"` no MVP (FR-7, OQ-5)
- **SEM pivot para Path B** do ADR-0001 (bake-in models) — permanece Path A (CON-2)
- **SEM Durable Objects** para consistency forte — KV-only (CON-1)
- **SEM implementação cross-POP sticky routing** — alegação removida de ASM-1 per research RT-1

---

## 2. Requirements Summary

### 2.1 Functional Requirements

| ID | Description | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | POST /jobs retorna 202 com body {job_id, status_url, est_wait_seconds:'unknown'} + headers Location + Retry-After:5, em <2s | P0 | requirements.json + RT-3 (RFC 7231) |
| FR-2 | GET /jobs/{id} retorna 200 (done), 202 (running), 504 (timeout), 404 (not found/expired) | P0 | requirements.json |
| FR-3 | Mapeamento job_id→runpod_request_id em Cloudflare KV, TTL completion+30min OU submit+6h | P0 | requirements.json (C-1 corrected per RT-2) |
| FR-4 | Hot-fix: auditar/corrigir COMFY_GENERATION_TIMEOUT_S=280 em prod RunPod | P1 | requirements.json (incident origin) |
| FR-6 | SDK v0.2.0 MINOR ⚠️ BREAKING: generate() internamente usa submit+poll; API pública preservada | P1 | requirements.json (alpha policy per sdk/CHANGELOG) |
| FR-7 | est_wait_seconds literal "unknown" em todas respostas MVP | P2 | requirements.json (OQ-5 resolved) |

**FR-5 removido** (audit trail em `_removed_functional`) — POST `/` é deprecado imediatamente per OQ-1 user decision.

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| NFR-1 | performance | POST /jobs retorna <2s p95 | Worker wallTimeMs < 2000 p95 |
| NFR-2 | performance | Warm path submit + 1 poll ≤10s p95 | End-to-end wall time ≤ 10s p95 (warm) |
| NFR-3 | reliability | Zero 504 em primeira invocação após idle | Count(504 AND wallTimeMs≥60000) = 0 / 30 dias |
| NFR-4 | security | job_id via crypto.randomUUID() (UUID v4); privacy Story 2.5 preservada | Code review + grep inspection |
| NFR-5 | scalability | ≤1 KV write + ≤30 reads/job (cold-start 130s / 5s polling = 26 reads) | KV usage ≤ free tier (100k reads/day) |

### 2.3 Constraints

| ID | Type | Constraint | Impact |
|----|------|------------|--------|
| CON-1 | technical | Cloudflare Workers free tier only (100k req/day, KV free, sem Durable Objects, sem Queues paid) | Arquitetura usa KV não-DO |
| CON-2 | technical | ADR-0001 Path A mantido — não pivotar para bake-in models (35GB image) | Cold-start 115-150s permanece |
| CON-3 | technical | RunPod /run + /status (async) já existem — usar, não inventar | Handler.py serverless inalterado |
| CON-4 | regulatory | Gateway nunca loga prompt/image bytes (privacy Story 2.5) | Novos endpoints herdam redaction |
| CON-5 | business | MVP rígido — sem feature creep (webhooks, cron, heurística est_wait) | OQs 3/4/5 permanecem deferred |
| CON-6 | technical | Single contract: POST /jobs + GET /jobs/{id}. POST / removido (não fallback 503) | Story 2.5 código substituído |

---

## 3. Technical Approach

### 3.1 Architecture Overview

Padrão **async submit/poll** alinhado com industry standard (Azure Architecture Center, Cloudflare Workers Best Practices — research RT-3):

```
Cliente (Postman/curl/SDK)
   │
   │  1. POST /jobs {prompt, steps, ...}
   ▼
Cloudflare Worker (gateway/src/index.ts)
   │  ├─ validateAuth() [existente Story 2.5]
   │  ├─ checkAndIncrement() [rate-limit existente]
   │  ├─ runpod.submitJob() → RunPod POST /v2/{endpoint}/run
   │  │      ← {id: runpod_request_id, status: "IN_QUEUE"}
   │  ├─ job_id = crypto.randomUUID()
   │  ├─ storage.put(job_id, {runpod_request_id, status:"queued", created_at})
   │  └─ Return 202 + {job_id, status_url, est_wait_seconds:"unknown"}
   │         + Location: /jobs/{job_id} + Retry-After: 5
   ▼
Cliente polls
   │
   │  2. GET /jobs/{job_id} (periodicamente)
   ▼
Cloudflare Worker
   │  ├─ validateAuth()
   │  ├─ storage.get(job_id, {cacheTtl: low}) — RT-1 mitigação
   │  │   └─ Se 404: retorna 404 {error:"job_not_found_or_expired"} (EC-2)
   │  ├─ runpod.getStatus(runpod_request_id) → /v2/{endpoint}/status/{id}
   │  │   ← {status: IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED|CANCELLED|TIMED_OUT, output?}
   │  ├─ Status mapping (terminology.status_str table):
   │  │     IN_QUEUE→queued; IN_PROGRESS→running; COMPLETED→completed;
   │  │     FAILED→failed; CANCELLED→cancelled; TIMED_OUT→timeout
   │  ├─ Se completed: storage.update(status), retorna 200 + image_b64 payload
   │  ├─ Se running/queued: retorna 202 + {status, est_wait_seconds:"unknown"}
   │  └─ Se failed/cancelled/timeout: retorna 504/500 + error_code
   ▼
```

**Por que esse padrão** (rationale em RT-3 + CON-3):
- RFC 7231 status 202 + Location + Retry-After = universalmente suportado
- Mirror do próprio contrato RunPod elimina abstraction leak
- Cliente Postman usa `{{job_id}}` variável + GET sequencial — paridade de testabilidade preservada (INT-1)

### 3.2 Component Design

Derivado de complexity.json scope dimension + existing codebase patterns (gateway/wrangler.toml, gateway/src/*):

| Componente | Arquivo | Responsabilidade | Novo? |
|-----------|---------|-----------------|-------|
| Request router | `gateway/src/index.ts` | Route POST /jobs vs GET /jobs/{id}; rejeita POST / com 404 | Refactor |
| RunPod client | `gateway/src/runpod.ts` | `submitJob()` → /run, `getStatus()` → /status, `getOutput()` → /view | **NOVO** |
| KV storage | `gateway/src/storage.ts` | `put(jobId, mapping)`, `get(jobId, {cacheTtl})`, `updateStatus(jobId, status)` | **NOVO** |
| Status mapping | `gateway/src/runpod.ts` (helper) | RunPod enum → gateway enum (terminology table) | **NOVO** (in-file) |
| Types | `gateway/src/types.ts` | Job, JobMapping, RunpodResponse; remove proxy types | Refactor |
| Rate-limit | `gateway/src/rate-limit.ts` | Separar contadores: POST /jobs conta; GET /jobs/{id} NÃO conta (EC-5) | Refactor minor |
| Legacy proxy | `gateway/src/proxy.ts` | **REMOVIDO** (CON-6) | Delete |
| SDK client | `sdk/src/client.ts` | `generate()` internamente faz submit + poll com Retry-After respect | Refactor |

### 3.3 Data Flow

Detalhado em requirements.interactions.INT-1 (10 passos). Resumo:

**Happy path warm (~10s):**
1. POST /jobs → 202 (1-2s)
2. GET /jobs/{id} após 5s → 202 running
3. GET /jobs/{id} após 10s → 200 + image

**Happy path cold (~135s):**
1. POST /jobs → 202 (1-2s)
2. GET /jobs/{id} polls retornam 202 queued/running por ~130s
3. GET /jobs/{id} eventual → 200 + image
4. **Zero 504** (NFR-3): cold-start é estado transitório observável, não erro

**Edge cases (todos em requirements.edgeCases):**
- EC-1: RunPod /run falha → 503 sem criar KV entry
- EC-2: job_id inexistente/expirado → 404 (unified, não revela qual)
- EC-4: generation timeout (280s) → gateway detecta via /status, retorna 504
- EC-7: KV race cross-POP → SDK retry 3x (1s/2s/4s) antes de surfacing 404
- EC-8: Cliente legacy POST / → 404 + {migration_doc}

---

## 4. Dependencies

### 4.1 External Dependencies

| Dependency | Version | Purpose | Verified |
|-----------|---------|---------|----------|
| Cloudflare Workers Runtime | compatibility_date=2026-04-01 (já em wrangler.toml) | Fetch handler + crypto.randomUUID() nativo | ✅ RT-3 |
| Cloudflare Workers KV | — (free tier) | JOBS_KV namespace para job→runpod mapping; padrão já usado para RATE_LIMIT_KV | ✅ RT-1 (eventual consistency aceitável com mitigação) |
| RunPod Serverless /run | — (conta existente Story 2.1) | Submit async job; retorna {id, status:"IN_QUEUE"} | ✅ RT-2 (docs.runpod.io/serverless/endpoints/operation-reference) |
| RunPod Serverless /status/{id} | — | Poll job status; retorna {delayTime, executionTime, id, output?, status} | ✅ RT-2 |
| RunPod Serverless /view | — | Opcional — dependendo de se imagem vem inline em output ou precisa fetch separado | ⚠️ Empírico (handler atualmente usa /view via handler.py, mas em serverless async o output pode já vir) |

### 4.2 Internal Dependencies

| Module | Purpose |
|--------|---------|
| `gateway/src/auth.ts` | Reusa validateAuth() existente Story 2.5 |
| `gateway/src/rate-limit.ts` | Reusa checkAndIncrement() com ajuste para separar contadores |
| `gateway/src/log.ts` | Reusa logging redaction (CON-4) |
| `sdk/src/errors.ts` | ColdStartError pode ser aposentado (cold não é erro no async); RateLimitError, AuthError, NetworkError, ValidationError preservados |

---

## 5. Files to Modify/Create

### 5.1 New Files

| File Path | Purpose | Template |
|-----------|---------|----------|
| `gateway/src/runpod.ts` | RunPod API client wrapper (/run, /status, /view) | — |
| `gateway/src/storage.ts` | KV operations (put/get/update) com cacheTtl parameter | — |
| `docs/api/migration-async.md` | Guia migração POST / → POST /jobs + GET /jobs/{id} para clientes (referenciado em EC-8) | — |
| `docs/architecture/adr-0002-async-gateway-pattern.md` | ADR documentando shift sync→async; referencia incident INC-2026-04-23-gateway-504 | ADR template existente |
| `docs/stories/INC-2026-04-23-gateway-504/INC-2026-04-23-gateway-504.story.md` | Story formal (drafted em Phase 6 plan) | story-tmpl |

### 5.2 Modified Files

| File Path | Changes | Risk |
|-----------|---------|------|
| `gateway/src/index.ts` | Router: rejeita POST / (404), roteia POST /jobs e GET /jobs/{id} | High (sole entrypoint) |
| `gateway/src/proxy.ts` | **DELETAR** — substituído por runpod.ts + index.ts routing | High |
| `gateway/src/types.ts` | Remove ProxyTypes; adiciona Job, JobMapping, RunpodResponse, JobStatus enum | Low |
| `gateway/src/rate-limit.ts` | GET /jobs/{id} não consome rate-limit (EC-5) | Low |
| `gateway/src/auth.ts` | Sem mudança (validateAuth aplicável em ambos endpoints) | Nenhum |
| `gateway/src/log.ts` | Logger já content-agnostic — verificar que novos eventos (job_submitted, job_polled, job_completed) não logam prompt/imagem | Low |
| `gateway/wrangler.toml` | Add `[[kv_namespaces]] binding="JOBS_KV"` (após `wrangler kv namespace create JOBS_KV`) | Low |
| `gateway/tests/**` | Atualizar testes existentes; novos testes conforme §6 | Medium |
| `sdk/src/client.ts` | `generate()` interno: submit via POST /jobs → poll GET /jobs/{id} respeitando Retry-After; preserva API pública | High |
| `sdk/src/types.ts` | Ajustar response types se mudar; ColdStartError possivelmente deprecado | Low |
| `sdk/tests/**` | Atualizar suite para novo fluxo interno | Medium |
| `sdk/package.json` | `"version": "0.2.0"` | Low |
| `sdk/CHANGELOG.md` | Entry 0.2.0 com ⚠️ BREAKING flag explicando migração interna | Low |
| RunPod endpoint env | `COMFY_GENERATION_TIMEOUT_S=280` (FR-4 hot-fix; via RunPod dashboard, não arquivo) | Low |

**Scope estimado:** 10 novos/modificados no gateway + 4 na SDK + 2 docs + 1 ADR ≈ **~15-17 arquivos**. Alinhado com complexity.json scope dimension score=3 (6-10 files, cross-module).

---

## 6. Testing Strategy

### 6.1 Unit Tests

| Test | Covers | Priority |
|------|--------|----------|
| `storage.put()` stores mapping with TTL | FR-3 | P0 |
| `storage.get()` returns null after TTL expires | FR-3 / EC-2 | P0 |
| `storage.get()` respects cacheTtl parameter | ASM-1 mitigation | P1 |
| `runpod.submitJob()` parses /run response and returns runpod_request_id | FR-1, RT-2 schema | P0 |
| `runpod.getStatus()` parses all 6 status enum values | terminology.status_str, RT-2 | P0 |
| `crypto.randomUUID()` generates unique v4 UUIDs | NFR-4 | P1 |
| Status mapping table (RunPod enum → gateway enum) | terminology.status_str | P0 |
| Rate-limit separates GET /jobs/{id} from POST /jobs counter | EC-5 | P1 |

### 6.2 Integration Tests

| Test | Components | Scenario |
|------|-----------|----------|
| Happy path warm | index.ts + runpod.ts + storage.ts | POST /jobs → GET /jobs/{id} (poll) → 200 + image, total <10s |
| Happy path cold (simulated) | idem + mocked slow /status | POST /jobs → multiple 202 polls → eventual 200, NO 504 emitted |
| Legacy POST / rejected | index.ts | POST / returns 404 + migration_doc pointer (EC-8) |
| Rate-limit on submit only | rate-limit.ts + index.ts | 100 POST /jobs exhausts limit; GET /jobs/{id} still works |
| Auth failure | auth.ts + index.ts | Invalid X-API-Key returns 401 on both POST /jobs and GET /jobs/{id} |
| RunPod /run failure | runpod.ts + index.ts | 503 returned, no KV entry created (EC-1) |
| Job expired | storage.ts | GET /jobs/{id} after TTL returns 404 (EC-2) |
| KV race simulation | storage.ts + SDK retry | First GET returns 404, retry 2 succeeds (EC-7 via SDK) |

### 6.3 Acceptance Tests (Given-When-Then)

Derivados de FR acceptance criteria em requirements.json:

```gherkin
Feature: Async job submission via POST /jobs

  Scenario: Valid submission returns 202 with standard headers (FR-1)
    Given a valid X-API-Key and a JSON body with prompt="test"
    When the client POSTs to /jobs
    Then the response status is 202
    And the response completes in less than 2 seconds
    And the body contains fields: job_id, status_url, est_wait_seconds
    And est_wait_seconds is the literal string "unknown"
    And response headers include "Location: /jobs/{job_id}"
    And response headers include "Retry-After: 5"
    And job_id matches the UUID v4 format

  Scenario: Polling a completed job (FR-2)
    Given a submitted job that has completed in RunPod
    When the client GETs /jobs/{job_id}
    Then the response status is 200
    And the body contains image_b64 and metadata

  Scenario: Polling a running job (FR-2)
    Given a submitted job still processing in RunPod
    When the client GETs /jobs/{job_id}
    Then the response status is 202
    And the body contains {status: "running"} or {status: "queued"}
    And est_wait_seconds is the literal string "unknown"

  Scenario: Unknown job_id returns 404 (EC-2)
    Given a job_id that was never created OR has expired past TTL
    When the client GETs /jobs/{job_id}
    Then the response status is 404
    And the response body does NOT reveal whether it was never-created vs expired

Feature: Legacy endpoint removal (CON-6, EC-8)

  Scenario: POST / returns 404 after this story deploys
    Given the gateway deployed with this spec live
    When any client POSTs to /
    Then the response status is 404 (or 405)
    And the body includes a migration pointer (/docs/api/migration-async.md)

Feature: Zero 504 on cold-start (NFR-3)

  Scenario: Cold-start first invocation after idle
    Given a gateway worker idle for 10+ minutes (expected cold)
    When the client POSTs to /jobs and polls until 200
    Then at no point is the response status 504
    And the client reaches image retrieval within COMFY_GENERATION_TIMEOUT_S (280s) worst case

Feature: SDK v0.2.0 preserves public API (FR-6)

  Scenario: generate() returns Promise<Result> as in v0.1.0
    Given SDK v0.2.0 installed
    When the consumer calls client.generate({prompt, steps})
    Then the method internally submits via POST /jobs and polls
    And returns the same Result shape as v0.1.0
    And respects Retry-After header in poll cadence
```

---

## 7. Risks & Mitigations

Derivados de complexity.json.flags + research.json.open_uncertainties + ASM risks:

| Risk | Prob | Impact | Mitigation | Source |
|------|------|--------|-----------|--------|
| KV eventual consistency causa 404 false positive em primeiro GET após POST | Medium | Medium | SDK retry 3x exponencial (EC-7); cacheTtl baixo em KV read (testar empirically) | ASM-1 + RT-1 |
| RunPod /status race condition pós-/run (não documentado) | Low | Medium | Mesma mitigação de EC-7 (retry absorve primeiro 404 ou IN_QUEUE redundante) | ASM-2 + RT-2 OU-1 |
| KV namespace mal configurado em produção quebra tudo | Low | High | Wrangler rollback <1min restaura endpoint; monitorar 1º deploy via `wrangler tail` | complexity.risk=3 |
| SDK breaking change afeta consumidor desconhecido | Very Low | High | ASM-4 confirmado (sem third-party consumers); SDK v0.2.0 com ⚠️ BREAKING flag; CHANGELOG explícito | ASM-4 + sdk/CHANGELOG alpha policy |
| FlashBoot + network volume interação desconhecida piora cold | Low | Low | ADR-0001 measurements conservadoras (130s); verificar se FlashBoot está enabled (A-1 non-blocking task) | RT-4 OU-2 |
| cacheTtl baixo em KV read não reduz staleness na prática | Low | Low | Teste empírico durante dev; fallback: SDK retry sozinho é suficiente | RT-1 OU-3 |
| Volume MVP excede free tier KV (unlikely) | Very Low | Low | ASM-3 confirmado — 100-500 jobs/mês << 100k reads/dia. Rapid-success cenário aciona ADR-0001 pivot antes | ASM-3 + NFR-5 |
| Legacy Postman collections do owner quebram sem aviso | Very Low | Low | docs/api/migration-async.md + 404 response inclui pointer (EC-8); single consumer = self; custo de migração trivial (OQ-1 resolution) | EC-8 + OQ-1 |

---

## 8. Open Questions

Derivadas de requirements.openQuestions (vazio — todas resolvidas em Phase 1 validation) + research.open_uncertainties (não-bloqueantes):

| ID | Question | Blocking | Assigned To |
|----|----------|----------|-------------|
| OU-1 | Race condition window após /run na RunPod (tamanho exato) | No | Empirical test durante dev |
| OU-2 | FlashBoot efficacy com network volume mount | No | Verificar dashboard (Task de implementation) |
| OU-3 | cacheTtl=low força leitura fresh ou apenas expira local cache? | No | Empirical test |
| OU-4 | RunPod /status retorna exatamente o quê para job expirado (>30min)? | No | Observacional; gateway unifica via EC-2 handling |

**Nenhuma OQ bloqueante para implementação.** OU-1/3 são testes dev-time; OU-2 é toggle de 1-clique; OU-4 é observacional e tem handling defensivo.

---

## 9. Implementation Checklist

High-level tasks derivados deste spec. @architect em Phase 6 (*create-plan) detalhará subtasks e ordering.

- [ ] Criar ADR-0002 documentando shift sync→async (ref este spec)
- [ ] `wrangler kv namespace create JOBS_KV` + update `wrangler.toml`
- [ ] Implementar `gateway/src/storage.ts` (put/get/update com cacheTtl)
- [ ] Implementar `gateway/src/runpod.ts` (submitJob, getStatus, status mapping)
- [ ] Refatorar `gateway/src/index.ts` (routing POST /jobs, GET /jobs/{id}, legacy 404)
- [ ] Refatorar `gateway/src/types.ts` (novos types, remove proxy types)
- [ ] Ajustar `gateway/src/rate-limit.ts` (separar contadores submit vs poll)
- [ ] Deletar `gateway/src/proxy.ts`
- [ ] Unit tests + integration tests conforme §6.1 e §6.2
- [ ] Refatorar `sdk/src/client.ts` (generate() internal submit+poll)
- [ ] SDK version bump 0.2.0 + CHANGELOG ⚠️ BREAKING entry
- [ ] Verificar/habilitar FlashBoot na RunPod dashboard (non-blocking)
- [ ] Atualizar env var RunPod: `COMFY_GENERATION_TIMEOUT_S=280` (FR-4 hot-fix)
- [ ] Escrever `docs/api/migration-async.md` (guide Postman/curl)
- [ ] Atualizar `docs/api/reference.md` (novo contrato)
- [ ] Deploy preview via wrangler → smoke test
- [ ] Deploy produção → validar NFR-3 (zero 504) por 24h
- [ ] Escrever acceptance tests em arquivo executável (Gherkin → Vitest ou similar)

---

## Metadata

- **Generated by:** @pm (Morgan) via spec-write-spec Phase 4
- **Inputs traced:**
  - `requirements.json` (7 FRs including removed FR-5 in audit, 5 NFRs, 6 CONs, 4 ASMs, 2 DMs, 1 INT, 8 ECs, 4 TERMs, 0 OQs)
  - `complexity.json` (STANDARD score=12, 5 flags)
  - `research.json` (4 topics, 9 sources, 4 open uncertainties)
- **Article IV compliance:** All statements trace to requirements (FR/NFR/CON/ASM/DM/INT/EC/TERM IDs) or research.json findings (RT IDs) — no invented content.
- **Pipeline next phase:** 5 Critique (@qa)
- **Iteration:** 1 (Draft)
