# Epic 2 — Consumer Integration (Hybrid Pragmatic)

**Status:** In Progress (v1.0 — Story 2.7 Done + Story 2.8 Sanitize Public Docs added; Story 2.3 web demo + Story 2.8 remain in-scope)
**Owner:** @pm (Morgan)
**Created:** 2026-04-21
**Last Updated:** 2026-04-23 (v1.0)
**Project:** servegate (codename gemma4)
**Predecessor:** Epic 1 (Pod Inference Stack — Done em 2026-04-21)

### Changelog

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1 | 2026-04-21 | @pm Morgan | Initial draft — pre-implementation, projections ungrounded |
| 0.2 | 2026-04-21 | @pm Morgan | **Post Story 2.1 update** — cost projection calibrada com medição real (+2.5x), cold start realism (AC5 gap documentado), stories 2.1.1 + 2.1.2 adicionadas, cold SLA deferido para ADR-0001 |
| 0.3 | 2026-04-21 | @pm Morgan | **Post ADR-0001 approval** — Path A accepted (accept cold, solve via client UX). Cold SLA: warm <10s p95 (primary), cold ~130s first-invocation after idle (secondary, mitigated via SDK warmup + demo pre-warm). Path B reserved as reversible pivot (1-2 dev-days). 30-day review 2026-05-21 with measurable criteria. |
| 0.4 | 2026-04-21 | @pm Morgan | **Post QA gate 2.1.2 PASS** (95/100) — Added preliminary ACs for Stories 2.2 (SDK) + 2.3 (demo) derived from ADR-0001 Impact + PM Addenda 1+4; @sm can now draft both stories with anchored scope. Risk R4 aligned with ADR "no change Story 2.5" (pre-warm = SDK responsibility, not gateway). New "30-Day Review Governance" section formalizing 4 pivot triggers + 4 stay-course criteria + DRI assignment (**@pm owns data collection until 2026-05-21**: RunPod billing, demo analytics, issue triage). Resolves QA gate observations O2/O3/O4. |
| 0.5 | 2026-04-21 | @po Pax | **Batch close 3 stories** (PM-approved): 2.1.1 (QA 9.4/10), 2.1.2 (QA 95/100), 2.2 (QA 92/100, merged PR #1). Stories table updated. Dependency graph repintado para refletir único caminho crítico restante (publish 2.2 → 2.5 → integ smoke → 2.3). New "Tech Debt Backlog" section com 7 items priorizados: TD1 publish (HIGH, @devops imediato), TD2 integ smoke (MEDIUM, @qa), TD3 redeploy v0.1.1 (MEDIUM, @devops), TD4 re-bench cold n≥10 (LOW, @dev pre-2026-05-15), TD5-TD7 SDK refinements (LOW, @dev). Total tech debt budget ~6-9h (HIGH+MEDIUM ~3-4h). |
| 0.6 | 2026-04-21 | @devops Gage | **TD1 resolution + scope rename** — GitHub Packages requires scope match com repo owner. Repo é `Jhonata-Matias/gemma4` (não org Gemma4). Decision: rename SDK scope `@gemma4/flux-client` → `@jhonata-matias/flux-client` (project codename "gemma4" preserved em description + branding). Files updated: sdk/package.json, sdk/src/{index,errors,types}.ts JSDoc, sdk/README.md, docs/stories/2.3 (4 refs). NÃO atualizado: Story 2.2 Done (historical), QA Gate 2.2 (final), ADR-0001 (final). TD1 resolvido (publish unblocked). |
| 0.7 | 2026-04-22 | @pm Morgan | **Story 2.6 added** — Alpha Developer Access Distribution. Post Story 2.5 merge (PR #2, commit 9d1f100) + Epic 1 closure, a última milha para devs externos conseguirem `npm install → first call` sem hand-holding manual. Strategic decision: SDK GH Packages → **public visibility** (fricção mínima; zero secret exposure since gateway guarda RUNPOD_API_KEY). Scope: SDK public flip + README raiz + issue templates + owner contact + GH release v0.1.0-alpha + API reference consolidado + smoke externa. 7 preliminary ACs, effort budget 1-2 dev-days. TD8 adicionado: zero CI workflows em `.github/workflows/` (LOW severity). @sm para draft. |
| 0.8 | 2026-04-22 | @pm Morgan | **Story 2.6 Done** (QA PASS 91/100, merged PR #3, commit `fd1232b`) + **`v0.1.0-alpha` released** (GitHub Release marked Pre-release, tagged em `fd1232b`, 2026-04-22 19:53 UTC). Alpha is **publicly accessible** — external devs can: discover via README → request access via formal `access-request.yml` template → install `@jhonata-matias/flux-client` (public on GH Packages) → first call ~7s warm / ~130s cold. F1 (broken license badge) resolved pre-merge; F2 (issue template public-visibility warning) deferred as follow-up issue (LOW-MEDIUM, non-blocking). External smoke validated end-to-end in Docker `node:20` clean container — auth + rate-limit pipeline proven (architectural auth-before-rate-limit confirmed via 401-not-429 on invalid key when quota=0). Epic 2 status: **80% MVP shipped** (5 of 6 in-scope stories Done) — only Story 2.3 web demo remains; not blocking SDK consumer adoption but required for 30-day review analytics (R4 mitigation). |
| 0.9 | 2026-04-22 | @pm Morgan | **Story 2.7 added** — Portuguese (Brazil) Developer Documentation (MVP). Audience research aponta mercado BR como vetor inicial de adoção alpha; dev-onboarding EN-only cria fricção de comprehension + risco legal em TERMS/PRIVACY (CDC exige clareza pt-BR para consumidor BR). Scope MVP: traduzir 4 arquivos da jornada crítica (`README.md`, `docs/usage/dev-onboarding.md`, `docs/legal/TERMS.md`, `docs/legal/PRIVACY.md`) com sufixo `.pt-BR.md` + banner bilíngue no topo. Strategic decisions alinhadas com user (2026-04-22): (a) **ambos canônicos bilíngue** em legal via cláusula de equivalência (prevalece versão do domicílio do usuário), (b) **anglicismos técnicos preservados** (API key, endpoint, rate limit, cold start, deploy) — prosa natural para dev BR. 7 preliminary ACs, effort budget 4-6h dev. Out of scope: API reference + usage secundários + PRD/stories → Epic 3 backlog se demanda BR confirmar. @sm para draft. |
| 1.0 | 2026-04-23 | @pm Morgan | **Story 2.7 Done** (QA PASS 95/100, merged PR #5, commit `6a3508d`) + **Story 2.8 added** — Sanitize Public Docs per Security Audit. Post-merge governance review revealed significant **business intelligence exposure** in public repo (unit economics, infra IDs, pivot thresholds, real measurements) que estava visível desde 2026-04-22 (public flip na Story 2.6). User-triggered security audit (`docs/qa/security-audit-2026-04-22.md` no planning repo) documentou gap: pre-public audit (#3535) focou só em secret leakage (PASS — zero leaks) mas não em business intel. Remediação decidida: **L1+L2 combined** — emergency remove internal docs do público (commit `e290bcd` 2026-04-23) + Story 2.8 reintroduz versões sanitizadas per 7 regras definidas em Section 7 do audit. Two-repo architecture introduzida: `Jhonata-Matias/servegate` (public, sanitized post-2.8) + `Jhonata-Matias/servegate-planning` (private, preserva originais pre-sanitização). Story 2.8: 7 preliminary ACs, effort budget 4-6h, @dev reads originals from planning remote, writes sanitized to public. Epic 2 status: **6 of 8 in-scope stories Done** (~75% — 2.7 fechou, 2.3 web demo + 2.8 sanitize pendentes). |

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
- [x] **TypeScript SDK publicado** com tipagem completa — Story 2.2 Done (QA 92/100); Story 2.6 v0.8 flipped visibility para **public** em GitHub Packages
- [ ] App demo deployada em Vercel mostrando: input prompt → image em <10s — **Story 2.3 (Ready, unblocked, not yet shipped)**
- [x] **Auth via X-API-Key bloqueia requests sem header válido (HTTP 401)** — Story 2.5 Done (QA 88/100); validated end-to-end via Story 2.6 external smoke (architectural auth-before-rate-limit proof)
- [ ] **Custo MVP <$20/mês** — pendente medição real pós-volume (target 30-day review 2026-05-21); cap operacional via 100/dia rate-limit já em vigor
- [x] **Documentação cobre: deploy serverless, integração SDK, customização frontend** — Story 2.6 v0.8 entregou: `docs/usage/dev-onboarding.md` (5-step quickstart), `docs/api/reference.md` (HTTP contract), `sdk/README.md` (TS), `examples/colab/README.md` (Python), `docs/usage/gateway-deploy.md` (ops), `docs/usage/monitoring.md` (runbook). Frontend customization docs deferred to Story 2.3 web demo.
- [x] Pod self-hosted continua acessível via `pod.sh up` pra dev (não foi quebrado) — validado Story 2.1
- [x] **(NEW v0.8) External developer access distribution** — Story 2.6 Done: SDK public, root README, formal issue templates (access-request flow), owner contact published, `v0.1.0-alpha` release tagged. External devs can complete onboarding without owner hand-holding.

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
| **2.1.1** | Fix serverless endpoint QA concerns (deploy idempotent + input validation + robustness + unit tests) | **HIGH** | @dev | **Done** (QA PASS 9.4/10; redeploy v0.1.1 = tech debt MEDIUM, neutralizado via SDK AC1) |
| **2.1.2** | Decide cold-start mitigation strategy (ADR-0001) | **HIGH** | @architect + @pm | **Done** (Path A approved; QA PASS 95/100; ADR + PRD v0.4 deliverables) |
| **2.2** | Implementar TypeScript SDK `@gemma4/flux-client` consumindo o endpoint | **MUST** | @dev | **Done** (QA PASS 92/100; merged via PR #1 squash; publish é tech debt HIGH @devops) |
| **2.5** | Gateway Cloudflare Worker + KV pra auth (X-API-Key) + rate-limit 100/dia global | **MUST** | @dev | **Ready** (validada @po 9.75/10) — pode rodar paralela a 2.3 |
| **2.3** | App demo Next.js + Vercel usando SDK contra gateway URL | **MUST** | @dev (+ @ux opcional) | **Ready** (PO 10/10 — bloqueada por SDK published + 2.5 Done) |
| **2.6** | Alpha Developer Access Distribution (SDK public + README raiz + issue templates + GH release + API reference) | **MUST** | @dev (+ @devops para release/visibility) | **Done** (QA PASS 91/100, merged PR #3 commit `fd1232b`, `v0.1.0-alpha` released) |
| **2.7** | Portuguese (Brazil) Developer Documentation MVP (README + dev-onboarding + TERMS + PRIVACY com sufixo `.pt-BR.md` + banner bilíngue) | **SHOULD** | @dev | **Done** (QA PASS 95/100, merged PR #5 commit `6a3508d`) |
| **2.8** | Sanitize Public Docs per Security Audit (reintroduzir PRDs/stories/QA gates/ADR com business intel sanitized: endpoint IDs → placeholders, unit costs → ranges, pivot thresholds → qualitativos) | **HIGH** | @dev | **Draft** (v1.0 — aguardando `@sm *draft 2.8`) |
| **2.4** | (Opcional) Custom node n8n integrando o SDK | SHOULD | @dev | **Backlog** opportunistic |

### Dependency graph atualizado (v1.0 — Story 2.7 Done + Story 2.8 Sanitize added)

```
2.1 (Done) → 2.1.1 (Done) → 2.1.2 (Done) → 2.2 (Done, public)
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                       2.5 (Done — PR #2)              2.6 (Done — PR #3 + v0.1.0-alpha)
                              │                               │
                              └─────────────┬─────────────────┘
                                            ▼
                              ┌─────────────┴─────────────┐
                              ▼                           ▼
                     2.3 (Ready — optional ship)   2.7 (Done — PR #5 pt-BR MVP)
                              │                           │
                              │                           ▼
                              │                    [security audit trigger]
                              │                           │
                              │                           ▼
                              │                    2.8 (Draft — Sanitize)
                              │                           │
                              └─────────────┬─────────────┘
                                            ▼
                                   Epic 2 Close candidate
```

**Status flow (v1.0):**
- ✅ 2.1 / 2.1.1 / 2.1.2 / 2.2 / 2.5 / 2.6 / 2.7 — all Done (7 stories)
- 🔓 **2.3 — Ready, fully unblocked** (SDK public ✓, gateway live ✓, contact channel ✓, API reference ✓) — not blocking Epic 2 close per alternative path
- 🔴 **2.8 — Draft (v1.0) — HIGH priority** — triggered by security audit post-2.7 merge; sanitization of internal docs that currently exist only in private `servegate-planning` mirror; re-introduce to public with business intel replaced per 7 rules
- 📊 30-day review (2026-05-21) requires Story 2.3 analytics for full DRI evidence pack — see "30-Day Review Governance"

**Epic 2 status (v1.0):** **~75% MVP shipped** (6 of 8 in-scope stories Done — 2.1/2.1.1/2.1.2/2.2/2.5/2.6/2.7). Alpha publicly accessible to SDK consumers. Remaining in-scope: Story 2.3 web demo + Story 2.8 Sanitize Public Docs. Story 2.8 é **HIGH priority** (reduces competitor intel exposure in public repo) e bloqueia "Epic 2 full close" mesmo se 2.3 ship separadamente.

**Remaining MVP path (v1.0):**
1. **`@sm *draft 2.8`** (this v1.0 delivery) → `@po *validate` → `@dev *develop` (reads originals from `planning` remote, writes sanitized to `origin`) → `@qa *qa-gate` → `@devops *push + *create-pr` (4-6h total per security audit effort estimate)
2. **`@sm *draft 2.3`** (already drafted — validate Ready state) → @dev develop (2-4h) → QA gate → push + PR. Pode correr paralelo a 2.8.
3. **Close Epic 2 fully** com declaration after 2.3 + 2.8 shipped. Optional **L3 history rewrite** post-2.8 for total pre-sanitization removal from public git history (viable given 0 forks verified 2026-04-23).
4. **30-day review automation** (optional TD enhancement for Vercel Analytics + RunPod billing cron)

**Alternatively (deferred Epic 2 close path):** if 2.3 web demo is deprioritized (e.g., SDK consumers are sufficient market validation), Epic 2 can close at 80% with explicit "Story 2.3 → Epic 3 (frontend showcase) or Backlog" decision. Requires @user input.

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

### Story 2.6 — Alpha Developer Access Distribution

**Rationale:** Epic 2 entregou gateway (2.5) + SDK (2.2) + docs (dev-onboarding, legal, monitoring), mas faltam as últimas peças de distribuição e discovery pública. Story 2.6 fecha o gap "repo encontrado → primeira chamada funcionando" sem hand-holding manual do owner a cada onboarding. Effort estimate **1-2 dev-days** (sem código novo — config, docs, release hygiene).

**Strategic decision (PRD v0.7):** SDK GitHub Packages → **public visibility**. Justificativa: zero secret no SDK (gateway guarda RUNPOD_API_KEY); fricção mínima para alpha (3-5 devs target); modelo invite-only do GATEWAY_API_KEY mantém controle de quota. Beta futuro pode migrar para npm público oficial.

| AC | Descrição | Source | Acceptance test |
|---|---|---|---|
| 2.6-AC1 | **SDK public visibility** — `@jhonata-matias/flux-client` mudado de `private` → `public` em GitHub Packages. README e dev-onboarding atualizados removendo step "owner adiciona collaborator" se aplicável. | PRD v0.7 strategic decision | `npm view @jhonata-matias/flux-client --registry=https://npm.pkg.github.com` retorna metadata **sem auth**; em VM/container limpa, `.npmrc` + `npm install` funciona com qualquer GITHUB_TOKEN tendo `read:packages` |
| 2.6-AC2 | **Root README.md** — landing page do repo com: project name + tagline alpha, status badge, 3-bullet "what is this / for whom / status", quickstart link → `docs/usage/dev-onboarding.md`, links legal (TERMS/PRIVACY), Contact section, license badge. Render check via GitHub. | Gap análise PM 2026-04-22 (zero README raiz hoje) | GitHub repo landing mostra README renderizado; outsider lê em <2min e sabe próximo passo |
| 2.6-AC3 | **Issue templates** — `.github/ISSUE_TEMPLATE/` com 3 YAML forms: `access-request.yml` (campos required: name, GH username, use case, expected volume, ToS+Privacy checkboxes — espelha dev-onboarding step 1), `bug-report.yml` (env, repro, expected vs actual), `feature-request.yml` + `config.yml` para opcional Discussions link | dev-onboarding step 1 documentou template textual, faltava formalizar | Botão "New Issue" no GitHub mostra 3 opções selecionáveis; submit de access-request bloqueia sem campos required preenchidos |
| 2.6-AC4 | **Owner contact public** — seção "Contact" no README raiz + mirror em `sdk/README.md`: canal preferido (GitHub issue), fallback (email opcional ou GitHub DM), SLA alpha (3-7 business days), expectativa "personal project — best effort" | dev-onboarding menciona "Signal/encrypted email" mas owner contact nunca foi documentado público | Outsider acha "como contatar owner" em <30s da landing; método de entrega de API key documentado |
| 2.6-AC5 | **GitHub Release v0.1.0-alpha** — tag git `v0.1.0-alpha` em commit `9d1f100` (merge Story 2.5) + GitHub Release com notes: resumo Epic 1 + 2 deliverables, links para SDK CHANGELOG, dev-onboarding, ToS/Privacy. Marked "Pre-release". | Versionamento + linha de base para breaking change tracking; primeira release pública | Release visível em `https://github.com/Jhonata-Matias/gemma4/releases/tag/v0.1.0-alpha`; tag presente em `git tag -l` |
| 2.6-AC6 | **API reference consolidado** — `docs/api/reference.md` único doc cobrindo: gateway base URL, endpoint `POST /` + body schema, headers (`X-API-Key`, `Content-Type`), response codes (200/401/405/429/502/504) com payloads exemplo, rate-limit headers (`X-RateLimit-Limit/Remaining/Reset`, `Retry-After`), curl quickstart end-to-end, link cruzado para SDK README (TS) + Colab example (Python). | Hoje fragmentado entre SDK README + gateway-deploy.md + Story 2.5 — sem single source of truth para API contract | Curl example da reference, copy-paste no terminal, gera imagem real contra gateway live; reviewer externo (não-owner) executa sem dúvidas |
| 2.6-AC7 | **External smoke validation** — todos os 5 steps do `docs/usage/dev-onboarding.md` executados **em ambiente limpo por perfil diferente do owner** (segunda conta GitHub, colaborador, ou container Docker zerado): request key → instalar SDK → configurar → primeira imagem → handle de erros. Documentar em `docs/qa/2.6-external-smoke.md` com timing de cada step + gaps descobertos. | Validation real de "external dev journey" — único sinal honesto de que onboarding funciona end-to-end | Smoke doc mostra 5/5 steps PASS com imagem PNG gerada; gaps descobertos viram follow-up issues (não bloqueiam 2.6 close se onboarding completou) |

**Definition of Done (2.6):** 7/7 ACs verificados + SDK package mostra `public` em GitHub UI + Release tag v0.1.0-alpha visível + smoke externa documentada em `docs/qa/2.6-external-smoke.md` + Epic 2 PRD updated para v0.8 com Story 2.6 closure note.

**Effort budget:** 1-2 dev-days. **Se exceder 3 days, trigger @pm review** (provável que esteja escopo creeping para CI/Release automation que pertence a TD8).

**Out of scope (Story 2.6):**
- CI/CD workflows (`.github/workflows/`) — vai como TD8 (LOW)
- npm registry público oficial — beta scope
- Public Discussions / Discord — beta scope (alpha usa GitHub Issues)
- Status page / health endpoint público — futuro (não mais referenciado como "Story 2.7" — 2.7 reatribuída a pt-BR docs em v0.9)
- Métricas públicas de uso (% quota consumido) — futuro

### Story 2.7 — Portuguese (Brazil) Developer Documentation (MVP)

**Rationale:** Story 2.6 estabeleceu discovery pública da alpha com docs EN-only. Owner é BR; alpha invites iniciais são devs BR; dev-onboarding em EN cria fricção de comprehension + risco legal em TERMS/PRIVACY (CDC brasileiro exige clareza em pt-BR para consumidor domiciliado no BR). Scope MVP reduzido aos 4 arquivos da jornada crítica — README raiz, dev-onboarding, TERMS, PRIVACY — mantendo outros docs (API reference, usage secundários, internos) em EN. Effort estimate **4-6h dev** (prosa + banners + cláusulas + cross-link consistency + review).

**Strategic decisions (v0.9, aligned with user 2026-04-22):**
- **Estrutura:** sufixo `.pt-BR.md` ao lado do arquivo EN canônico (ex: `dev-onboarding.md` + `dev-onboarding.pt-BR.md`). Padrão usado por Vue, Astro, Tailwind — baixo impacto em links existentes, GitHub renderiza bem.
- **Canonical:** **ambos canônicos (bilíngue)** em legal (TERMS + PRIVACY) via cláusula de equivalência: "em caso de divergência, prevalece a versão correspondente ao domicílio do usuário". dev-onboarding e README também bilíngues (não há divergência possível — são técnico-informativos).
- **Estilo:** **anglicismos técnicos preservados** — `API key`, `endpoint`, `rate limit`, `cold start`, `deploy`, `request`, `response`, `gateway`, `SDK`, `npm install`, `token`, `header` ficam em EN. Prosa conectiva (artigos, verbos, preposições) em pt-BR natural para dev. Comandos, valores e nomes próprios preservados literalmente.

| AC | Descrição | Source | Acceptance test |
|---|---|---|---|
| 2.7-AC1 | **pt-BR files created (4)** — `README.pt-BR.md` (raiz), `docs/usage/dev-onboarding.pt-BR.md`, `docs/legal/TERMS.pt-BR.md`, `docs/legal/PRIVACY.pt-BR.md`. Padrão de nome: `<nome>.pt-BR.md` ao lado do arquivo EN canônico. Encoding UTF-8 sem BOM, line endings LF. | User decision 2026-04-22 (escopo MVP: 4 arquivos) | `ls docs/legal/*.pt-BR.md docs/usage/*.pt-BR.md README.pt-BR.md` retorna os 4 paths; render GitHub funciona; `file <path>` reporta UTF-8 |
| 2.7-AC2 | **Language switcher banner** — cada um dos 4 arquivos EN + 4 pt-BR recebe banner no topo (logo após H1 título), formato padrão: no EN → `> 🌐 **English** \| [Português (Brasil)](./<nome>.pt-BR.md)`; no pt-BR → `> 🌐 [English](./<nome>.md) \| **Português (Brasil)**`. Link relativo com `./` para funcionar tanto em GitHub quanto em cópia local/raw. README raiz aponta para `./README.pt-BR.md` (não precisa prefixo `docs/`). | User decision 2026-04-22 (estrutura: sufixo + banner topo) | Manual render GitHub: banner visível logo abaixo do H1, link clicável, idioma ativo em **bold**, idioma inativo linkado; 8 arquivos atualizados (4 EN modified + 4 pt-BR new) |
| 2.7-AC3 | **Anglicismos técnicos preservados** — termos de vocabulário dev cotidiano NÃO são traduzidos: `API key`, `endpoint`, `rate limit`, `cold start`, `deploy`, `request`, `response`, `gateway`, `SDK`, `npm install`, `GitHub`, `header`, `token`, `Pull Request`, `issue`. Comandos, valores, hashes e nomes próprios preservados literalmente (ex: `npm install @jhonata-matias/flux-client`, commit `fd1232b`, `X-API-Key`, `100 requests/dia`). Prosa conectiva em pt-BR natural. | User decision 2026-04-22 (estilo: anglicismos mantidos) | Manual review: `grep -E "\b(instalar\|carregar\|executar\|requisição\|implantação\|ponto de acesso\|chave de API)\b" docs/**/*.pt-BR.md README.pt-BR.md` retorna zero matches para os termos técnicos listados (aceita "requisição" apenas em contextos não-API, se houver) |
| 2.7-AC4 | **Legal bilingual equivalence clause** — `TERMS.md`, `TERMS.pt-BR.md`, `PRIVACY.md`, `PRIVACY.pt-BR.md` recebem nova seção final "Bilingual Equivalence / Equivalência Bilíngue" com texto espelhado. **EN (TERMS/PRIVACY):** "Both the English and Portuguese (Brazil) versions of these [Terms / this Privacy Statement] are canonical and equally binding. In case of divergence, the version corresponding to the user's country of residence prevails." **pt-BR (TERMS/PRIVACY):** "Ambas as versões em Inglês e Português (Brasil) [destes Termos / desta Declaração de Privacidade] são canônicas e igualmente vinculantes. Em caso de divergência, prevalece a versão correspondente ao país de domicílio do usuário." | User decision 2026-04-22 (canonical: ambos bilíngue) + CDC art. 46-54 (direito à informação clara) | Manual review: cláusula presente em 4 arquivos legais (2 EN + 2 pt-BR); texto EN/pt-BR espelha de fato; encontrada em seção final consistente |
| 2.7-AC5 | **Structural parity** — cada arquivo `.pt-BR.md` mantém estrutura idêntica ao EN canônico: mesmos headings (H1-H6, mesma ordem + mesmo nível), mesmas listas/tabelas com mesma quantidade de colunas/linhas, mesmas URLs externas (não traduzidas), mesmos code blocks intactos (comandos, JSON, JS/TS, YAML). Nenhuma seção adicionada ou omitida — exceto a cláusula de AC4 que aparece em ambas versões dos legais. | User decision 2026-04-22 (MVP: tradução 1:1 sem reorganização) | Diff estrutural: `diff <(grep -cE '^#+ ' dev-onboarding.md) <(grep -cE '^#+ ' dev-onboarding.pt-BR.md)` retorna 0 (mesma contagem de headings); revisão visual side-by-side confirma ordem preservada |
| 2.7-AC6 | **Cross-linking integrity** — links internos em `.pt-BR.md` apontam preferencialmente para a versão pt-BR correspondente se ela existir no escopo da story (ex: `README.pt-BR.md` → `docs/usage/dev-onboarding.pt-BR.md` → `docs/legal/TERMS.pt-BR.md`). Links para arquivos que NÃO foram traduzidos nesta story (ex: `docs/api/reference.md`, `docs/usage/gateway-deploy.md`, `docs/usage/monitoring.md`, SDK README) apontam para versão EN acrescidos de marca `(em inglês)` adjacente ao texto do link. | Consistência de jornada BR; evitar leitor BR clicar e cair em EN "surpresa" | Link crawler manual: cada anchor internal em `.pt-BR.md` resolve para arquivo existente; amostra de 10 links EN-only testada mostra marca `(em inglês)` presente |
| 2.7-AC7 | **Quality review (standalone BR smoke)** — dev executa o onboarding seguindo APENAS `dev-onboarding.pt-BR.md` **sem consultar a versão EN** em momento algum. Smoke inclui: (a) leitura completa dos 4 arquivos pt-BR em GitHub preview, (b) simular abrir issue via template `access-request.yml` (não precisa submeter), (c) ler TERMS + PRIVACY pt-BR end-to-end, (d) simular setup de `.npmrc` e `npm install` (não precisa chave real). Resultado documentado em `docs/qa/2.7-translation-review.md` com: checklist de clareza por arquivo, typos/gramática encontrados+corrigidos na mesma PR, gaps descobertos (não-bloqueantes viram follow-up issue, bloqueantes voltam para @dev fix antes de close). | Story 2.6 external smoke pattern (evidence-based onboarding validation) | `docs/qa/2.7-translation-review.md` mostra 4/4 arquivos reviewed; onboarding pt-BR executável standalone sem consulta EN; gaps listados + triage (fix vs follow-up) |

**Definition of Done (2.7):** 7/7 ACs verificados + 4 arquivos pt-BR criados e renderizando corretamente no GitHub + banner bilíngue presente em 8 arquivos (4 EN updated + 4 pt-BR new) + cláusula de equivalência legal presente em 4 arquivos legais + `docs/qa/2.7-translation-review.md` com smoke BR standalone PASS + Epic 2 PRD updated para v1.0 (ou próxima minor) confirmando Story 2.7 Done.

**Effort budget:** 4-6h dev. **Se exceder 8h, trigger @pm review** (sinal de escopo creeping para i18n framework, automação LLM, múltiplos idiomas — que pertence ao Epic 3 futuro, não a 2.7 MVP).

**Out of scope (Story 2.7):**
- API reference (`docs/api/reference.md`) tradução → Epic 3 backlog se demanda BR justificar
- Usage guides secundários (`gateway-deploy.md`, `monitoring.md`, `comfyui-flux-quickstart.md`, `runpod-serverless-deploy.md`) → Epic 3 backlog
- PRD / stories / ADRs / QA reports tradução → permanecem EN (artefatos internos, não consumer-facing)
- SDK README (`sdk/README.md`) tradução → Epic 3 se demanda BR justificar (lê-se em npm, não no repo)
- Colab example README tradução → Epic 3 backlog
- i18n framework automation (GitHub Action de tradução via LLM, locale detection, CI check de drift EN↔pt-BR) → Epic 3+ backlog
- Outros idiomas (ES, FR, JA) → não escopado; se demanda surgir, cada idioma = nova story
- Automated sync check (CI que alerta quando EN update precisa espelho pt-BR) → follow-up opcional, não bloqueia 2.7

### Story 2.8 — Sanitize Public Docs per Security Audit

**Rationale:** Post-merge governance review da Story 2.7 (PR #5) revelou que o repo público `Jhonata-Matias/servegate` expõe significant business intelligence em 23 arquivos internos (PRDs, stories, QA gates, ADR). Security audit formal documentou o gap: pre-public flip audit (#3535 em 2026-04-22) focou apenas em secret leakage (PASS — zero leaks) mas não avaliou exposição de unit economics (`$0.000306/s GPU`, `$25/mo budget`, `$30/mo pivot threshold`), infrastructure identifiers (RunPod endpoint ID, KV namespace, network volume), strategic roadmap (pivot triggers, stay-course criteria), nem real operational metrics (warm p95 `7013ms`, cold `98-150s`). User decisão (2026-04-23) foi **L1+L2 combined**: emergency remove internal docs do público IMEDIATAMENTE (executado via commit `e290bcd`) + Story 2.8 reintroduz versões sanitizadas per 7 regras definidas na Section 7 do security audit.

**Architecture decision (v1.0):** Introdução de **two-repo model** — `Jhonata-Matias/servegate` (public, HEAD sanitized post-2.8) + `Jhonata-Matias/servegate-planning` (PRIVATE, preserva originais pré-sanitização com full business intel). Planning repo é source-of-truth interno; public é "rendered sanitized view". Fork count verificado = 0 (2026-04-23), tornando L3 history rewrite viável como addendum opcional post-2.8 se user quiser eliminar pre-sanitization do git history público.

**Strategic decisions (v1.0, aligned with user 2026-04-23):**
- **Balanced approach:** manter docs visible (build-in-public posture) mas remover competitive intel (unit economics, infra IDs, pivot thresholds)
- **Sanitization rules verbatim** do security audit Section 7: substituições de-fato, não paraphrasing (reduz risk de re-exposição acidental por interpretação dev)
- **@dev reads from planning remote** durante develop — garante source pre-sanitized não sai do contexto de trabalho
- **Risk Register + Tech Debt Backlog KEEP public** — transparência OSS saudável, não é competitive intel

| AC | Descrição | Source | Acceptance test |
|---|---|---|---|
| 2.8-AC1 | **23 arquivos internos reintroduzidos sanitized** no repo público: 2 PRDs (Epic 1 + Epic 2 v1.0), 9 stories (1.1, 2.1, 2.1.1, 2.1.2, 2.2, 2.3, 2.5, 2.6, 2.7), 5 QA gates (2.1.2, 2.2, 2.5, 2.6, 2.7), 4 QA reports (1.1-closure, 1.1-qa-report, 2.6-external-smoke, security-audit self-ref), 1 ADR (adr-0001-flux-cold-start) + 2 QA reports preservados da fase pt-BR (2.7-translation-review OK mantido). Total 23 files. | Security audit Section 2.1 (file inventory) | `find docs/prd docs/stories docs/qa/gates docs/architecture -type f \| wc -l` retorna 17+ no HEAD público; `diff` vs planning/main mostra apenas substituições de regex per AC2 (zero adição/omissão de seções) |
| 2.8-AC2 | **7 regras de sanitização aplicadas literalmente** per security audit Section 7: (1) Infrastructure IDs → placeholders (`80e45g6gct1opm` → `<RUNPOD_ENDPOINT_ID>`, `mqqgzwnfp1` → `<NETWORK_VOLUME_ID>`, `55bd0b4a...` → `<KV_NAMESPACE_ID>`, Worker version UUIDs → `<WORKER_VERSION>`); (2) Unit costs → ranges (`$0.00031/s` etc → `~$0.0001-0.0003/s`, `$0.000306/s` → `~$0.0003/s measured`, `$0.0015/img warm` → `<$0.01/img warm`, `$0.03/img cold` → `<$0.05/img cold worst case`); (3) Budgets → qualitativos (`$25/mo` → `<$50/mo alpha budget`, `$30/mo threshold` → `<cost threshold sustained 2 weeks>`); (4) Volume thresholds → qualitativos (`>1000 imgs/mo` → `<sustained volume threshold>`, `>15k escalation` → `<high-volume escalation>`, `100 imgs/dia` KEEP é public SLA); (5) Real measurements → ranges (`7013ms p95` → `~5-10s warm p95`, `98-150s cold` → `~1-3min cold start`, `71s cold smoke`/`3.1s warm smoke` → remove ou qualitativo); (6) Strategic thresholds → qualitativos (4 pivot triggers exact thresholds → `<qualitative trigger>`); (7) KEEP público: Risk Register R1-R11, Tech Debt TD1-TD8, QA gate scores, AIOX framework references, story lifecycle phases, gateway hostname, `100/dia`, `<10s warm target`, `~130s cold documented`. | Security audit Section 7 (Sanitization Rules) | Grep post-sanitization retorna zero matches para: `\b80e45g6gct1opm\b`, `\bmqqgzwnfp1\b`, `\b55bd0b4a7c3c44bb958331ba82035e55\b`, `\$0\.(00031\|00021\|00019\|00013\|000306)/s`, `\$0\.0015/img`, `\$25/mo`, `\$30/mo`, `7013ms`, `98-150s`, `>1000 imgs` |
| 2.8-AC3 | **Structural parity maintained** — cada arquivo sanitized tem mesma estrutura do original no planning: mesmos headings (H1-H6 ordem + level), mesmas tabelas (colunas + linhas preserved), mesmas numbered lists (itens preservados substantivamente — só valores nas células mudam), mesmos code blocks (intactos exceto por identifier substitution em string literals). Nenhuma seção adicionada ou omitida exceto "Sanitization Note" top-of-file (ver AC4). | Padrão replicado de Story 2.7-AC5 + security audit methodology | `diff <(grep -cE '^#+ ' planning/<file>) <(grep -cE '^#+ ' sanitized/<file>)` retorna 0 para 23 pares |
| 2.8-AC4 | **"Sanitization Note" banner** adicionado no topo de cada um dos 23 arquivos públicos sanitized, logo após H1 e antes do conteúdo. Formato exato: `> **ℹ️ Sanitized version.** Business-sensitive details (unit economics, infrastructure identifiers, pivot thresholds, real measurements) are abstracted per [security audit Section 7](../qa/security-audit-2026-04-22.md) rules. Originals are preserved in private internal mirror. This is the canonical public record.` Link to security-audit doc (which ALSO is sanitized + re-introduced per AC1, without the literal IDs/values it originally used as examples). | Transparência sobre sanitização (build-in-public meta-posture) | 23/23 arquivos contêm o banner; link `../qa/security-audit-2026-04-22.md` resolves to existing file |
| 2.8-AC5 | **Security audit doc self-sanitization** — `docs/qa/security-audit-2026-04-22.md` ALSO passa pelas 7 regras (é o arquivo que mais expõe, ironicamente). Values literais em examples (ex: "`80e45g6gct1opm` | RunPod endpoint ID") substituídos por placeholders. Content do audit como methodology + decision record permanece. Seção 7 (as regras mesmas) mantidas verbatim porque descrevem padrão de substituição, não expõem data específica. | Security audit Section 5 (self-referential gap identified by @qa) | `grep -E "80e45g6gct1opm\|mqqgzwnfp1\|55bd0b4a...\|0\.000306/s\|7013ms\|\$25/mo" docs/qa/security-audit-2026-04-22.md` retorna zero matches |
| 2.8-AC6 | **Cross-link integrity restored** — links em docs públicos que foram temporariamente removidos na commit `e290bcd` (README.md row ADR, dev-onboarding "See existing stories", gateway-deploy.md references) são restored apontando para os arquivos reintroduzidos sanitized. README + dev-onboarding + gateway-deploy atualizados para incluir references funcionais. | Commit `e290bcd` removeu 7 refs durante emergency L2; agora precisam voltar | Link crawler: 100% dos links internos em README.md, README.pt-BR.md, docs/usage/*.md resolvem para arquivos existentes em HEAD público |
| 2.8-AC7 | **QA validation via comparative grep** — `@qa` executa grep suite completa contra HEAD público sanitized + compara com planning/main (originals). Relatório em `docs/qa/2.8-sanitization-review.md` com: lista de substituições aplicadas por arquivo (sampling), grep results confirmando zero matches para identifiers/costs/measurements prohibited, delta structural (heading counts match), banner presence em 23/23, link integrity. Verdict PASS/CONCERNS/FAIL padrão. | Evidence-based validation pattern from Story 2.6/2.7 QA gates | `docs/qa/2.8-sanitization-review.md` comprehensive; gate file `docs/qa/gates/2.8-sanitize-public-docs.yml` com verdict |

**Definition of Done (2.8):** 7/7 ACs verificados + 23 arquivos sanitized commitados no público + banner AC4 em 23/23 + security audit self-sanitized (AC5) + cross-links restaurados (AC6) + `docs/qa/2.8-sanitization-review.md` PASS + `docs/qa/gates/2.8-sanitize-public-docs.yml` PASS + Epic 2 PRD (planning repo) bump para v1.1 com Story 2.8 Done note.

**Effort budget:** 4-6h @dev (23 files × ~10-15min/file sanitization per rules + cross-link fixes + QA evidence). **Se exceder 8h, trigger @pm review** (sinal de regras ambíguas que precisam refinement — stop e revisar Section 7 do audit).

**Out of scope (Story 2.8):**
- L3 history rewrite (`git filter-repo` + force push) — viable per 0-fork verification mas **separate decision** post-2.8 merge se user quiser eliminar pre-sanitization do git log completamente
- Sanitization de `docs/api/reference.md` ou `docs/usage/*.md` — consumer-facing docs NÃO removed em L2 (commit `e290bcd`), se contêm business intel isso é tech debt follow-up, não Story 2.8 scope
- Automação de sync planning↔public (CI drift check) — Epic 3+ backlog se demanda
- Revisar security audit em si para melhorar methodology — meta-work fora de scope
- Atualizar `@devops` pre-public checklist (business intel scan) — memory update já feito, formalizar em rule/doc futuro

**Special execution note:** `@dev` durante `*develop 2.8` deve trabalhar em branch `feature/2.8-sanitize-public-docs` derivada de `planning/main` (não `origin/main`), porque originals estão só no planning repo. Após sanitization + commits, `@devops` push da branch para `origin/main` (public). Planning repo permanece source-of-truth inalterado. Esse workflow híbrido (dev from planning, push to origin) está documentado como Special Execution Note para evitar confusion.

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
| **R11** (NEW) | Low-traffic pattern vira cold-dominated, caro por invocação | Ativa | ADR-0001 avalia workersMin=1 standby pra use cases steady-trickle; accept pra batch-heavy |

## Tech Debt Backlog (v0.5 — post batch close 2.1.1+2.1.2+2.2)

> Items capturados do close-story batch. PM-approved priorização. Cada item tem owner + condição de execução (timing) + critério de done.

| ID | Severity | Origem | Item | Owner | When | Done criteria |
|---|---|---|---|---|---|---|
| **TD1** | ~~HIGH~~ ✅ **DONE v0.6** | Story 2.2 AC8 deferred | Publish `@jhonata-matias/flux-client@0.1.0` ao GitHub Packages (scope renamed from `@gemma4` per v0.6 — repo owner constraint) | @devops | **Resolvido 2026-04-21** | Package live em GitHub Packages registry sob escopo `@jhonata-matias` |
| **TD2** | MEDIUM | Story 2.2 Task 11 deferred | Integration smoke 2.2 SDK contra gateway 2.5 real | @qa | Após Story 2.5 Done | 4 paths validados: success warm + cold-then-warm + 429 + 401; evidence em `docs/qa/2.2-integration-smoke.md` |
| **TD3** | MEDIUM | Story 2.1.1 close decision | Redeploy serverless image v0.1.1 (defense-in-depth) | @devops | Sprint próximo (não-blocker MVP) | RunPod endpoint reporting image tag v0.1.1; smoke test passa contra `steps=0` rejeitando explicit |
| **TD4** | LOW | Gate 2.1.2 O1 | Re-bench cold n≥10 | @dev | **Antes 2026-05-15** (prep 30-day review) | `serverless/tests/bench-cold-2026-05-15.json` com n≥10 true colds; análise comparada com baseline n=2 (ADR-0001) |
| **TD5** | LOW | Gate 2.2 O1-O4 | SDK coverage refinements (NetworkError, warmup timeout, linear backoff, safeReadJson) | @dev | Sprint próximo | 4 testes adicionais em `sdk/tests/`; total tests >=41; vitest pass |
| **TD6** | LOW | Gate 2.2 O5-O6 | SDK v0.2: warmup error classification + input upper bounds | @dev | v0.2 release | `sdk/CHANGELOG.md` documenta breaking changes; `MAX_STEPS`/`MAX_DIMENSION` constants |
| **TD7** | LOW | Gate 2.2 O7 | Add `@vitest/coverage-v8` devDep + npm script | @dev | Junto com TD5 | `npm run coverage` gera report; CI integration opcional |
| **TD8** | LOW | PM gap analysis v0.7 (2026-04-22) | `.github/workflows/` vazio — zero CI/CD. Criar `pr-checks.yml` rodando typecheck + vitest em changes de `gateway/` e `sdk/` (paths filter). Prevenção de regression em PRs futuros. Opcionalmente: `release.yml` auto-trigger em push de tag `v*` publicando SDK. | @devops | Sprint pós-2.6 (não bloqueia 2.6) | PR test valida: mudança em `sdk/src/` dispara workflow; typecheck + tests rodam e fail bloqueia merge via branch protection |

**Tech debt budget (effort estimate):** ~6-9h total (HIGH+MEDIUM apenas: ~3-4h; TD8 adiciona ~2-3h LOW). Não bloqueia MVP delivery.

**Tracking convention:** quando @dev/@qa pegar item, criar nota em PR description "Resolves Epic 2 TD<N>". @pm reviews TD board mensalmente.

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
