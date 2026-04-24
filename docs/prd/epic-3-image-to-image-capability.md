# Epic 3 — Portfolio Image-to-Image Capability

> **ℹ️ Sanitized version.** Business-sensitive details (unit economics, infrastructure identifiers, pivot thresholds, real measurements) are abstracted per [security audit Section 7](../qa/security-audit-2026-04-22.md) rules. Originals are preserved in private internal mirror. This is the canonical public record.

**Status:** Draft (v0.1 — awaiting ADR-0003 Accept + @sm story drafting)
**Owner:** @pm (Morgan)
**Created:** 2026-04-23
**Last Updated:** 2026-04-23 (v0.1)
**Project:** servegate (codename gemma4)
**Predecessor:** Epic 2 (Consumer Integration — SDK v0.2.0, Gateway, Landing, pt-BR docs, Sanitization)
**Scope size:** Small brownfield (1-2 stories, ~4-5 dev-days core)

### Changelog

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1 | 2026-04-23 | @pm Morgan | Initial draft post-architect handoff. Scope derived from ADR-0003 (Qwen-Image-Edit self-host, Apache 2.0) + `recommended-approach.md` v0.3 + `research-commercial-i2i-models.md`. Single MVP story (3.1) covers core integration; Phases 2-3 (high-res tiling, fine-tune pipeline) deferred to later epics pending volume/demand signals at 30/90-day review. |

---

## Goal

Add **image-to-image (edit) capability** to servegate so that developers — and future portfolio apps — can submit `(input image + text instruction) → edited image` through the same async contract that powers current text-to-image, using a model stack that is fully commercially licensed at the weights level and reusable across multiple downstream products without vendor-invoice overhead.

## Why (motivação)

- Current servegate surface is T2I-only (Epic 1 + Epic 2). Consumers requesting image editing have no path.
- User directive (2026-04-23): the capability must be **portfolio-reusable** — not just a feature for this one API. Future apps that embed image editing must not require new vendor contracts, per-seat renegotiation, or model re-licensing.
- Commercial constraint: weights license must be **unconditionally permissive** (Apache 2.0, MIT with no dependent restrictions). Disqualifies FLUX Non-Commercial family, Stability Community License with revenue caps, hosted-API SaaS TOS where the vendor holds the cost lever.
- Economic constraint: per-image inference cost must not scale linearly with a vendor invoice. Hosted APIs (BFL, Gemini) at $0.039-0.045/image become a perpetual tax across the portfolio; self-hosted Apache-licensed model at ~$0.009/image preserves portfolio margins.

## Strategic Decision: Self-Hosted Qwen-Image-Edit (Apache 2.0)

Formalized in [ADR-0003 — Image-to-Image Model Selection](../architecture/adr-0003-image-to-image-model-selection.md). Summary:

| Dimension | Chosen path | Rejected alternatives |
|---|---|---|
| Model | **Qwen-Image-Edit** (Alibaba, Apache 2.0, 20B) | FLUX.2 [dev] / Kontext-[dev] / Fill / Redux (Non-Commercial); OmniGen2 (quality insufficient); HiDream-E1.1 (Llama 3.1 license wrinkle); SD 3.5 ($1M revenue cap) |
| Deployment | **Self-host on existing RunPod Serverless RTX 4090** | BFL hosted API ($0.045/img); Gemini hosted API ($0.0395/img) |
| Acceleration | **Lightning 8-step LoRA** (Apache-compatible) | 50-step baseline; distilled schnell i2i (quality regression) |
| Architecture | **Handler.py workflow branch** (shared with T2I) | New dedicated endpoint; gateway multi-upstream routing (preserved as option for future fallback) |

Quality: ~80-85% of Flux Kontext on worst-case localized precision edits. Known gotchas (aspect-ratio drift, 1 MP cap, 1:1 breakage, plastic feel on base, sequential-edit degradation) all have engineering mitigations captured in ADR-0003 §"Known Gotchas & Mitigations".

Economics: ~5× cheaper per image than rejected hosted APIs. At portfolio volumes (100k/mo) this translates to order-of-magnitude savings per year vs vendor-invoice paths.

## Scope

**In scope (Epic 3):**

- Extend `serverless/handler.py` with a new workflow branch for Qwen-Image-Edit i2i (dispatch by presence of `input_image_b64` in request payload)
- Upload Qwen-Image-Edit fp8 weights + Qwen2.5-VL encoder + Qwen VAE + Lightning 8-step LoRA to existing RunPod network volume
- Add `edit()` method to TypeScript SDK (v0.3.0, minor additive release)
- Preserve existing T2I path byte-identical (no regression)
- Documentation: API reference, SDK README (EN + pt-BR), TERMS/PRIVACY minor update (declaring on-infra-only image processing), dev-onboarding addendum
- Apply sanitization rules (Story 2.8 pattern) to all new docs before public repo push
- Smoke test end-to-end on production endpoint

**Out of scope (Epic 3 — deferred to later epics or follow-up stories per 30/90-day review):**

- High-resolution input support beyond 1 MP (tile-and-composite approach) — deferred pending volume signal
- Fine-tuning pipeline for vertical-app-specific quality uplift — deferred until a portfolio app has volume to justify training investment
- ControlNet canny/depth overlay for stricter structural preservation — potential quality-uplift follow-up
- Multi-image reference composition (Qwen supports up to 4; our API exposes only 1 in v0.3.0)
- Webhook callback alternative to polling — existing async contract is sufficient
- Premium hosted-API fallback tier (BFL as secondary provider) — architecture preserves this as option but implementation deferred
- Admin dashboard / quota analytics — Epic 4 backlog candidate

## Success Criteria

- [ ] **Core capability shipped:** `POST /jobs { prompt, input_image_b64, ... }` returns an edited image via the same `GET /jobs/{id}` polling contract, end-to-end verified against the production endpoint
- [ ] **T2I regression = zero:** existing `POST /jobs { prompt }` path produces byte-identical output and unchanged latency (schnell 4-step, ~3.5s warm)
- [ ] **Commercial license demonstrable:** Apache 2.0 audit trail documented in ADR-0003; NOTICE file in network volume lists all Qwen components and LoRA attribution (NOTICE only, not required in API responses)
- [ ] **Unit economics delivered:** measured per-image inference cost within ±20% of ADR-0003 projection (~$0.009/img with Lightning LoRA, ~$0.019/img without); storage overhead within expected envelope
- [ ] **Documented gotchas + mitigations verified:** aspect-ratio post-processing works; 1 MP auto-downsample works; 1:1 rejection surfaces clean error; >1 MP input rejected or downsampled; sequential-edit degradation documented in API reference
- [ ] **Legal posture updated:** TERMS/PRIVACY (EN + pt-BR) declare on-infra-only processing for i2i inputs; **no** third-party data-processor clause (self-host is legally simpler than the BFL-path would have been)
- [ ] **Multi-provider gateway shape preserved:** code changes do not remove the ability to add a premium hosted-API tier as secondary provider later (reversibility retained per ADR-0003)

## Stories

| ID | Título | Prioridade | Executor | Quality Gate | Status |
|---|---|---|---|---|---|
| **3.1** | Qwen-Image-Edit i2i integration (handler + SDK + docs) | **MUST** | @dev | @architect | **Draft** (awaiting @sm *draft) |

### Story 3.1 — Preliminary Scope (for @sm drafting)

**Title:** `3.1.qwen-image-edit-i2i.story.md`

**Executor Assignment** (per brownfield-create-epic §2 executor matrix):
- **Work type:** Code/Features/Logic — handler, service, SDK
- **Executor:** `@dev`
- **Quality Gate:** `@architect` (MUST be different from executor per CRITICAL RULES)
- **Quality Gate Tools:** `[code_review, pattern_validation, integration_testing, regression_testing]`

**Frontmatter template for @sm:**

```yaml
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: [code_review, pattern_validation, integration_testing, regression_testing]
epic: epic-3-image-to-image-capability
adr_ref: adr-0003-image-to-image-model-selection
```

**Preliminary Acceptance Criteria (7 minimum; @sm refines during draft):**

1. `POST /jobs` with `{prompt, input_image_b64, ...}` returns `202 + {job_id, status_url}` (unchanged async contract per ADR-0002)
2. `GET /jobs/{id}` returns `200 + {output: {image_b64, metadata}}` when edit completes, using same inline base64 format as T2I (AD-1 preserved)
3. `serverless/handler.py` dispatches by payload shape: presence of `input_image_b64` → Qwen i2i workflow; absence → existing schnell T2I workflow (unchanged)
4. Qwen workflow integrates: UNet fp8 + Qwen2.5-VL encoder + Qwen VAE + Lightning 8-step LoRA + LoadImageBase64 + VAEEncode + KSampler(denoise=strength) + VAEDecode; post-process resizes output to match input dimensions
5. Input validation: reject exact 1:1 aspect ratio with clear error; downsample inputs >1 MP; enforce ≤8 MB decoded payload; reject unsupported MIME types
6. SDK v0.3.0 adds `client.edit({ prompt, image, strength?, aspect_ratio?, ... })` — accepts `Buffer | Uint8Array | Blob | string` for image, encodes to base64, reuses existing submit/poll machinery
7. T2I regression = zero: existing `client.generate()` test suite passes unchanged; schnell latency unchanged; production smoke confirms byte-identical T2I output

**Quality Gates by risk tier:**

- **Risk tier: MEDIUM** (touches production handler + SDK + adds ~29 GB network-volume weight)
- Pre-Commit validation: @dev CodeRabbit self-healing (max 2 iterations, CRITICAL+HIGH severity only per `coderabbit-integration.md` dev-phase config)
- Pre-PR validation: @architect code review focused on regression risk, T2I path preservation, workflow branching correctness
- Pre-Deployment: full smoke test before public release; rollback plan verified (revert handler image tag + unpublish SDK v0.3.0)

**Effort budget:** ~4-5 dev-days (Phase 2 infra + Phase 3 code + Phase 4 QA + Phase 5 release per `recommended-approach.md` §7)

## Dependency Graph

```
Epic 1 (Done, 2026-04-21) — Pod + ComfyUI baseline
  └── Epic 2 (Done, 2026-04-23) — Async contract (ADR-0002), Gateway, SDK v0.2.0
        └── ADR-0003 (Proposed, 2026-04-23) — Model selection
              └── Epic 3 Story 3.1 (Draft → Ready after ADR-0003 Accepted)
                    ├── Phase 2: @devops network-volume upload + Pod validation (~1h)
                    ├── Phase 3: @dev handler + SDK + docs + tests (~3 dev-days)
                    ├── Phase 4: @qa 7-check gate with regression focus (~½ day)
                    └── Phase 5: @devops deploy + SDK v0.3.0 publish + tag (~1h)
```

**Critical path blocker:** ADR-0003 Status must advance from Proposed → Accepted before Story 3.1 can transition Draft → Ready (@po validation rule).

## Compatibility Requirements

- [ ] **T2I HTTP contract unchanged** — `POST /jobs { prompt }` accepts the same payload shape; `GET /jobs/{id}` returns the same response structure; rate-limit / auth / KV / async semantics untouched
- [ ] **SDK backward compatible** — existing `client.generate()` callers see zero behavioral or type-signature change; v0.3.0 is strictly additive (new `edit()` method, new `EditInput` type)
- [ ] **KV storage forward-compatible** — no schema changes to `JobMapping`; legacy records without `upstream` field remain readable with default interpretation
- [ ] **RunPod endpoint unchanged** — same endpoint ID, same region, same GPU family, same datacenter constraints; additive weight upload only
- [ ] **Performance impact on T2I = zero** — schnell workflow path unchanged byte-for-byte; cold-start for schnell-only invocations unaffected; cold-start for i2i invocations measured separately and documented

## Risk Mitigation

- **Primary Risk (R1 — MEDIUM):** Quality gap vs Flux Kontext visible to users on worst-case prompts (localized precision edits)
  - **Mitigation:** Known gotchas documented transparently in API reference + SDK README. Post-processing fixes the aspect-ratio issue. 90-day review clock set (target 2026-07-23) to re-evaluate against newer open-weight models (Z-Image-Edit, Step1X-Edit, Qwen v2512+).
  - **Rollback:** revert handler image tag + unpublish SDK v0.3.0 restores T2I-only state in <1h.

- **Secondary Risk (R2 — MEDIUM):** Cold-start duration regression from adding ~29 GB of new weights to network volume
  - **Mitigation:** measure baseline at release; include in 30-day review (2026-05-21) alongside existing Epic 2 R4 cold-start monitoring. If regression >25% vs schnell-only cold, evaluate model quantization tightening or move weights to faster-tier storage.
  - **Rollback:** keep weights on volume (cheap) but disable i2i workflow branch via deployment config flag (if added in Phase 3).

- **Tertiary Risk (R3 — LOW-MEDIUM):** Lightning LoRA license specifics require verification at Phase 2 infrastructure prep
  - **Mitigation:** @devops verifies license on the specific LoRA checkpoint chosen before upload. If no clean Apache/MIT LoRA available, fall back to 50-step baseline (still Apache, still ships — just ~2× cost per image, ~$0.019/img).

**Full risk matrix:** [`recommended-approach.md`](../architecture/recommended-approach.md) §8

## Quality Assurance Strategy

Per `coderabbit-integration.md` + `story-lifecycle.md`:

- **Pre-Commit (@dev, light mode, max 2 iterations):** CRITICAL + HIGH severity auto-fix; MEDIUM documented as tech debt
- **Pre-PR (@architect code review):** focus on T2I regression risk, workflow branching correctness, SDK type surface, docs accuracy
- **Pre-Deployment (@qa 7-check gate):** all ACs verified; regression suite passes; smoke test on production; rollback plan documented
- **Post-release monitoring (@pm):** quality complaint signal from first N i2i users; cold-start impact; unit cost vs projection — all feed the 30/90-day review decision

## Definition of Done

- [ ] Story 3.1 QA gate = PASS or CONCERNS (with documented tech debt backlog items)
- [ ] SDK v0.3.0 published to GitHub Packages with `edit()` method
- [ ] Production endpoint deployed and serving i2i requests end-to-end
- [ ] T2I regression test suite = all passing
- [ ] Documentation updated: API reference, SDK README (EN + pt-BR), TERMS + PRIVACY (EN + pt-BR), dev-onboarding
- [ ] ADR-0003 Status = Accepted
- [ ] GitHub Release `v0.3.0-alpha` tagged with migration notes for consumers
- [ ] Epic 3 v1.0 published with final stories table + close-out commit reference

## 30/90-Day Review Governance

**DRI:** @pm (Morgan) owns data collection and review trigger evaluation.

**30-day review (target 2026-05-23):** same cadence as Epic 2 R4 (cold-start observability). Extends Epic 2's review scope with i2i-specific metrics:

- Actual per-image inference cost on production (vs ADR-0003 projection $0.009/img)
- Cold-start duration with new weights on volume (vs baseline pre-weight-upload)
- User complaint signal on known gotchas (aspect ratio, background, 1:1 rejection, plastic feel)
- Storage cost on network volume (should stay <$3/month additional)

**90-day review (target 2026-07-23) — Epic 3 specific:** re-evaluate model selection per ADR-0003 pivot criteria:

- Has Z-Image-Edit (Apache 2.0, announced Q3 2025) reached public release?
- Has Qwen released v2512+ or successor with Kontext-parity on localized edits?
- Has Step1X-Edit (Stepfun) matured with community benchmarks?
- Has production volume crossed a threshold where fine-tuning becomes cost-justified for specific portfolio apps?
- Any BFL, Google, or third-party commercial license change that alters the Apache-vs-API trade-off?

If any pivot trigger fires → create follow-up epic for model migration or feature extension. If none fire → Epic 3 remains closed; next review at 180 days.

## Handoff to Story Manager

**Target:** @sm (River)

**Message:**

> Please develop the detailed user story `3.1.qwen-image-edit-i2i.story.md` for this brownfield epic. Key considerations:
>
> - This is an enhancement to an existing production system running TypeScript (gateway + SDK) + Python (RunPod handler) + ComfyUI + FLUX.1-schnell baseline
> - Integration points: `serverless/handler.py` (new workflow branch), `sdk/src/{types,client}.ts` (new method + types), `docs/api/reference.md`, `docs/legal/TERMS.md` + `PRIVACY.md` (+ pt-BR variants), `docs/usage/dev-onboarding.md`
> - Existing patterns to follow: async submit/poll contract (ADR-0002), opaque handler passthrough (CON-3), never-log-image-bytes (CON-4), inline base64 output (AD-1), single ComfyUI runtime for all workflows
> - Critical compatibility requirements: T2I path byte-identical; SDK v0.3.0 strictly additive; gateway unchanged; KV schema forward-compatible
> - Each task must include verification that existing T2I functionality remains intact (regression check)
> - Scope is single-story (MVP) — advanced features (high-res tiling, fine-tune, multi-ref composition) are explicitly deferred to later epics
> - ADR-0003 is Proposed; story enters Ready after @po validation AND ADR-0003 = Accepted
>
> The epic should maintain system integrity while delivering Apache 2.0 licensed, self-hosted, portfolio-reusable image-to-image capability at ~5× lower per-image cost than hosted-API alternatives.

---

## References

- **ADR:** [`adr-0003-image-to-image-model-selection.md`](../architecture/adr-0003-image-to-image-model-selection.md) (formal decision record)
- **Architectural plan:** [`recommended-approach.md`](../architecture/recommended-approach.md) v0.3 (phased implementation)
- **Stakeholder evidence:** [`cost-comparison-i2i-providers.md`](../architecture/cost-comparison-i2i-providers.md) (decision chain — with superseded-note on original BFL recommendation)
- **Candidate research:** [`research-commercial-i2i-models.md`](../architecture/research-commercial-i2i-models.md) (open-model evaluation + community sentiment)
- **Current-state inventory:** [`project-analysis.md`](../architecture/project-analysis.md)
- **Predecessors:** [`epic-1-pod-inference-stack.md`](./epic-1-pod-inference-stack.md), [`epic-2-consumer-integration.md`](./epic-2-consumer-integration.md)
- **Rules in effect:** [`adr-0001-flux-cold-start.md`](../architecture/adr-0001-flux-cold-start.md) (Path A), [`adr-0002-async-gateway-pattern.md`](../architecture/adr-0002-async-gateway-pattern.md) (async contract)
