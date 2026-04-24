# Epic 4 — Gemma Text Generation (Portfolio Text-Gen Capability)

**Status:** Draft (v0.1 — awaiting ADR-0004 Accept + @sm Story 4.1 drafting)
**Owner:** @pm (Morgan)
**Created:** 2026-04-24
**Last Updated:** 2026-04-24 (v0.1)
**Project:** servegate (codename gemma4)
**Predecessor:** Epic 3 (Image-to-Image Capability — Qwen-Image-Edit, SDK v0.3.0, Done 2026-04-24)
**Scope size:** Medium brownfield (~3-4 stories covering Phase 0–5 of `wf-gated-model-serve`)
**Blueprint:** [`squads/squad-creator-pro/workflows/wf-gated-model-serve.yaml`](../../squads/squad-creator-pro/workflows/wf-gated-model-serve.yaml) applied to text generation

### Changelog

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1 | 2026-04-24 | @pm Morgan + @architect Aria | Initial draft post Phase 0 research. Scope derived from ADR-0004 (Gemma 3 4B alpha, vLLM, Cloudflare Worker reuse, SSE streaming) + cost-model ($8–15/mo at 100 calls/day) + Gemma Terms of Use commercial validation. Four stories planned: 4.1 Foundation (this phase), 4.2 Gateway + vLLM worker, 4.3 SDK + examples, 4.4 Alpha access + legal + launch. |

---

## Goal

Add **text generation capability** to servegate so developers can submit `{ messages } → streaming text` via the same gateway, auth, and alpha-access flow that powers current image generation and editing, using a model stack that is fully commercially licensed at the weights level and reusable across multiple downstream products without per-token vendor invoices.

## Why (motivação)

- Current servegate surface is image-only (Epic 1 T2I + Epic 3 i2i). Consumers requesting text/chat have no path.
- User directive (2026-04-24): add a **text-gen endpoint using Google Gemma**, downloading weights from HuggingFace, running on the existing RunPod Serverless + Cloudflare Worker stack.
- Cost constraint (user confirmed): **~$5–10/mo at alpha volumes**. Target matches the self-hosted serverless recommendation from Phase 0 alignment — rejected alternatives were Google AI Studio free-tier proxy (zero-cost but control-lite) and HuggingFace Inference API (unreliable cold-starts).
- Portfolio reusability: Gemma Terms of Use permit commercial use, no per-seat caps, no MAU caps — compatible with multi-app portfolio strategy.
- Stack coherence: reuse existing Cloudflare Worker gateway, existing alpha-access flow, existing rate-limit KV, existing TERMS/PRIVACY scaffold. Adds ~200 LOC to gateway; one new RunPod serverless endpoint.

## Strategic Decision: Self-Hosted Gemma 3 4B on RunPod worker-vllm

Formalized in [ADR-0004 — Gemma Text Generation Stack](../architecture/adr-0004-gemma-text-gen-stack.md). Summary:

| Dimension | Chosen path | Rejected alternatives |
|---|---|---|
| Model (alpha) | **`google/gemma-3-4b-it`** (Google, Gemma Terms, 4.3B params, 128k ctx, GAIA pt-BR upgrade path available) | `gemma-3-270m` / `-1b-it` (quality floor); `gemma-3-12b-it` (cost not justified at alpha); `gemma-3-27b-it` (reserved as premium tier); `gemma-3n-E2B/E4B` (mobile-optimized, no server benefit) |
| Runtime | **`runpod-workers/worker-vllm:v2.14.0`** (official, OpenAI-compatible, SSE native) | HuggingFace TGI (no RunPod-official image); custom vLLM container (reinventing wheel); RunPod native `/runsync` shape (no streaming) |
| Deployment | **New dedicated RunPod Serverless endpoint** on L4 24GB flex, network-volume weights | Extend existing image-gen endpoint (different Docker image); baked weights in Docker (50GB image unmanageable); hosted API proxy (control loss) |
| Gateway | **Reuse existing Cloudflare Worker** at `gateway/`, add `POST /v1/generate` route | New dedicated text worker (deploy duplication); extend `/jobs` path shape (polls mismatch SSE UX) |
| Response mode | **SSE streaming (default)** + non-streaming JSON fallback | Async submit/poll (ADR-0002 pattern, rejected for sub-15s latency profile); WebSocket (unsupported in Workers) |
| Rate-limit | **50,000 tokens/day global**, post-flight accounting | Per-call counter (mismatches variable token cost); per-minute (racy at low volume) |
| SDK | `@jhonata-matias/flux-client@0.4.0` adds `complete()` / `completeStream()` | New package (fragmentation); rename `generate()` (breaks T2I consumers) |

Quality (April 2026): Gemma 3 4B benchmarks surpass Gemma-2-27B-IT on most tasks per the [Gemma 3 technical report](https://arxiv.org/abs/2503.19786). MMLU-Pro 43.6%, HumanEval 71.3%, GSM8K 89.2%. pt-BR quality validated as base for [GAIA fine-tune](https://huggingface.co/CEIA-UFG/Gemma-3-Gaia-PT-BR-4b-it).

Economics: ~$8–15/mo at 100 calls/day. Scales to ~$46/mo at 500 calls/day. Break-even vs dedicated always-on L4 at ~4,000 calls/day (well above alpha).

## Scope

**In scope (Epic 4):**

- Phase 0 (Story 4.1): ADR-0004, cost-model, model candidate survey, provider assessment, gateway reuse decision — **DONE as part of this epic draft** (see References)
- Phase 1–2 (Story 4.2): RunPod endpoint provisioned with worker-vllm + Gemma 3 4B; Cloudflare Worker gains `POST /v1/generate` route with SSE streaming + token-budget rate-limit; end-to-end smoke tests
- Phase 3 (Story 4.3): SDK v0.4.0 adds `complete()` / `completeStream()`; Colab notebook + CLI example; error taxonomy extended for text (RateLimit, Timeout, ContextOverflow)
- Phase 4 (Story 4.3 extension): alpha access issue template gains "text-gen" opt-in field; rate-limit surfaces token budget to user in onboarding docs
- Phase 5 (Story 4.4): TERMS/PRIVACY updated with Gemma Prohibited Use Policy enforcement; README/landing updated with text-gen demo; release `v0.4.0-alpha` tagged + GitHub Release

**Out of scope (Epic 4 — deferred to later epics):**

- Premium tier `gemma-3-27b-it` on A100 80GB — pre-approved architecturally but not shipped in Epic 4
- pt-BR GAIA fine-tune swap — drop-in ready but deferred pending alpha feedback
- Multi-tier per-key rate limits (Epic 4 stays single-tier 50k tokens/day global)
- Tool use / function calling
- Vision input to multimodal Gemma 3 (we disable vision via `--limit-mm-per-prompt image=0`)
- Fine-tuning pipeline
- Embeddings endpoint

## Success Criteria

- [ ] **Core capability shipped:** `POST /v1/generate { messages }` returns streaming SSE of generated tokens via the existing gateway, end-to-end verified against the production RunPod text endpoint
- [ ] **Image-gen regression = zero:** existing `POST /jobs`, `GET /jobs/{id}` paths produce byte-identical behavior; FLUX T2I and Qwen i2i continue to work unchanged
- [ ] **License demonstrable:** Gemma Terms of Use audit trail documented in ADR-0004; Prohibited Use Policy bullets added to TERMS.md (EN + pt-BR)
- [ ] **Unit economics delivered:** measured monthly cost within ±20% of cost-model projection (~$8–15/mo at 100 calls/day); cold-start p99 ≤ 180s measured on production
- [ ] **Streaming UX validated:** TTFT p50 ≤ 2s on warm calls; SSE frames correctly passed through CF Worker; client-abort properly propagates to upstream
- [ ] **Rate-limit effective:** 50k tokens/day global enforced; 429 response correct; `X-RateLimit-*` headers present; daily reset at UTC midnight
- [ ] **Gemma-gated weights downloaded successfully:** HF_TOKEN works, EULA accepted, weights pre-warmed on network volume
- [ ] **Multi-stack coherence preserved:** same auth scheme (`Authorization: Bearer` or `X-API-Key`), same alpha access flow, same TERMS/PRIVACY pipeline, same legal jurisdiction (BR)

## Stories

| ID | Título | Prioridade | Executor | Quality Gate | Status |
|---|---|---|---|---|---|
| **4.1** | Foundation — ADR-0004, cost-model, provider + gateway research | **MUST** | @architect | @po | **Draft** (this epic draft seeds Story 4.1 content) |
| **4.2** | Gateway + RunPod vLLM text endpoint + smoke tests | **MUST** | @dev | @architect | **Not started** (unblocks after Story 4.1 QA pass) |
| **4.3** | SDK v0.4.0 + examples + alpha access opt-in | **MUST** | @dev | @ux-design-expert | **Not started** (unblocks after Story 4.2) |
| **4.4** | Legal + docs + public launch (v0.4.0-alpha) | **MUST** | @po + @devops | @qa | **Not started** (unblocks after Story 4.3) |

### Story 4.1 — Preliminary Scope (for @sm drafting)

**Title:** `4.1.gemma-foundation.story.md`

**Executor Assignment** (per workflow Phase 0 executor matrix):
- **Work type:** Research + ADR + cost model (Tier 0 Foundation)
- **Primary executor:** `@architect` (Aria) — technology decisions, ADR authoring
- **Secondary executor:** `@analyst` (Alex) — model candidate survey (already run)
- **Quality Gate:** `@po` (Pax) — 10-point story validation against Phase 0 gate `FOUNDATION_SET` (GMS_FND_001)
- **Quality Gate Tools:** `[adr_review, cost_model_audit, license_audit, story_10_point_validation]`

**Frontmatter template for @sm:**

```yaml
executor: "@architect"
secondary_executor: "@analyst"
quality_gate: "@po"
quality_gate_tools: [adr_review, cost_model_audit, license_audit]
epic: epic-4-gemma-text-generation
adr_ref: adr-0004-gemma-text-gen-stack
workflow_phase: 0 (Foundation)
workflow_gate: FOUNDATION_SET (GMS_FND_001)
```

**Preliminary Acceptance Criteria (8 minimum; @sm refines during draft):**

1. `docs/architecture/gemma-model-candidates.md` exists with ≥ 5 Gemma variants compared across license, VRAM, cost, benchmarks, pt-BR quality
2. `docs/architecture/gemma-provider-assessment.md` exists with RunPod worker-vllm integration plan, GPU tier selection, cold-start budget, HF_TOKEN strategy, network-volume vs baked-image decision
3. `docs/architecture/gemma-gateway-decision.md` exists with reuse-vs-new decision, SSE streaming contract, Cloudflare Workers feasibility analysis, rate-limit strategy
4. `docs/architecture/adr-0004-gemma-text-gen-stack.md` exists with Context/Decision/Rationale/Consequences/Alternatives/Pivot Criteria/Implementation Notes
5. `docs/architecture/cost-model-text-gen.md` exists with ≥ 3 volume scenarios, break-even vs dedicated GPU, 7 cost risks, budget ceiling escalation path
6. Cost model shows alpha total projection ≤ <alpha cost ceiling> at 100 calls/day (the <alpha cost ceiling> from Phase 0 alignment)
7. License audit passes: Gemma Terms of Use permit commercial API exposure; Prohibited Use Policy enforcement plan documented
8. Story 4.1 QA gate passes FOUNDATION_SET (GMS_FND_001) with GO verdict on all 5 gate criteria

**Quality Gates by risk tier:**

- **Risk tier: LOW** (research + ADR — no code changes, no production impact)
- Pre-Commit validation: none (non-code)
- Pre-PR validation: @architect self-review of ADR + @pm sanity-check on cost ceiling
- Pre-Deployment: @po 10-point validation; check ADR conforms to `wf-gated-model-serve` Phase 0 deliverables

**Effort budget:** ~1 day (research mostly complete as part of this epic draft; formalization + QA remaining)

### Story 4.2 — Preliminary Scope (blocked on 4.1)

**Title:** `4.2.gemma-gateway-and-worker.story.md`

**Executor:** `@dev` + `@devops` (endpoint provisioning)
**Quality Gate:** `@architect` (code review regression focus) + `@qa` (E2E smoke tests)

**Effort budget:** ~4–5 dev-days (blueprint Phase 1 + Phase 2)

### Story 4.3 — Preliminary Scope (blocked on 4.2)

**Title:** `4.3.gemma-sdk-and-examples.story.md`

**Executor:** `@dev`
**Quality Gate:** `@ux-design-expert` (SDK API surface) + `@qa` (SDK tests)

**Effort budget:** ~3–4 dev-days (blueprint Phase 3 + Phase 4 access opt-in)

### Story 4.4 — Preliminary Scope (blocked on 4.3)

**Title:** `4.4.gemma-launch.story.md`

**Executor:** `@po` (legal) + `@devops` (release)
**Quality Gate:** `@qa` (launch readiness checklist 18/18)

**Effort budget:** ~2 dev-days (blueprint Phase 5)

## Dependency Graph

```
Epic 3 (Done, 2026-04-24) — Qwen i2i integration + SDK v0.3.0
  └── Epic 4 Story 4.1 (Draft) — Foundation, ADR-0004, cost-model
        └── Epic 4 Story 4.2 (blocked) — Gateway /v1/generate + RunPod text endpoint
              └── Epic 4 Story 4.3 (blocked) — SDK v0.4.0 + examples + access opt-in
                    └── Epic 4 Story 4.4 (blocked) — TERMS/PRIVACY + README + v0.4.0-alpha release
                          └── 30/90-day review + premium tier 27B (Epic 5 candidate)
```

**Critical path blocker:** ADR-0004 Status must advance from Proposed → Accepted before Story 4.1 transitions Draft → Ready (@po validation rule).

## Compatibility Requirements

- [ ] **Image-gen contracts unchanged** — `POST /jobs`, `GET /jobs/{id}` accept/return the same payload shape; rate-limit / auth / KV / async semantics untouched
- [ ] **SDK backward compatible** — existing `client.generate()` (T2I) and `client.edit()` (i2i) callers see zero behavioral change; v0.4.0 is strictly additive (new `complete()` / `completeStream()` methods, new `GenerateInput` type)
- [ ] **KV storage forward-compatible** — new `tokens:YYYY-MM-DD` counter is parallel namespace to existing `count:YYYY-MM-DD`; zero overlap
- [ ] **RunPod image-gen endpoint unchanged** — separate NEW endpoint for text; same account, different image, different GPU class, different scaling config
- [ ] **Cloudflare Worker bundle size** — additional code ~200 LOC / ~5KB; well inside Workers 1MB bundle limit
- [ ] **Performance impact on image routes = zero** — image handlers untouched; text path is separate Worker route

## Risk Mitigation

- **Primary Risk (R1 — HIGH):** SSE pass-through from RunPod → Cloudflare Worker → client not empirically verified in our stack (only theoretically validated in Phase 0.3)
  - **Mitigation:** Story 4.2 Day 1 spike — `new Response(upstream.body, …)` live test against a real RunPod vLLM endpoint before any other 4.2 work. If it fails, pivot to `TransformStream` shim (adds ~100 LOC).
  - **Rollback:** disable `/v1/generate` route via feature flag; no impact on image-gen.

- **Secondary Risk (R2 — MEDIUM):** Cold-start p99 exceeds 180s budget → bad UX for first user of the day
  - **Mitigation:** instrument from Story 4.2 day 1; if p99 breaches, enable 1 always-on L4 active worker (~$11/mo) OR bake weights into Docker image (trade CI speed for cold-start).
  - **Rollback:** continue with best-effort; document in TERMS as alpha expectation.

- **Tertiary Risk (R3 — MEDIUM):** HF_TOKEN rotation/revocation breaks worker weight download
  - **Mitigation:** token rotation procedure documented in Story 4.1 runbook; 90-day calendar reminder; network volume pre-warm means token is exercised only on cold-start of fresh worker (infrequent).
  - **Rollback:** weights cached on volume — existing workers continue serving; new workers block on re-download until token fixed.

- **Quaternary Risk (R4 — MEDIUM):** Token-budget accounting race under concurrent requests → budget overshoot
  - **Mitigation:** accept same eventual-consistency tradeoff as existing image rate-limit (Epic 2 Story 2.5 R7); monitor weekly for overshoot > 10%; tighten to 25k tokens/day if budget blows.
  - **Rollback:** switch to per-call counter (lower quality rate-limit but atomic).

- **Quinary Risk (R5 — LOW):** Gemma 4 released mid-epic; we pick wrong family
  - **Mitigation:** ADR-0004 specifies 90-day review explicitly for Gemma-family upgrades; swap within family is env-var change only.

## Quality Assurance Strategy

Per `coderabbit-integration.md` + `story-lifecycle.md`:

- **Pre-Commit (@dev, light mode, max 2 iterations):** CRITICAL + HIGH severity auto-fix on gateway + SDK changes
- **Pre-PR (@architect code review):** focus on image-gen regression risk, text routing correctness, SSE pass-through mechanics, rate-limit accuracy
- **Pre-Deployment (@qa 7-check gate):** all ACs verified; regression suite passes (image + text); smoke test on production; rollback plan documented; streaming TTFT measured; cold-start p99 measured
- **Post-release monitoring (@pm):** actual $/mo vs projection; TTFT p50/p99; rate-limit hits vs false positives; first-week user feedback

## Definition of Done

- [ ] Story 4.1 QA gate = PASS (FOUNDATION_SET GMS_FND_001: all 5 criteria GO)
- [ ] Story 4.2 QA gate = PASS (GATEWAY_LIVE GMS_GW_001 + BACKEND_LIVE GMS_BE_001)
- [ ] Story 4.3 QA gate = PASS (SDK_PUBLISHED GMS_SDK_001)
- [ ] Story 4.4 QA gate = PASS (LAUNCHED GMS_LNC_001)
- [ ] SDK v0.4.0 published to GitHub Packages with `complete()` + `completeStream()` methods
- [ ] Production RunPod text endpoint deployed and serving `/v1/generate` end-to-end
- [ ] Cloudflare Worker gateway deployed with new `/v1/generate` route + token budget
- [ ] Image-gen regression test suite = all passing
- [ ] Documentation updated: API reference + text-gen section, SDK README (EN + pt-BR), TERMS + PRIVACY (EN + pt-BR) with Prohibited Use Policy, dev-onboarding
- [ ] ADR-0004 Status = Accepted
- [ ] GitHub Release `v0.4.0-alpha` tagged with migration notes for consumers
- [ ] Epic 4 v1.0 published with final stories table + close-out commit reference

## 30/90-Day Review Governance

**DRI:** @pm (Morgan) owns data collection and review trigger evaluation.

**30-day review (target 2026-05-24):** same cadence as Epic 2 R4 + Epic 3 cold-start observability. Extends with text-gen-specific metrics:

- Actual per-call inference cost on production (vs cost-model projection <projected per-call cost>)
- Cold-start p50/p95/p99 for text endpoint (vs 30/60/180s budget)
- TTFT p50 on warm calls (vs 2s target)
- Token-budget overshoot rate (should be < 10%)
- Gemma Prohibited Use Policy enforcement events (count + action taken)

**90-day review (target 2026-07-24) — Epic 4 specific:** re-evaluate model selection + stack choices per ADR-0004 pivot criteria:

- Has Google released Gemma 4 or a materially better Gemma 3 refresh?
- Has pt-BR quality from base 4b-it driven > 30% of complaints, triggering GAIA swap?
- Has traffic crossed 2,000 calls/day threshold, triggering dedicated always-on GPU evaluation?
- Has RunPod worker-vllm v2.15+ shipped with breaking changes, forcing explicit upgrade?
- Has any Gemma Terms of Use update changed commercial posture?
- Has cold-start p99 consistently exceeded 180s, forcing baked-image pivot?

If any pivot trigger fires → create follow-up epic for migration / feature extension. If none fire → Epic 4 remains closed; next review at 180 days.

## Handoff to Story Manager

**Target:** @sm (River)

**Message:**

> Please develop the detailed user story `4.1.gemma-foundation.story.md` for this brownfield epic. Key considerations:
>
> - This is the Phase 0 Foundation story — Story 4.1 is primarily documentation (research + ADR + cost-model) with minimal code changes (maybe zero — just the four docs under `docs/architecture/` already drafted in the epic preparation).
> - Story 4.1 formalizes the four Phase 0 artifacts already sketched: `gemma-model-candidates.md`, `gemma-provider-assessment.md`, `gemma-gateway-decision.md`, `adr-0004-gemma-text-gen-stack.md`, `cost-model-text-gen.md`.
> - The executor is @architect (Aria) for the ADR review/acceptance path; the analyst survey (@analyst) and cost projection work is already in these docs — Story 4.1's job is QA-gate them against `wf-gated-model-serve` Phase 0 criteria (`FOUNDATION_SET` / `GMS_FND_001`).
> - QA gate is FIVE specific criteria: ADR approved (model + provider + gateway all named) ✓; Cost model shows alpha phase < <alpha cost ceiling> at target volume ✓; Cold-start p95 fits within cold_start_budget_seconds (180s default) ✓; Provider secret model compatible with gateway platform ✓; Licensing allows commercial API exposure ✓.
> - Story 4.1 does NOT implement gateway code, worker deployment, SDK changes, or legal doc updates — those are Stories 4.2/4.3/4.4 respectively.
> - The existing FLUX + Qwen image-gen stack MUST not change. Story 4.1 is research-only.
> - ADR-0004 is Proposed; Story 4.1 drives it to Accepted.
>
> The epic should maintain system integrity while delivering a Gemma-3-4b-it–based text generation capability at ~<alpha projection range> at alpha volumes, fully reusing existing gateway + alpha-access + legal infrastructure, on a dedicated-but-architecturally-aligned RunPod serverless endpoint.

---

## References

- **ADR:** [`adr-0004-gemma-text-gen-stack.md`](../architecture/adr-0004-gemma-text-gen-stack.md) (formal decision record — Proposed, awaiting acceptance)
- **Model survey:** [`gemma-model-candidates.md`](../architecture/gemma-model-candidates.md) (Phase 0.1)
- **Provider plan:** [`gemma-provider-assessment.md`](../architecture/gemma-provider-assessment.md) (Phase 0.2)
- **Gateway decision:** [`gemma-gateway-decision.md`](../architecture/gemma-gateway-decision.md) (Phase 0.3)
- **Cost model:** [`cost-model-text-gen.md`](../architecture/cost-model-text-gen.md) (Phase 0.4)
- **Workflow blueprint:** [`squads/squad-creator-pro/workflows/wf-gated-model-serve.yaml`](../../squads/squad-creator-pro/workflows/wf-gated-model-serve.yaml)
- **Predecessors:** [`epic-1-pod-inference-stack.md`](./epic-1-pod-inference-stack.md), [`epic-2-consumer-integration.md`](./epic-2-consumer-integration.md), [`epic-3-image-to-image-capability.md`](./epic-3-image-to-image-capability.md)
- **Rules in effect:** [`adr-0001-flux-cold-start.md`](../architecture/adr-0001-flux-cold-start.md) (cold-start pattern), [`adr-0002-async-gateway-pattern.md`](../architecture/adr-0002-async-gateway-pattern.md) (image async — NOT used for text), [`adr-0003-image-to-image-model-selection.md`](../architecture/adr-0003-image-to-image-model-selection.md) (self-host pattern)
- **External docs:** [Gemma Terms of Use](https://ai.google.dev/gemma/terms), [Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy), [runpod-workers/worker-vllm](https://github.com/runpod-workers/worker-vllm), [vLLM Supported Models](https://docs.vllm.ai/en/latest/models/supported_models.html)
