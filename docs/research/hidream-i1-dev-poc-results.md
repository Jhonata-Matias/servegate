# HiDream-I1 Dev — PoC Research Report (Stories 6.1 + 6.2 + Epic 6 closure)

**Stories:** [`6.1.hidream-i1-poc-spike.story.md`](../stories/6.1.hidream-i1-poc-spike.story.md) (Cancelled) + [`6.2.hidream-eval-and-adr-0006.story.md`](../stories/6.2.hidream-eval-and-adr-0006.story.md) (REJECT-track)
**PRD:** [`docs/prd/epic-6-hidream-poc-validation.md`](../prd/epic-6-hidream-poc-validation.md)
**Architectural ruling:** [`docs/architecture/epic-6-architect-ruling-2026-05-07.md`](../architecture/epic-6-architect-ruling-2026-05-07.md)
**Verdict (ADR-0006):** [`docs/architecture/adr-0006-hidream-i1-poc-verdict.md`](../architecture/adr-0006-hidream-i1-poc-verdict.md) — **REJECT (with WATCH-LIST)**
**Spike code:** [`spike/hidream-poc/`](../../spike/hidream-poc/README.md) (preserved as artifact; not deployed)

> **Epic 6 closure status (2026-05-07):** Epic CLOSED with REJECT verdict before measurement effort proceeded. Story 6.2 Task 3 model card audit returned RED (HiDream pipeline depends on Llama 3.1 inference-time → composite license stack carries Llama Community License obligations — same vector as HiDream-E1.1 rejection in Epic 3). Per CON-audit-veto, ADR-0006 verdict pivoted to REJECT regardless of any prospective quality A/B win rate. **Story 6.1 (measurement spike) was Cancelled before Task 2 endpoint provision** — no GPU spend consumed. **Story 6.2 eval pipeline (fal.ai refs + blind A/B + win-rate)** did not run. Sections below preserve original Story 6.1 scaffolding for documentation/reuse value; placeholders remain unfilled and labeled accordingly.

## Executive Summary

- **Outcome:** Epic 6 closed with **REJECT (with WATCH-LIST)** verdict — see ADR-0006.
- **Driver:** Model card audit (Story 6.2 Task 3) revealed Llama 3.1 inference-time dependency in the diffusers `HiDreamImagePipeline` → composite license stack inherits Llama Community License obligations, failing servegate's pure-Apache portfolio commitment.
- **Spend preserved:** ~$50 GPU (Story 6.1) + $5 fal.ai (Story 6.2) = **~$55 total** — none consumed; audit caught the issue before measurement effort.
- **Empirical measurements (Story 6.1):** NOT COLLECTED — endpoint never provisioned. Sections below contain placeholders preserved for the next PoC harness reuse.
- **Quality A/B (Story 6.2):** NOT EXECUTED — evaluation pipeline aborted after RED audit per CON-audit-veto.
- **Audit findings:** [`hidream-i1-dev-model-card-audit.md`](./hidream-i1-dev-model-card-audit.md) — RED verdict on Llama dependency + composite license stack; YELLOW on transformer license (MIT vs assumed Apache 2.0); YELLOW on training data + procedência + NSFW (not disclosed).
- **Process correction:** Brainstorm framework needs a License Stack Audit gate before declaring any Path 1 winner — registered as memory `feedback_brainstorm_license_audit` and codified in [§Process Correction](#process-correction-brainstorm-framework-gap) below.

## Infrastructure

| Field | Value |
| --- | --- |
| Endpoint name | `endpoint-hidream-poc-{date}` (_TBD_) |
| Endpoint id | _TBD — set `RUNPOD_HIDREAM_POC_ENDPOINT_ID`_ |
| GPU class | L40S 48GB (preferred) |
| Container image | _TBD digest_ |
| Weights | `HiDream-ai/HiDream-I1-Dev` via `HiDreamImagePipeline` (see handler) |
| Run dates (UTC) | _TBD_ |

## Measurements

| Metric | Value | Source artifact |
| --- | --- | --- |
| Cold start P50 (s) | _TBD_ | `cold-start-*.json` |
| Cold start P95 (s) | _TBD_ | `cold-start-*.json` |
| Warm latency P50 (s) | _TBD_ | `warm-latency-*.json` |
| Warm latency P95 (s) | _TBD_ | `warm-latency-*.json` |
| L40S $/sec (dashboard) | _TBD_ | recorded in `cost-ledger.json` |
| Warm $/image | _TBD_ | `cost-ledger.json` (`warm_per_image_usd`) |
| Cold-amortized $/image (50-draw) | _TBD_ | `cost-ledger.json` (`cold_amortized_per_image_usd`) |

Composite rollup: `measurements-*.json` under `.aiox/notes/story-6.1/` after `measure.py all`.

## Methodology Notes

- **Prompt set:** `spike/hidream-poc/prompts.json` (50 rows, shared with Story 6.2).
- **Seeds:** deterministic schedule `300_000 + i * 9973` for warm index `i` (see `measure.py`).
- **Inference lock-in:** 28 steps, 1024×1024, `guidance_scale` from env (default 0.0 in handler for Dev).
- **Cold definition:** `IDLE_GAP_S` default 35s between cold invocations (> 30s `idle_timeout`), 10 runs.
- **Warm definition:** 50 sequential jobs on the same warm worker window; latency uses handler `metadata.inference_s`, falling back to RunPod `executionTime`.
- **Not measured here:** Blind A/B, model card verdict, FLUX dev reference quality — Story 6.2.

## Open Threads for Story 6.2 (HISTORICAL — superseded by REJECT verdict)

- PNG directory: `.aiox/notes/story-6.1/outputs/` (would have held 50 generated images; never created).
- Manifest: `.aiox/notes/story-6.1/outputs/manifest.json` (would have indexed measurements; never created).

These open threads are documented for historical traceability. They do not represent open work — Epic 6 closed before measurement effort proceeded.

## Model Card Audit Summary (Story 6.2 Task 3)

Full audit document: [`hidream-i1-dev-model-card-audit.md`](./hidream-i1-dev-model-card-audit.md) — fetched verbatim from HuggingFace + diffusers official docs on 2026-05-07.

| Audit dimension | Verdict | Summary finding |
|---|---|---|
| **Llama 3.1 inference-time dependency** | 🔴 **RED** | `HiDreamImagePipeline` requires `meta-llama/Meta-Llama-3.1-8B-Instruct` as `text_encoder_4` at inference. Architecturally embedded — `prompt_embeds_llama3` is a first-class pipeline parameter. Not a swappable encoder; substituting requires retraining the diffusion backbone. |
| **Composite pipeline license stack** | 🔴 **RED** | Transformer MIT + VAE Apache (FLUX.1) + T5 Apache + Llama Community License. Composite governed by most-restrictive component (Llama). Brainstorm + PRD framing of "HiDream-I1 Apache 2.0 self-host" is **falsified** by the model card disclosure. |
| Transformer-only license (MIT vs assumed Apache 2.0) | 🟡 YELLOW | Close to Apache, both permissive — but the brainstorm's "pure-Apache portfolio fit" claim was technically inaccurate at the headline level. |
| Training data disclosure | 🟡 YELLOW | Not disclosed in model card. Litigation exposure unknown. |
| Procedência (HiDream.ai corporate origin) | 🟡 YELLOW | Not substantially disclosed. Geopolitical posture cannot be assessed from card alone. |
| NSFW filter behavior | 🟡 YELLOW | Not disclosed. Would require explicit safety-layer implementation downstream if adopted. |
| Output ownership | 🟢 GREEN | Permissive — *"You own all content you create with this model."* |
| Gating | 🟢 GREEN | HiDream weights not gated. (Note: Llama dependency IS gated by Meta — separate from HiDream's posture.) |

**Aggregate verdict:** 🔴 RED — dispositive per Story 6.2 AC5 CON-audit-veto rule. ADR-0006 verdict locked to REJECT regardless of measurement or eval outcomes.

### Why this is the same vector as HiDream-E1.1 (Epic 3)

ADR-0003 line 57 (i2i model selection, 2026-04-23) already documented the rejection of HiDream-E1.1 for the **identical** Llama Community License composite vector:

> "HiDream-E1.1 | MIT transformer + Llama 3.1 Community License on text encoder | Fails portfolio-wide Apache test: Llama license imposes 700M MAU cap and *'Built with Llama'* attribution requirement — a license complication this decision is explicitly designed to avoid"

HiDream-I1 Dev fails this same test, in the same way, for the same architectural reason.

## ADR-0006 Reference + Verdict

Full ADR: [`adr-0006-hidream-i1-poc-verdict.md`](../architecture/adr-0006-hidream-i1-poc-verdict.md)

**Verdict:** REJECT (with WATCH-LIST clause).

**Watch-List re-evaluation conditions** (paraphrased; full table in ADR-0006):
1. HiDream-AI releases a successor with Apache-licensed encoder (Qwen, Gemma, Phi, Mistral Apache variant) → re-spike using `spike/hidream-poc/` harness.
2. Meta materially relaxes Llama Community License (e.g., removes MAU cap, AUP chain) → re-evaluate composite stack.
3. Community publishes a fine-tune of HiDream backbone on an Apache encoder with parity benchmarks → spike on the variant.
4. Servegate quality demands escalate beyond what Path 2 (SD 3.5L) or Path 3 (fal.ai proxy) can serve → trigger new brainstorm with corrected License Stack Audit gate.
5. **Time elapsed alone — does NOT trigger.** Time is not an architectural fact.

Watch ownership: @architect re-checks at each major Epic charter or quarterly architecture review.

## Process Correction (Brainstorm Framework Gap)

The 2026-05-06 brainstorm session correctly identified license as *"BLOQUEADORA TOTAL"* (Question Storming Q6) but applied the check at top-level model framing rather than at the component-dependency level. The pre-existing HiDream-E1.1 rejection precedent ([`recommended-approach.md`](../architecture/recommended-approach.md) line 69) should have triggered automatic cross-reference but did not.

**Codified amendment:** future model-selection brainstorm sessions in the servegate portfolio must apply a **License Stack Audit gate** before declaring any Path 1 winner. Specific steps:

1. Fetch candidate's model card from HuggingFace (or equivalent) verbatim.
2. Enumerate ALL component dependencies disclosed (transformer, encoders, VAEs, schedulers, tokenizers, refiners, safety filters).
3. For each component, fetch the actual LICENSE.
4. Composite license = MOST RESTRICTIVE component.
5. Cross-reference composite stack against [`recommended-approach.md`](../architecture/recommended-approach.md) alternatives-rejected table. If any component matches a prior rejection vector (Llama Community License, Stability Community License, FLUX Non-Commercial, etc.), DISQUALIFY before declaring a winner.
6. Document audit findings as a structured table in the brainstorm output before the Path Synthesis section.

This amendment is registered as cross-session memory `feedback_brainstorm_license_audit`. A formal template patch to `.aiox-core/development/templates/brainstorming-output-tmpl.yaml` is registered as an open thread in ADR-0006 (owner @architect, priority Medium).

## Caminhos Não Fechados (input para próximo brainstorm)

ADR-0006 leaves open these paths from the original brainstorm for future work:

- **Path 2 — Stable Diffusion 3.5 Large.** Stability Community License with $1M ARR cliff. Not pure-Apache; whether the cliff is acceptable depends on servegate's projected scale during the relevant evaluation window. Owner: @pm — input for next brainstorm.
- **Path 3 — fal.ai (or Replicate) hosted proxy.** Per-call invoice with 30-50% margin tax vs self-host. Operationally simple, license-clean (consumer of hosted SaaS), but economics need revisit at the volumes servegate targets. Owner: @pm + @analyst — economics revisit.
- **New paths to evaluate in next brainstorm (License Stack Audit gate REQUIRED):** Sana 1.5 (NVIDIA, 4.8B, Apache 2.0 — verify component stack), Lumina-Image 2.0 (2.6B, Apache 2.0 — verify component stack), Z-Image-Edit (Apache 2.0 announced — verify release status), Step1X-Edit (Apache 2.0 to verify — verify component stack).

## NOT INCLUDED HERE

- Empirical infrastructure measurements (cold start, warm latency, $/imagem) — Story 6.1 was Cancelled before Task 2; placeholders above are preserved for the next PoC harness reuse but contain no data.
- Blind A/B win rate, confidence intervals, evaluator sheets — Story 6.2 eval pipeline did not execute (Tasks 4-7 N/A after RED audit).
- FLUX dev reference images — Story 6.2 Task 2 did not execute (fal.ai not called).
- Full ADR-0006 verdict rationale + ramp/exit conditions — see [`adr-0006-hidream-i1-poc-verdict.md`](../architecture/adr-0006-hidream-i1-poc-verdict.md).
- Detailed audit evidence — see [`hidream-i1-dev-model-card-audit.md`](./hidream-i1-dev-model-card-audit.md).
