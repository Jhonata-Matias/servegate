# Epic 6 — High-Fidelity T2I Validation (HiDream-I1 Dev PoC)

> **ℹ️ Sanitized version.** Business-sensitive details (unit economics, infrastructure identifiers, pivot thresholds, real measurements) are abstracted per [security audit Section 7](../qa/security-audit-2026-04-22.md) rules. Originals are preserved in private internal mirror. This is the canonical public record.

**Status:** **Closed — REJECT-track** (closed 2026-05-07 by @po Pax via `*close-story 6.2`). Stories 6.1 (Cancelled) + 6.2 (Done) + ADR-0006 (Accepted by @pm Morgan: REJECT + WATCH-LIST). Total spend: $0 / $55 budget preserved. Premise falsified — see [`docs/architecture/epic-6-architect-ruling-2026-05-07.md`](../architecture/epic-6-architect-ruling-2026-05-07.md) and [`docs/architecture/adr-0006-hidream-i1-poc-verdict.md`](../architecture/adr-0006-hidream-i1-poc-verdict.md). Re-charter conditions tracked in ADR-0006 WATCH-LIST.
**Owner:** @pm (Morgan)
**Created:** 2026-05-06
**Last Updated:** 2026-05-06 (v0.1)
**Project:** servegate (codename gemma4)
**Predecessor:** Epic 5 (Video Generation — Story 5.2 LTX-Video gateway), Epic 3 (i2i Qwen-Image-Edit pattern)
**Scope size:** Small brownfield (2 stories paralelas, ~3-4 dev-days total)
**Type:** Internal research / PoC validation — NO public deployment, NO SDK changes

### Changelog

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1 | 2026-05-06 | @pm Morgan | Initial draft post-brainstorm handoff. Scope derived from `docs/brainstorms/2026-05-06-open-source-image-generation-model.md` (Atlas analyst session). Framing: PoC-only, internal research, zero blast radius on existing FLUX T2I path. Stories 6.1 (spike infra+inference) and 6.2 (quality A/B + audit) run in parallel. Output: ADR-0006 + adoption recommendation. |

---

## Goal

Validate empirically whether **HiDream-I1 Dev (17B MoE, Apache-2.0)** can serve as a higher-fidelity open-source T2I model than the current production **FLUX schnell** path (Epic 1+2), producing an evidence-based **ADR-0006** that recommends adopt / reject / defer with concrete data on quality (blind A/B win rate), infrastructure cost (cold start, $/imagem), and licensing/compliance posture (model card audit). **No production deployment, no SDK exposure, no client-facing changes.**

## Why (motivação)

- **Quality ceiling:** FLUX schnell (4-step distilled, Apache-2.0) presents visible artifacts in hands, text, and faces — limiting servegate's positioning in photorealistic and design-asset use cases. Brainstorm explicitly rejected continuing on schnell as quality bar.
- **License constraint:** Higher-fidelity FLUX dev weights are non-commercial (off-limits for self-host). Stable Diffusion 3.5 Large carries a $1M ARR cliff (Stability Community License). Both create future contractual risk.
- **Strategic gap:** HiDream-I1 Dev (Apache-2.0, distilled MoE 17B → ~6B active) emerged in 2025 as the first true open-source contender at FLUX-dev quality tier without licensing cliffs. Its viability for the servegate operational pattern (RunPod serverless + R2 + capability discovery) is unverified empirically.
- **Risk asymmetry:** Committing infra+SDK work on HiDream without empirical validation is high-cost on rework. PoC at <$50 GPU spend de-risks future epic decisions.
- **Portfolio reuse posture (alignment with Epic 3):** Same philosophy — Apache-2.0 weights, self-host, no vendor invoice tax. PoC validates whether HiDream qualifies as the canonical T2I pattern across portfolio apps.

## Strategic Decision: Validate Before Commit

This Epic does **not** decide adoption. It produces the evidence base for ADR-0006 to make that decision. Three possible outcomes:

| Outcome | ADR-0006 verdict | Next action |
|---|---|---|
| HiDream win rate >= 45% blind A/B vs FLUX dev hosted | **Adopt** | Charter Epic 7 (production deploy + multi-tier T2I) |
| HiDream win rate < 45% but cost <30% of FLUX dev | **Defer** | Re-evaluate in 6 months as ecosystem matures |
| HiDream win rate < 45% AND no cost advantage OR red flag in model card audit | **Reject** | Document rejection rationale; revisit alternative models (SD 3.5L, Sana 1.5, Lumina) |

## Scope

**In scope (Epic 6):**

- Spike: deploy HiDream-I1 Dev (FP16) on RunPod L40S serverless endpoint, isolated from production FLUX path
- Empirical measurement: cold start P50/P95, inference latency P50/P95, $/imagem at L40S serverless rates
- 50-prompt blind A/B evaluation: HiDream Dev (PoC) vs FLUX dev (via fal.ai proxy as quality reference)
- Human evaluation by 2-3 reviewers, scoring on aesthetic / prompt adherence / artifact-free criteria
- Auditoria do model card: training data disclosures, licensing fine print, geopolitical/compliance vectors (HiDream-AI procedência)
- Documentation: ADR-0006 with empirical evidence, adoption recommendation, and ramp/exit conditions
- Internal research report `docs/research/hidream-i1-dev-poc-results.md` with raw measurements

**Out of scope (Epic 6 — explicitly deferred to Epic 7 if ADR adopts):**

- Production endpoint deploy or capability discovery exposure
- SDK `generateImage()` upgrade or new model parameter
- Gateway routing changes (FLUX schnell continues serving production T2I)
- Multi-tier pricing or quota integration
- ControlNet/IP-Adapter/LoRA hot-swap (deferred regardless to post-Epic-7 once ecosystem matures)
- Documentation publishing to public servegate docs portal
- Client-facing announcements

## Stories

### Story 6.1 — Spike: HiDream-I1 Dev Inference Infrastructure

```yaml
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: [code_review, infra_validation, cost_review]
status: Draft
estimated_effort: 2 dev-days
parallel_with: 6.2
```

**Description:** Deploy HiDream-I1 Dev em RunPod L40S serverless (separate endpoint from production FLUX path) using Diffusers backend. Run controlled inference benchmarks across 50 standard prompts measuring cold start, latency, and per-image cost. Produce raw measurement data for Story 6.2 to consume.

**Acceptance Criteria:**
- HiDream-I1 Dev FP16 weights loaded successfully on L40S (48GB VRAM)
- Cold start measured P50 / P95 across 10 cold invocations
- Inference latency measured P50 / P95 across 50 warm invocations (28 steps default, 1024² resolution)
- $/imagem calculated empirically based on RunPod L40S serverless pricing × measured runtime
- 50 generated PNGs from standardized prompt set, archived for Story 6.2 evaluation
- Endpoint torn down after measurement (no idle GPU spend)

**Quality Gates:**
- Pre-Commit: Code review of handler.py changes, secrets handling validation
- Pre-PR: @architect reviews infra approach for isolation from production FLUX path
- Pre-Deployment: N/A (PoC endpoint not promoted to production)

**Focus:** Infrastructure correctness, measurement rigor, cost discipline. **NOT:** quality evaluation (that's Story 6.2).

---

### Story 6.2 — Evaluation: HiDream Quality A/B + Model Card Audit

```yaml
executor: "@analyst"
quality_gate: "@pm"
quality_gate_tools: [evidence_validation, decision_traceability, compliance_review]
status: Draft
estimated_effort: 1.5 dev-days
parallel_with: 6.1
```

**Description:** Define 50-prompt evaluation set covering servegate target use cases (photorealistic + design assets). Generate FLUX dev reference images via fal.ai proxy. Coordinate blind A/B human evaluation (2-3 reviewers) scoring HiDream PoC outputs (from Story 6.1) against FLUX dev references. Audit HiDream-I1 model card for licensing fine print, training data disclosures, and compliance vectors. Synthesize all evidence into ADR-0006.

**Acceptance Criteria:**
- 50-prompt evaluation set documented with category tags (photorealistic / design / mixed)
- FLUX dev reference images generated via fal.ai (cost <$5)
- Blind A/B scoring sheet completed by minimum 2 evaluators on aesthetic / prompt adherence / artifact-free dimensions (1-5 scale)
- Win rate calculated with confidence interval; tie-rate documented
- Model card audit document covering: training data disclosure status, license terms verification, procedência implications for compliance, NSFW filter behavior, output ownership clauses
- ADR-0006 drafted with verdict (adopt / reject / defer) backed by evidence
- Internal research report `docs/research/hidream-i1-dev-poc-results.md` published

**Quality Gates:**
- Pre-Commit: ADR template compliance, evidence traceability check
- Pre-PR: @pm validates verdict logic against success bar (>= 45% win rate threshold)
- Pre-Deployment: N/A

**Focus:** Decision quality, evidence rigor, compliance posture. **NOT:** infrastructure tuning (that's Story 6.1).

---

## Compatibility Requirements

- [x] **Existing APIs remain unchanged** — PoC endpoint is isolated, production FLUX path untouched
- [x] **No SDK changes** — generateImage() contract preserved at v0.5.0 baseline
- [x] **No gateway routing changes** — capability discovery does not advertise HiDream
- [x] **No database schema impact** — measurements stored as flat files in docs/research/
- [x] **Performance impact zero** — PoC runs on dedicated L40S endpoint, torn down after measurement

## Risk Mitigation

- **Primary Risk:** PoC validates a model that turns out to be unfit (procedência issue, training data concern, quality below threshold) AFTER infra-as-code work is committed
- **Mitigation:** Story 6.2 audit runs in parallel with 6.1 spike; if model card audit reveals red flags, abort 6.1 measurement before fully consuming GPU budget
- **Rollback Plan:** Tear down PoC endpoint; archive ADR with rejection rationale; return to brainstorm Path 2 (SD 3.5L) or Path 3 (proxy) without lost work since FLUX production path was never modified

**Quality Assurance Strategy:**

PoC validation reduces production risk by isolating experimentation:

- **Empirical evidence over recall:** Knowledge cutoff (Jan 2026) flagged HiDream details as ⚠️ verify — Story 6.1 produces real measurements
- **Independent dimensions:** Story 6.1 measures infra (executor: @dev) while Story 6.2 measures quality + compliance (executor: @analyst) — no single-perspective bias
- **Pre-defined success bar:** ≥ 45% blind A/B win rate vs FLUX dev locked before evaluation runs (mitigates confirmation bias)
- **Model card audit independence:** Compliance review is separate vector from quality measurement — either can independently veto adoption
- **Cheap exit:** Total spend cap ~$25-50 GPU+evaluation budget. Cost of "wrong" PoC outcome is bounded.

**Specific risk vectors investigated:**

| Risk | Investigation locus |
|---|---|
| Quality below FLUX dev | Story 6.2 blind A/B |
| Cold start kills UX | Story 6.1 P50/P95 measurement |
| Procedência geopolítica | Story 6.2 model card audit |
| Training data litigation exposure | Story 6.2 model card audit |
| Cost/imagem worse than expected | Story 6.1 empirical $/imagem |
| Ecosystem maturity gap | Documented in ADR-0006 as deferred risk |

## Definition of Done

- [ ] Story 6.1 acceptance criteria all met (infra spike + measurements)
- [ ] Story 6.2 acceptance criteria all met (quality A/B + audit + ADR)
- [ ] ADR-0006 published in `docs/architecture/` with verdict + evidence trail
- [ ] Internal research report published in `docs/research/`
- [ ] PoC endpoint decommissioned (zero idle infra cost post-Epic)
- [ ] No production code modified outside `docs/` and (potentially) `serverless/` spike branch
- [ ] No regression in existing FLUX T2I path (verified via smoke test)
- [ ] Handoff artifact prepared: if ADR adopts → skeleton for Epic 7 charter; if rejects/defers → memory note for future revisit

## Success Criteria

1. **Decision-grade evidence:** ADR-0006 backed by empirical measurements (latency, cost, win rate) and audit findings, not recall or speculation
2. **Bounded blast radius:** Production FLUX T2I serves clients unchanged throughout Epic execution
3. **Reversibility:** Decision can be revisited in 6 months as HiDream ecosystem matures, with this Epic's measurements as baseline
4. **Compliance-aware:** Model card audit findings documented before any future commit, protecting downstream stories from late-stage compliance surprises

## Open Questions (for @sm to address during story drafting)

1. Where does Story 6.1 spike branch live? Suggest `spike/hidream-i1-poc-{date}` to follow existing pattern (`spike/wan-ti2v-runpod`)
2. Who are the 2-3 blind evaluators? Internal team or external? (impacts Story 6.2 scope)
3. Should evaluation include any qualitative dimensions beyond aesthetic/adherence/artifact-free (e.g., text-rendering, hand fidelity)?
4. Budget envelope hard cap for GPU spend during PoC? (suggested: $50)

---

## Story Manager Handoff (@sm River)

> Please develop detailed user stories for this brownfield epic. Key considerations:
>
> - This is an **internal research/PoC** for the existing servegate gateway running on RunPod serverless + R2 + Cloudflare Workers
> - **Integration points:** None for production. PoC endpoint is **deliberately isolated** from production FLUX T2I path. No gateway routing changes, no SDK changes, no capability discovery exposure
> - **Existing patterns to follow:**
>   - Spike branch pattern from `spike/wan-ti2v-runpod` (Story 5.2 precursor)
>   - ADR template pattern from ADR-0003 (i2i model selection)
>   - Research doc pattern from `docs/research/research-commercial-i2i-models.md`
> - **Critical compatibility requirements:**
>   - Production FLUX T2I path MUST remain byte-identical throughout Epic
>   - No public docs portal updates (internal-only)
>   - GPU spend hard-capped per agreed budget envelope
> - Each story must include verification that **existing FLUX T2I production path remains intact** (smoke test before Epic close)
> - **Stories run in parallel:** 6.1 (spike infra) and 6.2 (evaluation+audit) can be drafted and executed concurrently. Story 6.2 has soft dependency on 6.1 outputs (PoC images) but evaluation set definition + model card audit can begin immediately.
>
> The epic should produce **decision-grade evidence in ADR-0006** while delivering zero production impact.

---

## Epic Roadmap Position

```
Epic 1: Pod inference (FLUX T2I)
Epic 2: Consumer integration (gateway, SDK, landing)
Epic 3: i2i edit (Qwen-Image-Edit Apache 2.0)
Epic 4: Text generation (Gemma)
Epic 5: Video generation (LTX-Video) ← shipped Story 5.2
Epic 6: HiDream T2I PoC validation ← THIS EPIC (no public surface)
Epic 7: HiDream production deploy ← conditional on ADR-0006 adopt verdict
```

---

*PRD created using AIOX brownfield-create-epic task — Morgan the Strategist*
