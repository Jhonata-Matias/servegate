# Epic 2 — Consumer Integration (Hybrid Pragmatic)

**Status:** In Progress (v0.2 — post Story 2.1 measurements)
**Owner:** @pm (Morgan)
**Created:** 2026-04-21
**Last Updated:** 2026-04-21 (v0.2)
**Project:** gemma4
**Predecessor:** Epic 1 (Pod Inference Stack — Done em 2026-04-21)

### Changelog

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1 | 2026-04-21 | @pm Morgan | Initial draft — pre-implementation, projections ungrounded |
| 0.2 | 2026-04-21 | @pm Morgan | **Post Story 2.1 update** — cost projection calibrada com medição real (+2.5x), cold start realism (AC5 gap documentado), stories 2.1.1 + 2.1.2 adicionadas, cold SLA deferido para ADR-0001 |

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
| R4 | Vercel tem timeout 60s edge → não combina com cold spawn de ~150s | **↑ ELEVATED** (cold é pior que previsto) | Implementar polling assíncrono no SDK (já planejado). Gateway pode também fazer pré-warm via keep-alive request. |
| R5 | Custo escala mais rápido que receita | Ativa | Volume threshold **$30/mo** (revisado de $50 pra refletir projeção calibrada) dispara review |
| R6 | Gateway down → endpoint serverless inacessível (single point of failure) | Ativa | Cloudflare 99.99% SLA; fallback documentado |
| R7 | KV counter race condition em pico (2 requests no mesmo ms) | Ativa (baixa prob) | Aceitar overshoot de 1-2 imgs/dia |
| R8 | Rate limit bypass se atacante descobre endpoint serverless URL direto | Ativa | RUNPOD_API_KEY como secret do Worker |
| **R9** (NEW) | Cost projection 2.5x off arruinou budgets de consumers downstream | Mitigada via v0.2 calibration | PRD agora tem cost real-world ($0.0015/warm); consumers Epic 2 podem orçar corretamente |
| **R10** (NEW) | Image v0.1.0 em produção tem bug L1 (`steps=0` silent default) | Fix pronto, redeploy pendente | Story 2.1.1 closure inclui redeploy atomic op + smoke validation |
| **R11** (NEW) | Low-traffic pattern vira cold-dominated, caro por imagem | Ativa | ADR-0001 avalia workersMin=1 standby pra use cases steady-trickle; accept pra batch-heavy |

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
- **ADR-0001** (pending Story 2.1.2): `docs/architecture/adr-0001-flux-cold-start.md`
- Discovery PM 2026-04-21 (Epic 2 v0.1 draft)
- RunPod Serverless docs: https://docs.runpod.io/serverless/overview
- FLUX.1-schnell HF: https://huggingface.co/black-forest-labs/FLUX.1-schnell
- Constitution AIOX: `.aiox-core/constitution.md`

## Quality Gates

- Article IV (No Invention): cada decisão técnica neste PRD trace pra discovery answer ou métrica observada (smoke test 3.1s warm de Story 1.1, etc.)
- Article V (Quality First): success criteria mensuráveis (latência, custo, presença de auth) — não vagas
- CodeRabbit: integração disabled em core-config (esperado dado escopo greenfield); revisar pré-Story 2.3 se virar codebase relevante
