# Epic 6 — Architectural Ruling: REJECT (Course Correction)

**Date:** 2026-05-07
**Ruler:** @architect (Aria)
**Trigger:** Story 6.2 Task 3 RED audit finding (escalated 2026-05-07)
**Affects:** Epic 6 disposition + ADR-0006 verdict + Story 6.1 GPU spend authorization
**Status:** RULING (informs ADR-0006 — author by @analyst Task 8)

---

## Ruling — Single Sentence

**Epic 6's premise (HiDream-I1 Dev as Apache-2.0 self-host candidate) is architecturally falsified by the model card disclosure; the audit RED finding is dispositive; ADR-0006 should record verdict REJECT with WATCH-LIST clause; Story 6.1 GPU spend is unauthorized (abort before Task 2 endpoint provision); Story 6.2 eval pipeline cannot recover the verdict and should not run.**

---

## Evidence Chain (verified, not invented)

### 1. The architectural premise that selected HiDream-I1

From `docs/brainstorms/2026-05-06-open-source-image-generation-model.md`:

- Line 27: "**Apache-2.0 puro** é a baixa de licença preferida (zero cliffs comerciais)"
- Line 69: "Qualidade alta + Apache-2.0 + comercial OK forma um triângulo restritivo"
- Line 78: "HiDream-I1 Dev (distilled, **Apache-2.0**, ★★★★½) — sweet spot"
- Line 248: "Modelo recomendado: HiDream-I1 Dev (Apache-2.0, distilled, L40S serverless)"

The brainstorm's recommendation depended on HiDream-I1 Dev satisfying the "pure-Apache" portfolio commitment.

### 2. The model card disclosure (verbatim from HuggingFace, 2026-05-07)

From `https://huggingface.co/HiDream-ai/HiDream-I1-Dev`:

> "The Transformer models in this repository are licensed under the **MIT License**."
>
> "The VAE is from `FLUX.1 [schnell]`, and the text encoders from `google/t5-v1_1-xxl` and `meta-llama/Meta-Llama-3.1-8B-Instruct`. **Please follow the license terms specified for these components.**"

### 3. The pipeline architectural fact (from diffusers official docs)

The HiDream pipeline's `__call__` signature exposes `prompt_embeds_llama3` as a first-class embedding input. The official example loads:

```python
text_encoder_4 = LlamaForCausalLM.from_pretrained(
    "meta-llama/Meta-Llama-3.1-8B-Instruct", ...)
```

→ Llama 3.1 is **architecturally embedded at inference time**, not training-only, not optional, not a swappable encoder component. Removing Llama would require retraining or substantial fine-tuning of the diffusion backbone against a substitute encoder — engineering cost approaching original training cost.

### 4. The exact precedent the brainstorm should have applied

From `docs/architecture/recommended-approach.md` line 69 (Epic 3 alternatives-rejected table):

> "HiDream-E1.1 | MIT transformer + **Llama 3.1 Community License** encoder | Not pure Apache — Llama attribution + MAU cap"

→ HiDream-E1.1 was rejected for **the exact same vector** that now disqualifies HiDream-I1 Dev. The composite-license-cliff pattern was a known portfolio-architectural disqualifier 4 weeks before the Epic 6 brainstorm session.

---

## Architectural Analysis

### Why REJECT (not DEFER, not ADOPT)

#### Article: Servegate Portfolio Commitment

The portfolio commitment per `recommended-approach.md` is unambiguous: **pure-Apache (or Apache-equivalent permissive) at the weight level**, with explicit rejection of any composite-license scheme that introduces:
- Per-MAU caps (e.g., Stability Community License $1M ARR cliff)
- Attribution obligations from non-permissive components
- Acceptable Use Policy chains from upstream licenses
- Any scenario where commercial scale changes license obligations

HiDream-I1 Dev's composite license stack:
- Transformer: MIT ✅ permissive
- VAE: Apache 2.0 ✅
- T5 encoder: Apache 2.0 ✅
- **Llama encoder: Llama 3.1 Community License** 🔴 fails commitment

The composite carries the most-restrictive component's obligations. Llama Community License obligations are real (attribution, AUP, acknowledgment text, MAU-conditional commercial license trigger). They are exactly the "cliff" the portfolio commitment rejects.

#### Article: Architectural Reversibility

REJECT is reversible if HiDream-AI publishes a Llama-free variant (none announced). DEFER does NOT change the architectural fact — it only delays the verdict. Since the architectural fact (Llama is embedded inference-time) is not time-dependent, DEFER offers no incremental information value. WATCH-LIST clause within REJECT carries the same option without committing Epic 7 charter contingency.

#### Article: Cost-Conscious Engineering

Story 6.1 has consumed $0 GPU. Continuing to Task 2 (endpoint provision) commits ~$50 toward measurements that **cannot change the verdict**. Per CON-audit-veto in Story 6.2 AC5: any RED finding overrides win rate. Even if HiDream-I1 measures perfectly, the architectural fact stands. Spending $50 to confirm a non-actionable measurement violates cost-consciousness without compensating insight value.

#### Article: Living Architecture (the WATCH-LIST clause)

REJECT does not preclude future revisit. ADR-0006 should record explicit conditions under which Epic 6 territory may be re-chartered:

| Condition | Re-charter trigger? |
|---|---|
| HiDream-AI releases HiDream-I1 v2 with Apache-licensed encoder (Qwen, Gemma, Phi, Mistral Apache variant) | YES — re-charter with new spike |
| Meta materially relaxes Llama Community License (e.g., removes MAU cap, removes AUP chain) | YES — re-evaluate composite |
| A community fine-tune of HiDream backbone on Apache encoder achieves quality parity (published benchmarks) | YES — spike on community variant |
| Time elapsed alone (6 months, 12 months) | NO — time is not an architectural fact |
| Quality demands escalate beyond what brainstorm Path 2 (SD 3.5L) or Path 3 (proxy) can serve | YES — new brainstorm with corrected license stack matrix |

Watch ownership: @architect (this agent role) re-checks at each major Epic charter or quarterly architecture review.

---

## Disposition Directives

### Story 6.1 — ABORT before Task 2

**Authorization withdrawn.** No RunPod endpoint provisioning, no GPU spend.

What @dev Dex completed on 2026-05-06 (Task 1: spike scaffolding `spike/hidream-poc/handler.py`, `measure.py`, `prompts.json`, etc.) is **preserved as documentation artifact**. The scaffolding has independent value as:
- A pattern reference for future model PoC work (next time we evaluate a model in this category, the harness shape is reusable)
- An evidence trail for ADR-0006 (proves we got far enough to confirm the architectural fact via README's HF_TOKEN dependency note)

**Story 6.1 status update:** `In Progress → Cancelled` (architectural-fact override, NOT a quality failure of @dev's work).

**Tasks 2–9 of Story 6.1:** N/A — do not execute.

**AC8 (CON-prod-isolation):** still applies — spike branch must remain zero-diff vs production paths. Verify at @devops PR-creation time.

### Story 6.2 — Pivot to ADR-only

**Eval pipeline (Tasks 4–7):** N/A — do not execute. fal.ai $5 spend NOT authorized.

**Task 3 (model card audit):** ✅ DONE 2026-05-07 by @analyst — RED verdict is the dispositive input.

**Task 8 (ADR-0006 drafting):** PROCEED with verdict **REJECT (with WATCH-LIST)**. @analyst Atlas authors the ADR using:
- This memo as the architectural authority source
- Audit doc (`docs/research/hidream-i1-dev-model-card-audit.md`) as evidence base
- Brainstorm doc as upstream rationale (and process-gap evidence)
- ADR-0003 as template structure

**Task 9 (research report):** PROCEED — write a thin research report capturing what was investigated + why rejected. Document the brainstorm process gap (see "Process Correction" below) so future model-selection brainstorms benefit. The report will be smaller than originally scoped (no measurements, no win-rate, no fal.ai refs) but the ADR + audit + this memo are the substance.

**Task 10 (wrap):** PROCEED — close Story 6.2 with REJECT-track outputs.

### ADR-0006 — Verdict Specification

ADR-0006 should record:

| Section | Required content |
|---|---|
| Status | Proposed (awaiting @pm Morgan gate) |
| Decision | **REJECT HiDream-I1 Dev for adoption as servegate T2I path** |
| Decision Drivers | (1) Composite license stack inherits Llama Community License obligations; (2) Servegate portfolio commitment requires permissive-license-stack at weight level; (3) Llama removal is non-trivial (architectural retrain required) |
| Options Considered | adopt (rejected — license cliff), defer (rejected — time alone is not architectural fact), reject with watch-list (chosen) |
| Rationale | This memo as primary citation + audit doc + brainstorm process gap acknowledgment |
| Consequences | Positive: Epic 7 charter not committed; ~$50 GPU + $5 fal.ai spend preserved; portfolio commitment intact. Negative: brainstorm Path 1 closed; Path 2 (SD 3.5L $1M cliff) and Path 3 (fal.ai proxy) need re-evaluation. Neutral: HiDream-I1 spike scaffolding has reuse value; T5 + VAE component paths are still permissive |
| Reversibility | High — WATCH-LIST conditions enumerated above; no production code committed; pure documentation-grade decision |
| References | this memo, audit doc, brainstorm doc, recommended-approach.md line 69 (HiDream-E1.1 precedent), Epic 6 PRD |
| Open Threads | Llama dependency removal feasibility study (low priority); SD 3.5L $1M cliff impact at servegate scale (medium priority — input to next brainstorm); fal.ai proxy economics revisit (medium priority) |

---

## Process Correction (Brainstorm Framework Gap)

The 2026-05-06 brainstorm session selected HiDream-I1 Dev as Path 1 winner without a **License Stack Audit** gate. The session correctly enumerated license as "BLOQUEADORA TOTAL" (Q6 in Question Storming) but applied the audit only at the top-level model framing, not at the component level.

This was preventable: `recommended-approach.md` line 69 already documented HiDream-E1.1's rejection for the exact same Llama composite vector. The brainstorm framework should have triggered a "this candidate's component stack vs. that prior precedent" comparison automatically.

### Recommended brainstorm framework amendment

For any future model-selection brainstorm in the servegate portfolio, add a gate **before** declaring a Path 1 winner:

```
LICENSE STACK AUDIT GATE
├── Fetch model card (HF or equivalent) for the candidate
├── Enumerate ALL component dependencies declared
│   (transformer, encoders, VAEs, schedulers, tokenizers, refiners)
├── For each component, fetch the actual license file
├── Composite license = MOST RESTRICTIVE component
├── If any component carries a "license cliff" (per recommended-approach.md
│   alternatives-rejected table), DISQUALIFY the candidate before declaring Path 1
└── Cross-reference: does this composite match any prior rejection? If yes, apply same verdict
```

This gate should be implemented as a checklist amendment to the brainstorm-output template (see `.aiox-core/development/templates/brainstorming-output-tmpl.yaml` if it lacks this section).

### Memory entry recommendation

Save a `feedback` memory documenting this process gap with concrete guidance — see "Memory" section below.

---

## Constitutional Implications

### Article IV — No Invention

The brainstorm + PRD framing of "HiDream-I1 Dev Apache-2.0" was effectively an **invention** — a claim not traceable to the model card source. The model card disclosure (visible to anyone fetching the HF page) clearly states transformer license is MIT and components carry separate licenses. The brainstorm pattern-matched from HiDream-AI's marketing posture without verifying via the LICENSE file or model card disclosure.

ADR-0006 should record this as a known Article IV violation that the audit caught. No retroactive blame — the framework gap explains the violation. The amendment recommended above is the structural fix.

### Article IV-A — REUSE > ADAPT > CREATE

The architectural ruling itself follows Article IV-A correctly: it REUSES the existing portfolio precedent (HiDream-E1.1 rejection in Epic 3) rather than CREATING new disqualification logic. The cheap-exit posture also REUSES the cost-conscious-engineering principle from prior PoCs.

---

## Memory (proposed feedback entry)

```markdown
---
name: Brainstorm framework needs License Stack Audit gate
description: Model-selection brainstorms must enumerate component dependencies + cross-check against portfolio rejection precedents BEFORE declaring Path 1 winner
type: feedback
---

When brainstorming model selection for the servegate portfolio (or any portfolio with strict license commitments), apply a License Stack Audit gate before declaring a winner.

**Why:** 2026-05-07 — Epic 6 chartered HiDream-I1 Dev as "Apache-2.0 sweet spot" (brainstorm 2026-05-06). Audit at Task 3 of Story 6.2 revealed inference-time Llama 3.1 dependency → composite license cliff. This was the exact pattern that disqualified HiDream-E1.1 from Epic 3 (`recommended-approach.md` line 69) and was preventable. Cost: ~$0 actual (audit caught it before GPU spend), but ~3 dev-days of planning/drafting/validation/coordination work.

**How to apply:** Before declaring Path 1 winner in any AIOX brainstorm, fetch the candidate's model card + LICENSE files; enumerate ALL component dependencies; verify each carries a permissive license (Apache 2.0, MIT, or equivalent without MAU caps); composite license = most restrictive component; cross-reference against `recommended-approach.md` alternatives-rejected table to catch repeated patterns. If any component fails the bar, disqualify before naming the winner.
```

---

## Cross-References

- Audit doc: [`docs/research/hidream-i1-dev-model-card-audit.md`](../research/hidream-i1-dev-model-card-audit.md)
- Story 6.2: [`docs/stories/6.2.hidream-eval-and-adr-0006.story.md`](../stories/6.2.hidream-eval-and-adr-0006.story.md)
- Story 6.1: [`docs/stories/6.1.hidream-i1-poc-spike.story.md`](../stories/6.1.hidream-i1-poc-spike.story.md)
- Epic 6 PRD: [`docs/prd/epic-6-hidream-poc-validation.md`](../prd/epic-6-hidream-poc-validation.md)
- Brainstorm: [`docs/brainstorms/2026-05-06-open-source-image-generation-model.md`](../brainstorms/2026-05-06-open-source-image-generation-model.md)
- Precedent: [`docs/architecture/recommended-approach.md`](./recommended-approach.md) line 69 (HiDream-E1.1 rejection)
- ADR template precedent: [`docs/architecture/adr-0003-image-to-image-model-selection.md`](./adr-0003-image-to-image-model-selection.md)
- ADR-0006: `docs/architecture/adr-0006-hidream-i1-poc-verdict.md` (TBD — to be authored by @analyst Task 8 using this memo as authority source)

---

*Ruling complete 2026-05-07. Awaiting user confirmation on disposition. @analyst proceeds with ADR-0006 drafting per this memo upon confirmation.*
