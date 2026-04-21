# ADR-0001: FLUX Serverless Cold-Start Mitigation Strategy

## Status

**Proposed** (2026-04-21) — awaiting @pm approval per Story 2.1.2 AC3.

Review date: **2026-05-21** (30 days post-approval) — critério de reavaliação baseado em dados reais de produção.

## Context

A Story 2.1 empacotou ComfyUI + FLUX.1-schnell como endpoint RunPod Serverless usando **Opção A (network volume mount)**. Medições reais revelaram:

| Métrica | Target original (Epic 2 v0.1) | Medido (Story 2.1) | Δ |
|---|---|---|---|
| Cold start p95 | <30s | **115-150s** (n=2 true colds) | 4-5x over |
| Warm p95 | <10s | 7.0s | ✅ OK |
| Custo/imagem warm | $0.0006 | $0.0015 | 2.5x over |

O cold-start real é dominado pelo load do UNet FLUX (23GB FP16) via NVMe network volume (200-400 MB/s throughput = 60-90s só pra UNet, +30-60s boot ComfyUI/CLIP/VAE/first-inference warmup).

O **warm path** atende SLA primário do Epic 2 (<10s p95). A questão é: **como tratar o cold-start real que afeta primeira request após idle?** Isso impacta:
- **Story 2.2 SDK**: precisa decidir retry strategy
- **Story 2.3 web demo**: UX de "generating..." em first invocation
- **Epic 2 budget**: todos os paths têm implicações de custo diferentes

## Decision Drivers

1. **Volume esperado no MVP**: ~100-500 imgs/mês primeiros 3 meses (estimativa @pm)
2. **Budget Epic 2**: $25/mo target revisado (PRD v0.2)
3. **Reversibilidade**: decisão não pode travar o projeto; qualquer path escolhido deve poder mudar em <1 dia-dev
4. **Dev capacity**: owner é solo dev; effort de implementação é recurso crítico
5. **UX severidade**: cold 130s é inviável para web UX direto; SDK programático pode absorver com retry

## Options Considered

### Path A — Accept cold as-is, solve via client UX

**Description:** Mantém Opção A (network volume). SDK (Story 2.2) implementa retry-with-backoff + expõe `warmup()` helper pré-request. Web demo (Story 2.3) pré-aquece na page-load com spinner "preparing...". Documenta SLA cold realístico nos consumers.

**Pros:**
- Zero dev effort em infra (handler/Dockerfile/deploy inalterados)
- Custo mais baixo em volumes baixos ($3-35/mo range)
- Image size mantém 7.75GB (honra AC2 <15GB)

**Cons:**
- UX "falha" em first invocation sem pre-warm (web demo precisa engineering UX extra)
- SDK complexity: retry logic + timeout tuning + warmup helper
- Dependência de consumers implementarem corretamente

### Path B — Bake-in models into Docker image

**Description:** Rebuild imagem incluindo `flux1-schnell.safetensors`, `ae.safetensors`, `t5xxl_fp8_e4m3fn.safetensors`, `clip_l.safetensors` (~28GB combined). Cold start drop para ~22s (sem load de network volume). Remove dependência do network volume mount.

**Pros:**
- Cold reduz de 130s → ~22s (85% redução)
- Pior caso UX aceitável sem engineering extra
- Elimina dependência do network volume (`mqqgzwnfp1`) — pode deploy em qualquer datacenter RunPod
- Custo total mais baixo em volumes médios/altos

**Cons:**
- Image vai de 7.75GB → ~35GB (violates AC2 <15GB — requires re-scoping)
- Build time +5-10min (HF download de 28GB durante build)
- Push time +15-25min (network-limited residencial ~500kbps)
- HF_TOKEN management em CI (secret, não token em repo)
- Rebuild cada model update = ciclo custoso

### Path C — workersMin=1 (always-on standby worker)

**Description:** PATCH endpoint `workersMin=1`. Primeiro worker fica hot 24/7. Cold virtualmente zero para primeiras requests.

**CRITICAL FINDING:** RunPod docs confirmam que workersMin é billed CONTINUAMENTE at active rate (20-30% discount vs flex). Isso significa:
- RTX 4090 active rate: $0.00021/s × 86400s × 30d = **$544/mês floor**
- RTX A5000 active rate: $0.00013/s × 86400s × 30d = **$337/mês floor**

**Pros:**
- Cold UX: ~0s p95 (consistente)
- Menor complexidade dev que Path B

**Cons:**
- **Economicamente inviável** para volumes <5000 imgs/mês — custo fixo domina
- Pior que manter Pod self-hosted 24/7 ($500/mo) que já foi explicitamente rejeitado no Epic 2
- Worker spawning ainda necessário para burst >1 concurrent

### Path D — Hybrid scheduled (workersMin=1 horário comercial only)

**Description:** External cron (GitHub Actions, Cloudflare Cron) chama `PATCH /endpoints/{id}` toggling `workersMin` 0↔1 baseado em horário.

**Pros:**
- Economia de ~65% sobre Path C puro (supondo 8h/dia business hours)
- UX cold-free durante horário comercial

**Cons:**
- RunPod não tem scheduled scaling nativo — requer infraestrutura externa
- 3-5 dev-days de implementação + monitoring
- Cron failure modes (cron morreu, endpoint ficou em workersMin=1 24/7 = conta surpresa)
- Still expensive for MVP volumes: ~$180/mês floor

## Cost Matrix (consolidated, measured data)

Assumindo volume splits: low=80% cold / 20% warm, medium=30%/70%, high=5%/95% (cold ratio decreases com volume por worker reuse).

| Volume | Path A | Path B | Path C (4090) | Path C (A5000) | Path D (hybrid 8h) |
|---|---|---|---|---|---|
| 100 imgs/mo (MVP) | **$3.26** | $0.58 | $544.43 | $337.02 | ~$185 |
| 1,000 imgs/mo (dev) | **$13.18** | $3.13 | $545.37 | $337.61 | ~$190 |
| 10,000 imgs/mo (prod) | **$34.88** | $18.13 | $554.82 | $343.46 | ~$200 |

**Breakeven Path A → Path B:** em ~500-1000 imgs/mo, Path B economia começa a justificar os ~1-2 dev-days de effort. Abaixo disso, Path A é otimização local.

**Break-even Path A → Path C:** never for these volumes. Path C assumiria >5000 imgs/dia (~150k/mês) para amortizar $544/mo floor.

## Decision

**Chosen: Path A (Accept cold, solve via consumer UX)** para o MVP do Epic 2.

### Rationale

1. **Economia MVP-appropriate:** Para volume esperado (~100-500 imgs/mês), Path A custa $3-8/mo vs Path B $0.60-2/mo. Economia absoluta ~$5/mo não justifica 1-2 dev-days + AC2 violation + build/push complexity.

2. **UX problem tem solução client-side:**
   - Story 2.2 SDK: `FluxClient.warmup()` helper dispara dummy request em background; `generate()` faz retry com backoff exponential se cold timeout.
   - Story 2.3 demo: page load triggera warmup fetch; UI mostra "preparing first-time setup..." progress até first success; subsequentes são warm.

3. **Path B reserved para fase de crescimento:** Se volume sustained exceeder 1000 imgs/mo por 2 semanas, OU se Story 2.3 web demo mostrar UX de first-load inaceitável mesmo com pre-warm → pivot para Path B via Story 2.1.3 (tech debt backlog).

4. **Path C rejeitado definitivamente:** Economicamente inviável para nosso perfil. Só reabrir discussão se Epic 2 scope mudar dramaticamente para high-volume.

5. **Path D rejeitado para MVP:** Complexidade (3-5 dev-days + cron infra) não justificada para economia marginal sobre Path A. Reconsiderar apenas se negócio pivot para 8h/business-day usage pattern predictable.

### Consequences

**Positive:**
- Epic 2 Stories 2.2/2.3 podem proceder sem blocker infraestrutural
- Budget Epic 2 fica folgado para volumes MVP previstos
- Image size mantém 7.75GB (AC2 original de 2.1 preserved)
- Network volume `mqqgzwnfp1` continua sendo asset compartilhado entre Pod self-hosted e Serverless (consistent state)

**Negative:**
- First-time users do web demo enfrentam wait ~130s se não houver pre-warming — risk de bounce rate
- SDK consumers precisam implementar retry logic (complexity shifted to client)
- Cold cost ($0.03/cold) acumula em padrões low-traffic-esparso — minor for MVP scale

**Neutral:**
- Re-avaliação em 30 dias com dados reais de produção
- Path B continua como opção reversível: pivot em 1-2 dev-days se data show economics mudar

## Additional Context

### Hypothesis Validation (Task 1)

| Hipótese | Resolução |
|---|---|
| workersMin=1 é flex ou active? | **ACTIVE** confirmed — continuamente billed at $0.00021/s (4090) |
| Bake-in requer HF_TOKEN? | **SIM** — FLUX.1-schnell é gated (license acceptance). Build context precisa `--secret id=HF_TOKEN` + `huggingface_hub` download |
| RunPod suporta scheduled scaling? | **NÃO nativo** — requer cron externo + API PATCH |
| A5000 vale swap vs 4090? | **NÃO para Path A/B** — 4090 flex ($0.00031/s) vs A5000 flex ($0.00019/s) são próximos o suficiente que warm p95 (7s) domina; performance 4090 > A5000 em throughput |

### Key Measurements (Evidence)

Source: `serverless/tests/bench-results-1776789792.json` + RunPod billing API

- True cold wall times: 115s, 150s (median 133s, n=2 — sample size acknowledged small mas signal claro)
- Warm wall p95: 7013ms (n=100, from bench-results-2.1.1-regression)
- Effective rate confirmed via billing: $0.000306/s (matches docs $0.00031/s flex RTX 4090)

### Acceptance Criteria Impact

**Story 2.1 AC5** (cold <30s p95): **ACCEPTED AS GAP** — não será atingido com Path A. Epic 2 PRD v0.2 já documenta que SLA cold fica deferred para este ADR. Stories 2.2/2.3 ajustam contracts para refletir realidade.

**Story 2.1 AC6** (custo <$0.06/100 imgs): **VERIFIED 2.5x over** na Story 2.1 reality-check. PRD v0.2 já atualizou projeções. Path A mantém ordem de grandeza compatible ($3-13/1000 imgs).

### Reversibility

**Revert plan se Path A falhar em produção (UX unacceptable OR volume spike):**
1. Draft Story 2.1.3 (@sm) for Path B bake-in implementation
2. @pm approval of AC2 relaxation (35GB image)
3. @dev rewrite Dockerfile with HF_TOKEN secret mount + build+push new tag
4. @devops PATCH template to new image tag
5. Validate cold drop via smoke test

**Estimated total effort:** 1-2 dev-days. Zero dependency on external infrastructure.

## Impact on Downstream Stories

### Story 2.2 TS SDK (`@gemma4/flux-client`)

**Required adjustments:**
- Add `warmup(): Promise<void>` method — fires dummy minimal request, returns when worker is hot
- `generate()` with retry config: max 3 retries, exponential backoff, configurable cold-timeout
- Type the cold error explicitly: `ColdStartError extends Error` for consumers to handle
- Document pattern: "call warmup() on app init for predictable UX"

### Story 2.3 Next.js web demo

**Required adjustments:**
- Page-load hook: fire warmup() in useEffect; show loading state
- UI states: "Preparing (first use, up to 3 min)" → "Generating..." → done
- Analytics: log warmup success rate + time (for 30-day review)

### Story 2.5 Cloudflare Worker gateway

**No change required** — gateway is content-agnostic; retry logic lives in SDK layer.

## Open Questions / Follow-ups

1. **Could RunPod deprecate network volume mount in Serverless in future?** Low prob but if yes, forces Path B or C pivot. Monitor RunPod changelogs.
2. **Should we benchmark A5000 explicitly?** Future tech debt — low priority, since pricing delta is marginal for our volumes.
3. **Is there an intermediate optimization via caching the workflow graph on worker side?** Not explored in this ADR — out of scope (ComfyUI is already pre-loaded by start.sh, not the bottleneck).

---

**Decision log:**

| Date | Who | Action |
|---|---|---|
| 2026-04-21 | @architect (Aria) | Drafted ADR consolidating Task 1 data gathering |
| TBD | @pm (Morgan) | Approval (Task 3 of Story 2.1.2) |
| 2026-05-21 | @pm + @architect | 30-day review with production data |

**References:**
- `docs/stories/2.1.2.decide-cold-start-mitigation.story.md` — story driving this ADR
- `docs/stories/2.1.runpod-serverless-flux-endpoint.story.md` — baseline measurements
- `docs/prd/epic-2-consumer-integration.md` v0.2 — updated PRD with calibrated targets
- `serverless/tests/bench-results-1776789792.json` — cold bench raw data
- `serverless/tests/bench-results-2.1.1-regression-1776803835.json` — warm regression bench
- [RunPod Serverless Pricing](https://docs.runpod.io/serverless/pricing)
- [RunPod Endpoint Configurations](https://docs.runpod.io/serverless/references/endpoint-configurations)
- [AI on a Schedule (RunPod blog)](https://www.runpod.io/articles/guides/ai-on-a-schedule) — external cron pattern for Path D
