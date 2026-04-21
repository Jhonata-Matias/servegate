# Epic 2 — Consumer Integration (Hybrid Pragmatic)

**Status:** In Progress (v0.4 — post QA gate 2.1.2 PASS)
**Owner:** @pm (Morgan)
**Created:** 2026-04-21
**Last Updated:** 2026-04-21 (v0.4)
**Project:** gemma4
**Predecessor:** Epic 1 (Pod Inference Stack — Done em 2026-04-21)

### Changelog

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1 | 2026-04-21 | @pm Morgan | Initial draft — pre-implementation, projections ungrounded |
| 0.2 | 2026-04-21 | @pm Morgan | **Post Story 2.1 update** — cost projection calibrada com medição real (+2.5x), cold start realism (AC5 gap documentado), stories 2.1.1 + 2.1.2 adicionadas, cold SLA deferido para ADR-0001 |
| 0.3 | 2026-04-21 | @pm Morgan | **Post ADR-0001 approval** — Path A accepted (accept cold, solve via client UX). Cold SLA: warm <10s p95 (primary), cold ~130s first-invocation after idle (secondary, mitigated via SDK warmup + demo pre-warm). Path B reserved as reversible pivot (1-2 dev-days). 30-day review 2026-05-21 with measurable criteria. |
| 0.4 | 2026-04-21 | @pm Morgan | **Post QA gate 2.1.2 PASS** (95/100) — Added preliminary ACs for Stories 2.2 (SDK) + 2.3 (demo) derived from ADR-0001 Impact + PM Addenda 1+4; @sm can now draft both stories with anchored scope. Risk R4 aligned with ADR "no change Story 2.5" (pre-warm = SDK responsibility, not gateway). New "30-Day Review Governance" section formalizing 4 pivot triggers + 4 stay-course criteria + DRI assignment (**@pm owns data collection until 2026-05-21**: RunPod billing, demo analytics, issue triage). Resolves QA gate observations O2/O3/O4. |

---

## Goal

Habilitar consumo da capacidade de geração de imagem (Story 1.1) por aplicações TypeScript de produção, com latência sub-10s síncrono, autenticação básica e custo escalável a partir de quase-zero. **Decisão estratégica:** stack híbrida — inferência via RunPod Serverless (não Pod self-hosted) pra economia operacional + escala automática; Pod self-hosted re-posicionado pra dev/treino.

## Why (motivação)

- Mid-Story 1.1 o usuário perguntou: *"quero fazer chamadas do modelo em TypeScript. Preciso de Vercel?"* — pergunta abriu Epic 2.
- Discovery PM (2026-04-21) revelou tensão entre stack atual (1 Pod self-hosted, on/off) e os requisitos declarados (web frontend síncrono <10s, escalável, produção, volume incerto).
- Análise econômica: 1 Pod 24/7 = ~$502/mo idle vs RunPod Serverless = $0.0006/imagem ($0.60 por 1.000 imgs). Pra volume incerto (MVP), serverless vence em 1+ ordem de magnitude até ~20.000 imgs/mês.
- Auth + port mapping são bloqueadores reais — não dá pra "TS chamar API" sem resolvê-los.

## Strategic Decision: Hybrid Pragmatic

| Componente | Stack escolhida | Por quê |
|---|---|---|
| **Inferência produção** | RunPod Serverless (FLUX schnell endpoint) | Custo near-zero ocioso, auto-scale, sub-10s p95 (cold start raro), pay-per-image |
| **Inferência dev/treino** | Pod self-hosted atual (Epic 1) | Iteração rápida sem deploy, controle total, estado preservado |
| **API gateway / auth** | Backend Node em Railway/Fly OU Cloudflare Worker (a decidir em Story) | Concentra auth + rate-limit + observability sem expor serverless direto |
| **Frontend demo** | Next.js + Vercel (free tier) | Showcase rápido; opcional pra produto real |
| **TypeScript SDK** | Pacote npm `@gemma4/flux-client` (interno ou público) | Reusável em qualquer consumidor TS |

## Scope

**In scope (Epic 2):**
- Empacotar workflow ComfyUI+FLUX como **endpoint RunPod Serverless** (handler.py + Docker)
- **TypeScript SDK** consumindo o endpoint (types, helpers, error handling, polling)
- **API key auth** (header `X-API-Key`) — gateway proxiando o endpoint serverless
- **Web demo Next.js + Vercel** mostrando uso real
- Documentação developer-facing (quickstart SDK, deploy guide)

**Out of scope (Epic 2 — futuros epics):**
- Multi-tenant auth / JWT / login flow
- CDN para imagens geradas (Cloudflare R2, S3)
- Rate-limiting avançado por usuário
- Observabilidade de produção (Datadog, Sentry, custom metrics)
- Migração do Pod self-hosted pra produção (não justificado economicamente até >20k imgs/mês)
- Integração com n8n-master (story candidata 2.4 opcional)
- Custom UI workflow builder
- Fine-tuning ou modelos custom (Pod self-hosted continua sendo o lab pra isso)

## Success Criteria

- [x] **RunPod Serverless endpoint funcional** (Story 2.1 Done) — warm p95 ~7s ✅; cold p95 ~150s ⚠️ (target <30s não atingível com Opção A network volume; decisão em ADR-0001 — Story 2.1.2)
- [ ] TypeScript SDK publicado (npm interno ou github packages) com tipagem completa — **Story 2.2 (não draftada)**
- [ ] App demo deployada em Vercel mostrando: input prompt → image em <10s — **Story 2.3 (não draftada)**
- [ ] Auth via X-API-Key bloqueia requests sem header válido (HTTP 401) — **Story 2.5 gateway (drafted)**
- [ ] **Custo MVP <$20/mês** — REVISED com medição real — ver seção Cost Projection (v0.2)
- [ ] Documentação cobre: deploy serverless, integração SDK, customização frontend
- [x] Pod self-hosted continua acessível via `pod.sh up` pra dev (não foi quebrado) — validado Story 2.1

### Calibration note (v0.2)

O critério "cold spawn sub-30s" foi invalidado empiricamente pela Story 2.1 (medido 98-150s true cold). **Decisão de SLA cold-start deferida** para ADR-0001 em Story 2.1.2 (architectural spike). Warm p95 <10s mantido como SLA primário para consumers Epic 2 (2.2 SDK / 2.3 demo).

### SLA decision post-ADR-0001 (v0.3 — 2026-04-21)

**Path A accepted** (accept cold, solve via client UX):

| SLA layer | Target | Who enforces |
|---|---|---|
| Warm p95 (primary) | <10s | Story 2.1 — validated ✅ |
| Cold first-invocation after idle | ~130s expected, 180s timeout | Story 2.2 SDK retry-with-backoff |
| Web demo first-load-to-interactive | <150s with pre-warm UI | Story 2.3 pre-warm hook + loading states |
| Subsequent warm in same session | <10s | SDK retry logic keeps warm while active |

**ADR reference:** `docs/architecture/adr-0001-flux-cold-start.md` (approved 2026-04-21 with 4 PM addenda).

**Pivot criterion (30-day review 2026-05-21):** if volume >1000/mo OR demo bounce >40% OR cold >180s sustained → Story 2.1.3 (Path B bake-in, 1-2 dev-days).

## Stories (status atualizado — v0.2)

| ID | Título | Prioridade | Owner | Status |
|---|---|---|---|---|
| **2.1** | Empacotar workflow ComfyUI+FLUX como RunPod Serverless endpoint | **MUST** | @dev | **Done** (QA CONCERNS 8.2/10 — gaps deferidos para 2.1.1 + 2.1.2) |
| **2.1.1** | Fix serverless endpoint QA concerns (deploy idempotent + input validation + robustness + unit tests) | **HIGH** | @dev | **Ready for Review** (QA PASS 9.4/10 — pending close-story + optional redeploy) |
| **2.1.2** | Decide cold-start mitigation strategy (ADR-0001) | **HIGH** | @architect + @pm | **Ready** (Draft→Ready PO 9.7/10 — spike ADR-driven, timebox 72h) |
| **2.2** | Implementar TypeScript SDK `@gemma4/flux-client` consumindo o endpoint | **MUST** | @dev | **Backlog** — bloqueada por 2.1.1 Done + 2.1.2 ADR (retry strategy depende) |
| **2.5** | Gateway Cloudflare Worker + KV pra auth (X-API-Key) + rate-limit 100/dia global | **MUST** | @dev | **Ready** (validada @po 9.75/10) — pode rodar paralela a 2.2 |
| **2.3** | App demo Next.js + Vercel usando SDK contra gateway URL | **MUST** | @dev (+ @ux opcional) | **Backlog** — requer 2.1.1 Done + 2.2 + 2.5 |
| **2.4** | (Opcional) Custom node n8n integrando o SDK | SHOULD | @dev | **Backlog** opportunistic |

### Dependency graph atualizado

```
2.1 (Done)
 ├── 2.1.1 (Ready for Review) ──┐
 ├── 2.1.2 (Ready)              │
 │    └── ADR-0001 ─────────────┤
 │                              ├── 2.2 (blocked)
 │                              │    └── 2.3 (blocked)
 └── 2.5 (Ready) ───────────────┘         ↑
                                          │
                                     requires 2.5 gateway too
```

**MVP revisado path (ordem otimizada):**
1. Fechar **2.1.1** (pending close-story + redeploy) → **2.2 draft + dev** desbloqueado parcialmente
2. Executar **2.1.2** em paralelo (architect spike 72h)
3. Post-ADR: ajustar **Epic 2 PRD** se path B ou C escolhido (cria story filha 2.1.3 se implementação requerida)
4. **2.2** dev (SDK com retry strategy definida por ADR)
5. **2.5** dev em paralelo a 2.2 (independente)
6. **2.3** dev depende de 2.2 + 2.5 operacionais

## Preliminary ACs — Stories 2.2 & 2.3 (derived from ADR-0001, v0.4)

> These are **PM-authored preliminary ACs** anchored em ADR-0001 decisions + PM Addenda 1/4 + SLA v0.3. @sm absorves estes quando draftar as stories formalmente; ACs podem ser refinados no draft mas não reduzidos sem aprovação @pm (Article IV — No Invention).

### Story 2.2 — TypeScript SDK `@gemma4/flux-client`

**Rationale:** ADR-0001 Path A transfere UX complexity para client-side. SDK é o layer que absorve cold-start realism (~130s) via retry+warmup. Effort estimate **4-8h dev** (PM Addendum 1).

| AC | Descrição | Source | Acceptance test |
|---|---|---|---|
| 2.2-AC1 | **Typed client contract** — `FluxClient` class com métodos tipados (`warmup()`, `generate(input)`, `isWarm()`). Input types estritos (`steps: number`, `width: number`, `height: number`, etc.) — zero coerção implícita; passar `steps=0` retorna `ValidationError` do SDK antes de hit no gateway. | PRD v0.2 constraint "input validation strictness" + Story 2.1.1 handler contract | `npm run test` cobre: rejeita `{steps: "4"}`, rejeita `{width: 0}`, aceita `{steps: 4, width: 1024}` |
| 2.2-AC2 | **Warmup helper** — `warmup(options?: { timeout?: number }): Promise<WarmupResult>` dispara dummy minimal request, resolve quando worker hot. Default timeout **180s** (honra SLA v0.3 cold ceiling). Retorna `{ duration_ms: number, was_cold: boolean }`. | ADR Impact on 2.2 + Addendum 4 mitigation #1 (pre-warm) | Integration test: warmup após 5min idle retorna `was_cold: true` com `duration_ms` entre 60-180s |
| 2.2-AC3 | **Retry-with-backoff** — `generate()` com retry config default: **max 3 retries, exponential backoff 1s→2s→4s**, configurable via `FluxClient` constructor (`{ maxRetries, backoffStrategy }`). First attempt timeout 180s (cold SLA); subsequent 30s (warm). | ADR Impact on 2.2 + SLA v0.3 4-layer table | Unit test: mock gateway returning 503 × 3 → success na 4ª tentativa; mock timeout 180s → throw `ColdStartError` |
| 2.2-AC4 | **ColdStartError class** — `ColdStartError extends Error` expondo `duration_ms`, `retry_count`, `last_http_status`. Consumers diferenciam via `catch (e instanceof ColdStartError)` para custom UX (ex: retry manual, troca de fallback provider). | ADR Impact on 2.2 (ColdStartError type explícito) | TypeScript type test: `ColdStartError` tem propriedades tipadas + `instanceof` funciona em bundle CJS e ESM |
| 2.2-AC5 | **is-warm probe** — `isWarm(): Promise<boolean>` lightweight check. Pode implementar via HEAD request ou cached status (TTL 30s) — não conta contra retry budget. Expõe `getLastWarmTimestamp()` para consumers priorizarem. | Addendum 4 implicit (analytics de warmup state) | Integration test: após `generate()` sucesso warm, `isWarm()` retorna `true` por 30s; após 5min idle, retorna `false` |
| 2.2-AC6 | **Gateway integration** — SDK chama **gateway URL** (Story 2.5), NÃO RunPod direto. Respeita header `X-API-Key` + parsing de 429 com `Retry-After` (throw `RateLimitError` com `retry_after_seconds`). `RUNPOD_API_KEY` nunca embedded no SDK. | PRD Constraint "Decoupling" + Story 2.5 auth | Test com gateway mock: 401 → `AuthError`; 429 + `Retry-After: 60` → `RateLimitError.retry_after_seconds === 60` |
| 2.2-AC7 | **Documentation** — README quickstart (< 30 linhas) mostra padrão: (a) `const client = new FluxClient({ apiKey, gatewayUrl })`, (b) `await client.warmup()` on app init, (c) `await client.generate({...})` com try/catch de `ColdStartError` + `RateLimitError`. Incluir retry config examples. | PM Addendum 1 (effort 4-8h justifica doc refletir o trabalho) | Manual review: README é executável (copy-paste funciona contra gateway real) |
| 2.2-AC8 | **Package publishing** — npm pacote `@gemma4/flux-client` com types (d.ts), CJS + ESM builds, versionamento semver. MVP publica em GitHub Packages (privado); public npm opcional. | Epic 2 Scope "TypeScript SDK publicado (npm interno ou github packages)" | `npm pack` gera tarball válido; `npm install @gemma4/flux-client` em projeto test resolve types |

**Definition of Done (2.2):** 8/8 ACs verificados + tests passing + README executável + versão `v0.1.0` publicada em GitHub Packages.

**Effort budget:** 4-8h (Addendum 1). **Se exceder 12h, trigger @pm review** (pode sinalizar hidden complexity → re-evaluate Path B pivot threshold).

### Story 2.3 — Next.js Web Demo (Vercel)

**Rationale:** Demo é a "cara" do Epic 2 para stakeholders e usuários early. UX de first-load é KPI primário do 30-day review (pivot trigger se bounce >40%). Effort estimate **2-4h dev** (PM Addendum 1).

| AC | Descrição | Source | Acceptance test |
|---|---|---|---|
| 2.3-AC1 | **Pre-warm on page visit** — `useEffect()` on page mount dispara `client.warmup()` em background — SEM esperar click de botão. Botão "Generate" permanece disabled até warmup resolver (ou fallback: enabled mas hint sobre cold). | Addendum 4 mitigation #1 | Manual test: abrir DevTools → Network mostra warmup request 0-500ms after page load |
| 2.3-AC2 | **Explicit progress messaging** — UI mostra "Preparing server (one-time setup, up to 2 min)..." com **timer visível** (counter segundos) durante warmup, não spinner genérico. Transições de estado: `warming` → `ready` → `generating` → `done`. Cada estado tem copy próprio. | Addendum 4 mitigation #2 | Acceptance test: captura screenshots nos 4 estados; copy matches specification |
| 2.3-AC3 | **Demo state save** — Session storage persiste último prompt + última image URL entre reloads. Se user abandona durante warmup e volta < 5min depois, state restaurado + warmup já está hot (evita segundo cold). | Addendum 4 mitigation #3 | E2E test: gerar imagem, reload página → prompt e result visíveis sem re-gen |
| 2.3-AC4 | **Day-1 analytics** — Emit events: `warmup_start` (timestamp), `warmup_end` (duration_ms, was_cold), `first_interaction_latency` (page_load → first_image_rendered), `bounce` (user sai antes de primeira imagem). Provider: Vercel Analytics OU POST para endpoint de logging (gateway ou simple Worker). | Addendum 4 mitigation #4 + Addendum 2 data collection requirement | Manual inspect: Vercel dashboard mostra 4 event types após 10 sessões de teste |
| 2.3-AC5 | **Gateway auth flow** — `X-API-Key` embedded em **Next.js server-side** (route handler ou server action), NUNCA exposed em client JS bundle. 429 → UI mostra "Rate limit atingido, try novamente em {X}s" usando `retry_after_seconds` do SDK. | PRD Constraint "Decoupling" + Story 2.5 auth | Build inspect: `grep "API_KEY" .next/static/*` retorna zero matches |
| 2.3-AC6 | **Vercel runtime config** — Route handlers com `export const runtime = 'nodejs'` (não edge) para permitir timeouts 60s+ (generate pode esperar warmup). Explicitly configurado com comentário explicando razão. | ADR R4 mitigation + Vercel docs | Code review: `runtime = 'nodejs'` presente em route que chama `client.generate()` |
| 2.3-AC7 | **First-load-to-interactive SLA** — `<150s` com pre-warm UI, medido via `first_interaction_latency` analytics event (2.3-AC4). Meta P95 em 2026-05-21 review: <120s (considerando pre-warm bem-sucedido). | PRD SLA v0.3 4-layer table | 10 sessões controladas: 9/10 abaixo de 150s total page_load → first image |
| 2.3-AC8 | **Accessibility & mobile** — UI responsive (320px+ viewport), keyboard navigation funcional, `aria-live="polite"` no status messaging (2.3-AC2) para screen readers anunciarem transições. | Vercel best practices + scope "Web demo deployada" | Lighthouse score: Accessibility >= 90; manual test em mobile viewport |

**Definition of Done (2.3):** 8/8 ACs verificados + Lighthouse Accessibility >=90 + deploy em Vercel (preview URL) + analytics dashboard mostrando >=1 sessão de teste completa.

**Effort budget:** 2-4h (Addendum 1). **Se exceder 6h, trigger @pm review** (UX complexity pode justificar Path B pivot antecipado).

### Cross-story invariants (MUST para 2.2 + 2.3)

- **Honrar SLA v0.3 4-layer table** — cold 180s timeout, warm <10s p95, subsequent warm <10s, first-load <150s
- **Zero hardcoded RunPod URL** — SDK e demo chamam APENAS gateway URL (Story 2.5). RunPod endpoint URL vive só no Cloudflare Worker secret.
- **Emit analytics from day 1** — sem analytics, 2026-05-21 review não tem evidence para decidir pivot Path B; isso é blocking para close de 2.3.
- **Dev effort honesty** — se @dev estimates do draft exceedem budgets acima em >50%, escalar para @pm antes de commit (Addendum 1 effort boundary).

## Constraints (cross-story — v0.2 updated)

- **Latência warm:** target <10s p95 — **CONFIRMED atingível** (Story 2.1 mediu p95=7.0s com n=100 em 2026-04-20). SLA primário pro Epic 2.
- **Latência cold:** target original <30s p95 **INVALIDADO empiricamente**. Story 2.1 mediu 98-150s true cold com Opção A (network volume). **ADR-0001 em Story 2.1.2** decidirá path: accept-as-is (SDK tem retry UX), bake-in image (cold ~15-25s, +~25GB image), workersMin=1 standby (~$16-45/mês). **Até ADR decidir, SDK deve assumir cold ~2min worst-case.**
- **Custo inferência:** **$0.0015/img warm** (calibrado Story 2.1 — $0.000306/s × ~5s/img). Originalmente projetado $0.0006/img (2.5x otimista). Novo orçamento base ver Cost Projection v0.2 abaixo.
- **Custo MVP:** orçamento **~$25/mo** (revisado de $20/mo) por causa da calibração. Ainda DRAMATICAMENTE abaixo de Pod 24/7 ($500/mo). Trigger pra escalar: >15.000 imgs/mês sustentado (revisado de 20k).
- **Licença:** FLUX.1-schnell = Apache 2.0 (commercial OK). Manter.
- **Auth:** API key fixa via header X-API-Key no MVP. Validada no gateway (Story 2.5), NÃO no endpoint serverless direto.
- **Rate Limit:** 100 imagens/dia GLOBAL no gateway. HTTP 429 + Retry-After. Reset 00:00 UTC. SDK interpreta 429.
- **Hosting consumer:** Vercel (Next.js) MVP.
- **Hosting gateway:** Cloudflare Worker + KV (free tier). Endpoint serverless NUNCA exposto publicamente.
- **Decoupling:** SDK chama gateway URL, não RunPod direto.
- **NEW (v0.2): Input validation strictness** — post Story 2.1.1, handler rejeita `steps=0`/`width=0` explicitamente (não coerção silenciosa). SDK (Story 2.2) deve usar types estritos para garantir contract.

## Cost Projection (MVP — v0.2 CALIBRATED)

### Warm-only baseline (realista, Epic 2 MVP comportamento típico)

Assumindo SDK faz retry inteligente em cold (primeira request fica slow; subsequentes warm), **warm dominates real traffic**:

| Item | Custo/mês estimado (v0.2) | v0.1 (legacy) |
|---|---|---|
| RunPod Serverless inferência (1.000 imgs/mês × ~$0.0015/warm) | **$1.50** | $0.60 (2.5x menor) |
| RunPod Serverless inferência (10.000 imgs/mês) | **$15** | $6 |
| Cold-spawn overhead (estimativa ~5% das requests hitting cold × ~$0.03 each = $1.50/1k) | **+$1.50** (em 1k imgs) | não contabilizado |
| Vercel free tier (frontend demo) | $0 | $0 |
| Network volume `mqqgzwnfp1` (100GB US-IL-1) | ~$5 | ~$5 |
| Pod self-hosted GPU (on-demand dev/treino) | $0.69/h × usage | mesmo |
| Cloudflare Worker + KV (gateway) | $0 (free tier) | $0 |
| **Total MVP COM rate-limit 100/dia (~3k imgs/mês max)** | **~$10/mo** ($4.50 inferência worst-case + $5 storage Pod) | ~$10/mo (otimista) |
| **Total scaled 10k/mês** | **~$25/mo** | ~$20/mo |

### Cold-start cost detail (se muitos idle periods)

Com Opção A (network volume) cold é ~$0.03/cold (100s × $0.000306/s). Cada idle >5s depois nova request vira cold. Em traffic padrão esporádico:
- **Low traffic** (10 req/dia spaced): 10 × $0.03 cold + 0 warm + ~$0 otras = ~$0.30/dia = **$9/mês só inferência** (cold-dominated)
- **Medium traffic** (50 req/dia): 5-10 colds + 40-45 warm = $0.20 + $0.07 = ~$0.27/dia = **$8/mês**
- **High traffic** (100 req/dia cap): 1-2 colds + 98 warm = ~$0.15/dia = **$4.50/mês**

**Insight:** tráfego low-esparso é MAIS CARO que high-batch porque cada request paga cold. ADR-0001 path B ou C (eliminating cold) pode inverter a lógica econômica para low-volume consumers.

### Cap de custo via rate-limit

Com 100 imgs/dia globais + pior caso cold-dominated:
- 100 × $0.03/cold = **$3/dia máximo = $90/mês** (worst case matemático)
- Realista (mix 20% cold + 80% warm): ~$0.12 × 100 = $12/dia × 30 = **$360/mês SE todos os dias maxed out** (unrealistic — rate-limit pressupõe ocasional abuse, não sustained max)

**Nova proposta cap operacional:** além de 100/dia hard cap, adicionar monitoring de **$10/dia alert** via RunPod billing email.

**Trigger de revisão:** >$30/mês sustentado por 2 semanas = repensar (pivot cold strategy? rate-limit mais tight? Pod dedicated warm?).

## Risk Register (v0.2 — realidade medida)

| ID | Risco | Status v0.2 | Mitigação |
|---|---|---|---|
| R1 | ~~RunPod Serverless cold start >30s arruína UX~~ | **🔴 REALIZED** (medido 98-150s) | **Ativa em Story 2.1.2 ADR-0001** — 3 paths: accept+SDK-retry / bake-in / standby |
| R2 | API key vazada → custo descontrolado | Ativa | Rotação documentada + monitoring de spike (Story 2.5 ou ops debt) |
| R3 | RunPod Serverless deprecates FLUX template | Ativa | SDK abstraído permite swap pra Replicate em <1 dia |
| R4 | Vercel tem timeout 60s edge → não combina com cold spawn de ~150s | Mitigado por ADR-0001 Path A (v0.4) | **Story 2.2** SDK implementa retry-with-backoff + `warmup()` helper (2.2-AC2/AC3). **Story 2.3** demo chama `warmup()` on page visit + configura route handler com `runtime = 'nodejs'` (2.3-AC1/AC6). **Pre-warm é responsibility do SDK/demo, NÃO do gateway** — Story 2.5 "no change required" per ADR-0001 Impact on Downstream Stories. |
| R5 | Custo escala mais rápido que receita | Ativa | Volume threshold **$30/mo** (revisado de $50 pra refletir projeção calibrada) dispara review |
| R6 | Gateway down → endpoint serverless inacessível (single point of failure) | Ativa | Cloudflare 99.99% SLA; fallback documentado |
| R7 | KV counter race condition em pico (2 requests no mesmo ms) | Ativa (baixa prob) | Aceitar overshoot de 1-2 imgs/dia |
| R8 | Rate limit bypass se atacante descobre endpoint serverless URL direto | Ativa | RUNPOD_API_KEY como secret do Worker |
| **R9** (NEW) | Cost projection 2.5x off arruinou budgets de consumers downstream | Mitigada via v0.2 calibration | PRD agora tem cost real-world ($0.0015/warm); consumers Epic 2 podem orçar corretamente |
| **R10** (NEW) | Image v0.1.0 em produção tem bug L1 (`steps=0` silent default) | Fix pronto, redeploy pendente | Story 2.1.1 closure inclui redeploy atomic op + smoke validation |
| **R11** (NEW) | Low-traffic pattern vira cold-dominated, caro por imagem | Ativa | ADR-0001 avalia workersMin=1 standby pra use cases steady-trickle; accept pra batch-heavy |

## 30-Day Review Governance (v0.4)

> Formaliza ADR-0001 Addendum 2 como **governance gate** executável. Não é checkpoint vago — tem DRI, métricas com thresholds, e decisão binária (pivot ou stay-course).

### Review Gate Metadata

| Campo | Valor |
|---|---|
| **Target date** | 2026-05-21 (30 dias pós ADR-0001 approval) |
| **DRI** (owner responsável por coletar evidence + disparar review) | **@pm (Morgan)** — per v0.4 assignment |
| **Decision authority** | @pm (primary) + @architect (advisory se pivot requerido) |
| **Artifact output** | `docs/architecture/adr-0001-flux-cold-start-review-2026-05-21.md` (addendum ao ADR original, reverso NÃO substitui) |
| **Escalation** | Se >1 pivot trigger HIT simultaneamente → escalar para @aiox-master governance review |

### Pivot Triggers (HIT em qualquer = considerar Path B)

Trigger Path B (bake-in image) pivot **se ANY dos 4 criteria forem satisfeitos**:

| # | Métrica | Threshold pivot | Data source | DRI coleta |
|---|---|---|---|---|
| **PT1** | Volume sustentado | >1000 imgs/mo por 2+ semanas consecutivas | RunPod billing API `GET /billing/endpoints?endpointId=80e45g6gct1opm` | @pm (semanal export) |
| **PT2** | Bounce rate web demo | >40% em sessions que entraram em pagina demo | Story 2.3 analytics event `bounce` (AC 2.3-AC4) | @pm (via Vercel Analytics dashboard) |
| **PT3** | Cold latency sustained | p95 >180s em re-bench n≥10 executado pré-review | `serverless/tests/bench-cold-2026-05-21.json` (novo; resolve QA Gate O1) | @dev (script automation) |
| **PT4** | Customer complaints | >3 issues explícitos sobre first-use latency em 30 dias | GitHub Issues triage + Linear (se ativo) + direct feedback | @pm (issue triage semanal) |

### Stay-Course Criteria (ALL 4 HIT = Path A confirmado, continuar)

Manter Path A **se TODOS os 4 criteria forem satisfeitos**:

| # | Métrica | Threshold stay-course | Data source |
|---|---|---|---|
| **SC1** | Volume | <500 imgs/mo sustentado | RunPod billing (mesmo source PT1) |
| **SC2** | SDK retry success | >95% das requests que hit cold eventualmente succeed via retry (dentro do SLA 180s) | SDK analytics ou gateway logs (implementar instrumentation em Story 2.5 ou como append para 2.2) |
| **SC3** | Demo UX acceptance | User testing qualitativo (≥3 sessões observadas) aceita first-load-to-interactive | @pm + @ux-design-expert review session pré-2026-05-21 |
| **SC4** | Cost trending | <$15/mo em inferência + storage combined | RunPod billing mensal + network volume monthly fee |

### Outcome Matrix

| Pivot triggers HIT | Stay-course criteria HIT | Decision |
|---|---|---|
| 0 | 4 | **Stay Path A** — continuar, próximo review em 60 dias |
| 0-1 | 2-3 | **Conditional stay** — identificar criterion missing, single-sprint fix plan, re-review em 14 dias |
| 1-2 | ≤2 | **Consider Path B** — @pm escalate para @architect, draft Story 2.1.3 bake-in implementation (1-2 dev-days per ADR Reversibility plan) |
| ≥2 | any | **Pivot Path B immediately** — @sm draft Story 2.1.3 em 48h; pause Stories 2.2/2.3 completion até bake deploy |
| ≥3 | any | **ESCALATE to @aiox-master** — Path A fundamentally wrong; re-open ADR-0001 com revision verdict |

### Pre-Review Checklist (@pm responsibility — 2026-05-15 deadline)

- [ ] Export RunPod billing monthly data (30-day window)
- [ ] Export Vercel Analytics for Story 2.3 demo (warmup events + bounce)
- [ ] Execute cold re-bench n≥10 (@dev coordination; resolves QA Gate O1)
- [ ] Collect user testing feedback (≥3 sessions; @ux-design-expert se disponível)
- [ ] Triage GitHub Issues / Linear tickets tagged `cold-start` ou `latency`
- [ ] Compile evidence pack em `docs/qa/adr-0001-review-evidence-2026-05-21/`

### Data Collection Automation (v0.4 backlog)

Para reduzir manual effort pré-review (Addendum 2), considerar:

- **RunPod billing cron** — script `scripts/runpod-billing-export.sh` rodando weekly via GitHub Actions; dumps JSON para `docs/ops/billing-logs/`
- **Analytics webhook** — Story 2.3 emite eventos para endpoint Cloudflare Worker (pode ser mesmo Worker da Story 2.5); KV storage para query
- **Issue labels** — criar labels GitHub `cold-start`, `latency-complaint`, `demo-ux` para facilitar triage

**Status automação:** backlog (nice-to-have); MVP review pode rodar manual se automation não for implementada até 2026-05-15.

## Dependencies on Epic 1 (legacy)

- **Pod self-hosted** continua existindo — usado pra **dev/teste de novos modelos** antes de empacotar como Serverless endpoint.
- **`pod.sh`** (script de controle) reusado em workflows dev.
- **Docs/usage/comfyui-flux-quickstart.md** vira referência interna (workflow JSON usado é o mesmo do endpoint serverless).
- **`/workspace/.hf-token`** no Pod permite testar com modelos gated antes de empacotar.

## Measurement Log (v0.2 — realidade observada)

Dados reais de Story 2.1 que calibraram esta PRD:

| Métrica | Projetado v0.1 | Medido (Story 2.1) | Source |
|---|---|---|---|
| Warm p95 | <10s | **7013ms** (n=100, 2026-04-20) ✅ | `bench-results-1776789792.json` + Dev Agent Record |
| Warm p50 | — | 5212ms | idem |
| Cold p95 | <30s | **~150s** (n=2 true cold) ❌ | idem |
| Image size | <15GB | 7.75GB ✅ | `docker inspect` |
| Rate efetivo GPU | $0.0006/img | **$0.000306/s × ~5s = $0.0015/img** (2.5x) | RunPod billing API GET /billing/endpoints |
| Success rate (warm) | — | 98-100% | bench |

**Evidence files:**
- `serverless/tests/bench-results-1776789792.json` — 5-cold bench
- `serverless/tests/bench-results-2.1.1-regression-1776803835.json` — 100-warm regression bench
- `docs/stories/2.1.runpod-serverless-flux-endpoint.story.md` seção "Dev Agent Record" — métricas raw

## References

- Epic 1: `docs/prd/epic-1-pod-inference-stack.md`
- Story 1.1 closure: `docs/qa/1.1-closure-summary.md`
- **Story 2.1**: `docs/stories/2.1.runpod-serverless-flux-endpoint.story.md` (Done, QA CONCERNS 8.2/10)
- **Story 2.1.1**: `docs/stories/2.1.1.fix-serverless-qa-concerns.story.md` (Ready for Review, QA PASS 9.4/10)
- **Story 2.1.2**: `docs/stories/2.1.2.decide-cold-start-mitigation.story.md` (Ready, spike ADR)
- **Story 2.5**: `docs/stories/2.5.gateway-rate-limit-cloudflare.story.md` (Ready)
- **ADR-0001** (Accepted 2026-04-21 with 4 PM addenda): `docs/architecture/adr-0001-flux-cold-start.md`
- **QA Gate Story 2.1.2** (PASS 95/100, 2026-04-21): `docs/qa/gates/2.1.2-decide-cold-start-mitigation.yml`
- Discovery PM 2026-04-21 (Epic 2 v0.1 draft)
- RunPod Serverless docs: https://docs.runpod.io/serverless/overview
- FLUX.1-schnell HF: https://huggingface.co/black-forest-labs/FLUX.1-schnell
- Constitution AIOX: `.aiox-core/constitution.md`

## Quality Gates

- Article IV (No Invention): cada decisão técnica neste PRD trace pra discovery answer ou métrica observada (smoke test 3.1s warm de Story 1.1, etc.)
- Article V (Quality First): success criteria mensuráveis (latência, custo, presença de auth) — não vagas
- CodeRabbit: integração disabled em core-config (esperado dado escopo greenfield); revisar pré-Story 2.3 se virar codebase relevante
