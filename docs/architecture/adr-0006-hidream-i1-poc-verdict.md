# ADR-0006: HiDream-I1 Dev PoC Verdict — REJECT (with Watch-List)

## Status

**Accepted**

Date: 2026-05-07 (Proposed → Accepted same day)
Accepted by: @pm (Morgan) — 7-point PM Quality Gate Review PASS (verdict logic ✓ / strategic alignment ✓ / stakeholder communication ✓ / WATCH-LIST concreteness ✓ / process correction adequacy ✓ / open threads actionability ✓ / constitutional governance ✓); ACCEPT + inline sign-off applied per Story 6.2 `quality_gate: @pm` mapping.
Authored by: @analyst (Atlas)
Architectural authority: @architect (Aria) — see [`epic-6-architect-ruling-2026-05-07.md`](./epic-6-architect-ruling-2026-05-07.md)
Audit authority: [`docs/research/hidream-i1-dev-model-card-audit.md`](../research/hidream-i1-dev-model-card-audit.md)

This ADR closes Epic 6 (HiDream-I1 Dev PoC Validation) with verdict **REJECT** plus a **WATCH-LIST** clause that defines conditions under which the territory may be re-evaluated.

The verdict is based on a model card audit (Story 6.2 Task 3) — not on infrastructure measurements (Story 6.1 was Cancelled before any GPU spend) and not on a quality A/B win rate (Story 6.2 eval pipeline did not run). Per CON-audit-veto codified in Story 6.2 AC5: any RED audit finding overrides win-rate signal regardless of magnitude.

Pivot Criteria registered for re-evaluation are listed in [Watch-List](#watch-list--re-evaluation-conditions) below.

## Context

Servegate currently exposes text-to-image (T2I) via FLUX.1-schnell on RunPod Serverless (Epic 1+2 production path). The brainstorm session of 2026-05-06 ([`docs/brainstorms/2026-05-06-open-source-image-generation-model.md`](../brainstorms/2026-05-06-open-source-image-generation-model.md)) selected **HiDream-I1 Dev** (17B MoE distilled) as a higher-fidelity Apache-2.0 candidate to evaluate as a successor or premium-tier alternative to FLUX schnell. Epic 6 was chartered to produce decision-grade evidence for an adopt / reject / defer verdict via:

- **Story 6.1** (paired) — RunPod L40S serverless spike with cold-start, warm latency, and $/imagem measurements; budget $50.
- **Story 6.2** (this ADR's source) — 50-prompt blind A/B vs FLUX dev (via fal.ai proxy), model card audit, ADR drafting; budget $5 fal.ai.

Three constraints shaped the original PoC charter (per Epic 6 PRD):

1. **Pure-Apache portfolio commitment.** Servegate's licensing posture (per [`recommended-approach.md`](./recommended-approach.md) and ADR-0003 line 10) requires Apache 2.0 (or equivalent permissive) at the weight level, with no per-MAU caps, no attribution chains, no acceptable-use-policy chains from upstream components.
2. **Pattern reuse with existing serverless stack** (RunPod + R2 + Cloudflare Workers gateway).
3. **Cheap-exit posture** — total ~$55 spend cap so an unfit model is bounded in cost.

Three decision branches were available to ADR-0006 per the PRD outcome table:

| Outcome | ADR-0006 verdict | Trigger |
|---|---|---|
| HiDream win rate ≥ 45% blind A/B AND no RED audit finding | Adopt | Charter Epic 7 |
| HiDream win rate < 45% AND cost <30% of FLUX dev | Defer | Revisit in 6 months |
| HiDream win rate < 45% AND no cost advantage **OR** RED audit finding | Reject | Document; brainstorm Path 2/3 alternatives |

The model card audit (Story 6.2 Task 3, executed 2026-05-07 via WebFetch from HuggingFace + diffusers official docs) returned a **RED finding**. Per CON-audit-veto (Story 6.2 AC5 last bullet), this dispositively pivots the verdict to REJECT regardless of any quality A/B result, before measurement effort proceeds.

## Decision

**REJECT HiDream-I1 Dev for adoption as servegate T2I path. Add to WATCH-LIST with explicit re-evaluation conditions enumerated below. Close Epic 6. Do not charter Epic 7.**

Specific dispositions:

- **Story 6.1 (spike infrastructure):** Status `In Progress → Cancelled` by @architect ruling 2026-05-07. RunPod endpoint provisioning authorization withdrawn before Task 2. ~$50 GPU spend preserved.
- **Story 6.2 (eval + audit + this ADR):** Tasks 1-2 (prompts audit, fal.ai gen) and Tasks 4-7 (eval pipeline) → N/A — do not execute. fal.ai $5 spend preserved. Tasks 3 (audit), 8 (this ADR), 9 (research report), 10 (wrap) → proceed.
- **Production FLUX schnell T2I path:** untouched (PRD §Compatibility Requirements honored throughout).
- **Brainstorm Path 2 (SD 3.5L) and Path 3 (fal.ai proxy):** registered as input for the next model-selection brainstorm; not charted by this ADR.
- **Brainstorm framework correction:** future model-selection sessions must apply a License Stack Audit gate before declaring a Path 1 winner — see [Process Correction](#process-correction) and memory `feedback_brainstorm_license_audit`.

## Rationale

### Why REJECT

The model card disclosure (`https://huggingface.co/HiDream-ai/HiDream-I1-Dev`, fetched 2026-05-07) reveals a **multi-component license stack** that does not satisfy the pure-Apache portfolio commitment:

| Component | License | Status |
|---|---|---|
| HiDream Transformer (diffusion model weights) | **MIT** | 🟡 Acceptable in isolation (close to Apache 2.0) |
| VAE (from FLUX.1 schnell) | Apache 2.0 | 🟢 Acceptable |
| T5 text encoder (`google/t5-v1_1-xxl`) | Apache 2.0 | 🟢 Acceptable |
| **Llama text encoder (`meta-llama/Meta-Llama-3.1-8B-Instruct`)** | **Llama 3.1 Community License** | 🔴 **Fails portfolio commitment** |

Verbatim from the HuggingFace model card:

> "The Transformer models in this repository are licensed under the **MIT License**."
>
> "The VAE is from `FLUX.1 [schnell]`, and the text encoders from `google/t5-v1_1-xxl` and `meta-llama/Meta-Llama-3.1-8B-Instruct`. **Please follow the license terms specified for these components.**"

The composite-pipeline license is governed by the most-restrictive component. Llama Community License imposes attribution (*"Built with Llama"*), Acceptable Use Policy chain, and a 700M MAU commercial-license trigger. These are the same obligations that ADR-0003 (i2i model selection, 2026-04-23) explicitly designed against — see ADR-0003 line 57 documenting the **identical** rejection of HiDream-E1.1 for the same Llama Community License vector.

### Why the Llama dependency is non-trivial to remove

The diffusers `HiDreamImagePipeline` exposes `prompt_embeds_llama3` as a first-class embedding parameter, separate from `prompt_embeds_t5`. The official example loads:

```python
from transformers import AutoTokenizer, LlamaForCausalLM
tokenizer_4 = AutoTokenizer.from_pretrained("meta-llama/Meta-Llama-3.1-8B-Instruct")
text_encoder_4 = LlamaForCausalLM.from_pretrained(
    "meta-llama/Meta-Llama-3.1-8B-Instruct",
    output_hidden_states=True, output_attentions=True,
    torch_dtype=torch.bfloat16,
)
pipe = HiDreamImagePipeline.from_pretrained(
    "HiDream-ai/HiDream-I1-Full",
    tokenizer_4=tokenizer_4, text_encoder_4=text_encoder_4, ...)
```

→ Llama 3.1 is required at **inference time**, not training-only. The diffusion backbone was trained against Llama-specific hidden states; substituting an Apache-licensed encoder (Qwen, Gemma, Phi) would require retraining or substantial fine-tuning of the diffusion model itself — engineering cost approaching original training cost. No drop-in swap path exists in the published pipeline.

### Why DEFER was rejected as primary verdict

DEFER (revisit in 6 months) was considered but rejected as primary because the architectural fact (Llama embedded inference-time + composite license cliff) is **not time-dependent**. Time alone provides no incremental information value. The WATCH-LIST clause within REJECT carries the same option-to-revisit without committing Epic 7 charter contingency or holding the brainstorm framework gap open as if it were under active investigation.

### Why ADOPT was unreachable

CON-audit-veto in Story 6.2 AC5 codified: *"any RED audit finding (Task 7) overrides win rate — pivots ADR to reject regardless of quality result."* Even a hypothetically perfect Story 6.1 measurement profile and Story 6.2 win-rate ≥ 45% does not change the license-stack architectural fact.

## Why this matters — portfolio framing

ADR-0003 line 22 codified: *"Commercial license is required day one, across the product portfolio. Not a SaaS-TOS license from a hosted API provider, but a license on the model weights that permits perpetual commercial redistribution across multiple products without per-seat / per-MAU caps and without vendor approval rails."* This commitment is non-negotiable for portfolio reusability and was the driver behind self-hosting Qwen-Image-Edit instead of FLUX dev or BFL hosted API.

HiDream-I1 Dev fails this commitment by importing Llama Community License obligations through its inference-time encoder dependency. Adopting it would either (a) break the portfolio commitment and create exactly the per-MAU complication ADR-0003 was designed to avoid, or (b) require a license-cliff sentinel layer at servegate level (track MAU per app, gate calls when crossing 700M, build attribution machinery) — engineering cost + ongoing burden disproportionate to the marginal quality gain HiDream might offer.

## Consequences

### Positive

- **Portfolio commitment preserved.** Servegate does not commit to a license stack that requires per-MAU capacity tracking, attribution machinery, or Acceptable Use Policy chains.
- **~$55 spend preserved.** Story 6.1 GPU budget ($50) + Story 6.2 fal.ai budget ($5) = ~$55 — none consumed (audit caught the issue at Story 6.2 Task 3, before Story 6.1 Task 2 endpoint provision and before any fal.ai call).
- **Epic 7 charter not committed.** Production deployment + SDK exposure + capability discovery + multi-tier T2I pricing — none of these gets built around an unfit model.
- **Spike scaffolding preserved as artifact.** `spike/hidream-poc/` (Dockerfile, handler.py, measure.py, prompts.json, teardown.sh, README.md) remains as a pattern reference for the next model PoC. Future PoCs reuse the harness shape with only the model-specific bits swapped.
- **Brainstorm framework correction registered.** Memory entry `feedback_brainstorm_license_audit` ensures future brainstorms apply a License Stack Audit gate. The 2026-05-06 brainstorm gap caused this Epic; codifying the fix prevents repetition.
- **Audit doc as evidence trail.** `docs/research/hidream-i1-dev-model-card-audit.md` documents the verbatim model-card disclosure with verdict tags. Reusable as evidence for the next license-stack audit on similar candidates.

### Negative

- **Brainstorm Path 1 closed.** HiDream-I1 was the only candidate that the 2026-05-06 session declared satisfied "Quality alta + Apache-2.0 + comercial OK" simultaneously. With Path 1 falsified, the next brainstorm starts narrower (Path 2 SD 3.5L $1M cliff or Path 3 fal.ai proxy).
- **No empirical quality benchmark of HiDream-I1.** The eval pipeline did not run; servegate does not have its own measurement of HiDream-I1's quality vs FLUX dev. If WATCH-LIST conditions trigger a future re-charter, measurements need to be redone (the spike harness will accelerate that work).
- **~3 dev-days of planning effort spent on the falsified path.** Brainstorm session, PRD authoring, Story 6.1 + 6.2 drafting, validation, audit, ruling, this ADR. Cost was avoidable had the License Stack Audit gate existed at brainstorm time.
- **Process gap admitted publicly.** Article IV (No Invention) was technically violated: the brainstorm's "HiDream-I1 Apache-2.0" claim was not traceable to the model card source — it was pattern-matched from the HiDream-AI organization framing. ADR-0006 records this acknowledgment.

### Neutral

- **HiDream-I1 quality remains a known unknown.** Community benchmarks (third-party) suggest ~FLUX-dev quality tier. Servegate does not have a first-party measurement to confirm or refute.
- **Llama dependency may become tractable later.** Community fine-tunes of HiDream backbone on Apache encoders are theoretically possible but unannounced. Watch-list addresses this.
- **HiDream-I1 Full and HiDream-I1 Fast share the same license stack.** This ADR's verdict applies uniformly to all three variants (Full / Dev / Fast).
- **ADR-0003 portfolio precedent strengthened.** This ADR is the second instance (after the original HiDream-E1.1 rejection) where the Llama Community License composite vector blocked an otherwise-promising candidate. The pattern is now confirmed, not provisional.

## Watch-List — Re-Evaluation Conditions

ADR-0006 does not close HiDream territory permanently. Re-charter conditions:

| Condition | Re-charter trigger? | Watch owner | Notes |
|---|---|---|---|
| HiDream-AI releases HiDream-I1 v2 (or successor) with Apache-licensed encoder (Qwen, Gemma, Phi, Mistral Apache variant) | ✅ YES | @architect | Re-spike from scratch; reuse `spike/hidream-poc/` harness |
| Meta materially relaxes Llama 3.1 Community License (e.g., removes MAU cap, removes AUP chain, releases Llama under Apache) | ✅ YES | @architect | Re-evaluate composite license stack |
| Community publishes a fine-tune of HiDream backbone on an Apache encoder with quality benchmarks vs original | ✅ YES | @analyst | Spike on the community variant |
| Servegate quality demands escalate beyond what brainstorm Path 2 (SD 3.5L) or Path 3 (proxy) can serve | ✅ YES | @pm | Triggers a new brainstorm with corrected License Stack Audit gate; HiDream re-enters as candidate only if a license-clean variant is identified |
| Time elapsed alone (6 months, 12 months, 24 months) | ❌ NO | — | Time is not an architectural fact |

Watch cadence: @architect re-checks at each major Epic charter or quarterly architecture review.

## Reversibility

Reversibility is **high**. This ADR is documentation-grade — no production code committed, no SDK exposure, no gateway routing change, no schema change, no public docs portal update.

If a watch-list condition triggers, re-charter follows:
1. New brainstorm session for the candidate (License Stack Audit gate applies).
2. New PRD (Epic 6.5 or Epic 7 charter).
3. New stories (re-using `spike/hidream-poc/` harness as pattern).
4. New ADR (or amend this one).

Estimated re-charter cost from existing artifacts: ~50% of original Epic 6 effort, given the scaffolding exists and the audit framework is now codified.

## Process Correction

The 2026-05-06 brainstorm session correctly enumerated license as *"BLOQUEADORA TOTAL"* (Question Storming Q6) but applied the check at top-level model framing, not at the component-dependency level. The pre-existing HiDream-E1.1 rejection precedent in [`recommended-approach.md`](./recommended-approach.md) line 69 should have triggered automatic cross-reference but did not.

**Amendment:** Future model-selection brainstorm sessions in the servegate portfolio must include a **License Stack Audit gate** before declaring any Path 1 winner. Gate steps:

1. Fetch candidate's model card from HuggingFace (or equivalent) verbatim.
2. Enumerate ALL component dependencies disclosed (transformer, encoders, VAEs, schedulers, tokenizers, refiners, safety filters).
3. For each component, verify the actual LICENSE.
4. Composite license = MOST RESTRICTIVE component.
5. Cross-reference composite stack against [`recommended-approach.md`](./recommended-approach.md) alternatives-rejected table. If any component matches a prior rejection vector (Llama Community License, Stability Community License, FLUX Non-Commercial, etc.), DISQUALIFY before declaring a winner.
6. Document the audit findings as a structured table in the brainstorm output before the Path Synthesis section.

This amendment is registered as memory `feedback_brainstorm_license_audit` (cross-session learning) and the @architect ruling memo for full evidence.

## References

- @architect ruling memo (architectural authority): [`epic-6-architect-ruling-2026-05-07.md`](./epic-6-architect-ruling-2026-05-07.md)
- Model card audit (evidence base): [`docs/research/hidream-i1-dev-model-card-audit.md`](../research/hidream-i1-dev-model-card-audit.md)
- Story 6.2 (this ADR's source story): [`docs/stories/6.2.hidream-eval-and-adr-0006.story.md`](../stories/6.2.hidream-eval-and-adr-0006.story.md)
- Story 6.1 (cancelled): [`docs/stories/6.1.hidream-i1-poc-spike.story.md`](../stories/6.1.hidream-i1-poc-spike.story.md)
- Epic 6 PRD: [`docs/prd/epic-6-hidream-poc-validation.md`](../prd/epic-6-hidream-poc-validation.md)
- Brainstorm session: [`docs/brainstorms/2026-05-06-open-source-image-generation-model.md`](../brainstorms/2026-05-06-open-source-image-generation-model.md)
- Portfolio precedent (HiDream-E1.1 rejection, same vector): [`recommended-approach.md`](./recommended-approach.md) line 69
- ADR-0003 (template precedent + portfolio commitment formal codification): [`adr-0003-image-to-image-model-selection.md`](./adr-0003-image-to-image-model-selection.md)
- HiDream-I1-Dev model card (primary source): `https://huggingface.co/HiDream-ai/HiDream-I1-Dev` (fetched 2026-05-07)
- diffusers HiDream pipeline docs (primary source): `https://huggingface.co/docs/diffusers/main/en/api/pipelines/hidream` (fetched 2026-05-07)
- Brainstorm framework correction memory: `feedback_brainstorm_license_audit` (cross-session learning)

## Open Threads

| Thread | Owner | Priority | Note |
|---|---|---|---|
| Llama-replacement feasibility study (theoretical: can HiDream backbone be fine-tuned on Apache encoder?) | @analyst | Low | Triggered only if a watch-list community fine-tune appears |
| SD 3.5L $1M ARR cliff impact assessment at servegate scale (input for next brainstorm) | @pm | Medium | Determines if Path 2 is reachable |
| fal.ai proxy economics revisit (Path 3) | @pm + @analyst | Medium | Revenue per call vs proxy margin tax math |
| `feedback_pre_public_audit.md`-aware sanitization scan of this ADR + audit doc + ruling memo | @po | Low | Before any public-mirror commit |
| Brainstorm framework template amendment (`.aiox-core/development/templates/brainstorming-output-tmpl.yaml`) to include License Stack Audit gate | @architect | Medium | Codify the process correction structurally, not just as memory |
| CON-fal-tos-assumption (deferred from Story 6.2 nice-to-have) | — | N/A | Moot — fal.ai integration not committed by this ADR |
