# HiDream-I1 Dev — Model Card Audit (Story 6.2 Task 3)

**Date:** 2026-05-07
**Auditor:** @analyst (Atlas)
**Story:** [`6.2.hidream-eval-and-adr-0006`](../stories/6.2.hidream-eval-and-adr-0006.story.md) — AC5
**Sources audited:**
- HuggingFace model card: `https://huggingface.co/HiDream-ai/HiDream-I1-Dev` (fetched 2026-05-07)
- Diffusers pipeline docs: `https://huggingface.co/docs/diffusers/main/en/api/pipelines/hidream` (fetched 2026-05-07)
- Cross-reference: [`docs/architecture/recommended-approach.md`](../architecture/recommended-approach.md) (HiDream-E1.1 prior rejection)
- Cross-reference: Epic 6 PRD + brainstorm (sanitized public copy)

---

## TL;DR — Audit Verdict

| Finding | Verdict |
|---|---|
| **Llama 3.1 inference-time dependency** | 🔴 **RED** |
| Transformer license is MIT (not Apache 2.0 as brainstorm assumed) | 🟡 YELLOW |
| Composite pipeline license stack inherits Llama 3.1 Community License | 🔴 **RED** |
| Training data disclosure | 🟡 YELLOW (not disclosed) |
| Procedência (HiDream.ai corporate origin) | 🟡 YELLOW (not disclosed in card) |
| NSFW filter behavior | 🟡 YELLOW (not disclosed) |
| Output ownership | 🟢 GREEN (permissive — "you own all content you create") |
| Gating | 🟢 GREEN (not gated; public download) |

**Aggregate verdict:** **🔴 RED**.

**Recommended ADR-0006 pivot:** **REJECT** or **DEFER**, NOT adopt — regardless of any subsequent quality A/B win rate. Per Story 6.2 AC5 last rule: *"ANY RED finding triggers escalation to @architect before AC6 (ADR drafting) proceeds."* This audit halts the eval pipeline at the fail-fast gate.

---

## 1. Llama 3.1 Inference-Time Dependency — 🔴 RED

### Finding

The HiDream Image pipeline is **architecturally dependent on `meta-llama/Meta-Llama-3.1-8B-Instruct` at inference time**, not just training time. The diffusers pipeline takes 4 text encoders (`text_encoder_2/3/4` plus pooled), and `text_encoder_4` is Llama 3.1.

### Evidence (verbatim from diffusers HiDream pipeline docs)

The official example code in the [HiDreamImagePipeline documentation](https://huggingface.co/docs/diffusers/main/en/api/pipelines/hidream) requires loading Llama at inference:

```python
from transformers import AutoTokenizer, LlamaForCausalLM
from diffusers import HiDreamImagePipeline

tokenizer_4 = AutoTokenizer.from_pretrained("meta-llama/Meta-Llama-3.1-8B-Instruct")
text_encoder_4 = LlamaForCausalLM.from_pretrained(
    "meta-llama/Meta-Llama-3.1-8B-Instruct",
    output_hidden_states=True,
    output_attentions=True,
    torch_dtype=torch.bfloat16,
)

pipe = HiDreamImagePipeline.from_pretrained(
    "HiDream-ai/HiDream-I1-Full",
    tokenizer_4=tokenizer_4,
    text_encoder_4=text_encoder_4,
    torch_dtype=torch.bfloat16,
)
```

The pipeline's `__call__` signature also exposes `prompt_embeds_llama3` as a distinct embedding parameter (separate from `prompt_embeds_t5`), confirming Llama embeddings are first-class architectural inputs to the diffusion model — not a swappable detail.

### Implications

- Every inference invocation of HiDream-I1 (Dev/Full/Fast) requires loading Llama 3.1 weights and running them as part of the pipeline.
- The diffusion model was trained against Llama 3.1 hidden states; **swapping Llama for an Apache-licensed encoder (Qwen, Gemma, Phi) would require retraining or substantial fine-tuning of the diffusion backbone**.
- No alternative encoder is mentioned in the model card or pipeline docs.

### License consequence

Llama 3.1 Community License obligations apply to any commercial deployment of HiDream-I1, including but not limited to:
- Mandatory attribution ("Built with Llama")
- Acceptable Use Policy compliance
- License acknowledgment text
- Commercial license requirement at MAU ≥ 700M (not relevant at servegate alpha scale, but downstream constraint at growth)

### Verdict

🔴 **RED**. This is the same license-cliff vector that knocked out HiDream-E1.1 from Epic 3 portfolio consideration. It applies identically to HiDream-I1.

---

## 2. License Terms Verification — 🔴 RED (composite)

### Finding

The model card discloses a **multi-component license stack**, NOT pure Apache 2.0 as the brainstorm + PRD framing assumed.

### Evidence (verbatim from HuggingFace model card)

> "The Transformer models in this repository are licensed under the **MIT License**."
>
> "The VAE is from `FLUX.1 [schnell]`, and the text encoders from `google/t5-v1_1-xxl` and `meta-llama/Meta-Llama-3.1-8B-Instruct`. **Please follow the license terms specified for these components.**"

### License stack

| Component | License | Verdict |
|---|---|---|
| HiDream Transformer (diffusion model weights) | **MIT** | 🟡 YELLOW (close to Apache 2.0 — both are permissive — but the brainstorm's "Apache 2.0 portfolio fit" framing is technically wrong) |
| VAE (from FLUX.1 schnell) | Apache 2.0 | 🟢 GREEN |
| T5 text encoder (`google/t5-v1_1-xxl`) | Apache 2.0 | 🟢 GREEN |
| **Llama text encoder (`meta-llama/Meta-Llama-3.1-8B-Instruct`)** | **Llama 3.1 Community License** | 🔴 **RED** (see §1) |

### Implications

- Per the model card's own disclosure, downstream users MUST follow Llama Community License terms.
- The COMPOSITE pipeline license is constrained by the most-restrictive component (Llama Community License).
- Brainstorm framing of HiDream-I1 as "first true open-source FLUX-dev-quality contender at Apache 2.0" was based on incomplete reading of the model card. The Apache-only assumption fails.

### Verdict

🔴 **RED** for the composite. 🟡 YELLOW for the transformer-only license deviation (MIT vs assumed Apache 2.0). The composite verdict dominates.

---

## 3. Training Data Disclosure — 🟡 YELLOW

### Finding

The model card does **not disclose training data sources**. No mention of LAION, Common Crawl flagged subsets, internal HiDream.ai datasets, or opt-out mechanisms.

### Implications

- Litigation exposure unknown (e.g., similar Stability/StabilityAI lawsuits arising from LAION-derived training data).
- For Epic 6 PoC: not blocking by itself, but compounds the RED license stack finding.
- For Epic 7 (if hypothetically chartered): would require deeper investigation of HiDream-AI's data provenance before commercial deployment.

### Verdict

🟡 **YELLOW** — note in ADR-0006 Open Threads.

---

## 4. Procedência (HiDream.ai Corporate Origin) — 🟡 YELLOW

### Finding

The model card does **not substantially disclose corporate origin, geography, or ownership structure**.

### Evidence

- Organization page on HuggingFace: "HiDream.ai" (1.13k followers as of 2026-05-07)
- Commercial product reference: `https://vivago.ai/`
- No country, founding entity, or affiliation details on the model card itself

### Implications

- Geopolitical exposure assessment incomplete. For commercial portfolio adoption, downstream stakeholders (legal, compliance, enterprise customers) typically require provenance disclosure.
- Not a per-se blocker, but a known unknown that compounds the RED stack.

### Verdict

🟡 **YELLOW** — note in ADR-0006 Open Threads. Recommend deeper provenance investigation if ADR pivots from REJECT to DEFER (i.e., revisit window opens).

---

## 5. NSFW Filter Behavior — 🟡 YELLOW

### Finding

The model card does **not disclose built-in safety filters or NSFW gating**. No mention of removability or compliance posture.

### Implications

- For internal PoC: not relevant.
- For Epic 7 commercial deployment: would require explicit safety layer implementation (similar to FLUX schnell production path which has known behaviors).

### Verdict

🟡 **YELLOW** — note in ADR-0006.

---

## 6. Output Ownership — 🟢 GREEN

### Finding

The model card explicitly grants permissive output ownership.

### Evidence (verbatim)

> "You own all content you create with this model. You can use your generated content freely, but you must comply with this license agreement."

### Verdict

🟢 **GREEN**. Output rights are clean; constraint is on the model itself (per §1, §2), not the generated images.

---

## 7. Gating — 🟢 GREEN

### Finding

HiDream-I1-Dev is **not gated**. No HF token requirement, no manual approval, no license-acceptance-click required to download weights.

(Note: the LLAMA-3.1 component IS gated by Meta and requires HF token + Meta acceptance — separate from HiDream's own non-gating posture.)

### Verdict

🟢 **GREEN** for HiDream weights themselves. The gating burden falls on the Llama dependency (which is itself another reason §1 is RED).

---

## 8. Dev vs Full vs Fast — license uniform

The model card mentions three variants (`HiDream-I1-Full`, `HiDream-I1-Dev`, `HiDream-I1-Fast`) but does **not distinguish license terms between them**. Findings #1–#7 apply uniformly to all three variants.

---

## Recommended ADR-0006 Verdict Pivot

Per Story 6.2 AC5 escalation rule, this audit recommends:

### Primary recommendation: **REJECT**

The fundamental premise of Epic 6 — that HiDream-I1 Dev provides a higher-fidelity Apache-2.0 self-host path that fits the servegate portfolio — is **falsified by the model card disclosure**:

1. The composite pipeline carries Llama Community License obligations (§1, §2).
2. This is the SAME risk vector that knocked out HiDream-E1.1 in Epic 3 (`recommended-approach.md` line 69) — applied identically to HiDream-I1.
3. Removing Llama is not a simple swap (would require retrain/fine-tune of diffusion backbone).
4. The "pure-Apache portfolio fit" criterion that originally selected HiDream-I1 in the brainstorm is **not satisfied**.

ADR-0006 should:
- Document the audit findings as primary rationale (this verdict does not require Story 6.1 measurements OR Story 6.2 quality A/B to support the decision).
- Reference [Path 2 (SD 3.5L) and Path 3 (proxy via fal.ai)] from the brainstorm as alternative paths to revisit.
- Recommend brainstorm + brainstorming-techniques framework be re-applied with the corrected license matrix (HiDream-I1 disqualified at intake, not after $50 GPU spend).

### Secondary recommendation: **DEFER (6 months)**

If reject is too final, defer can be argued because:
- Llama 3.1 Community License terms may evolve (Meta has historically tightened, not loosened — but watch the space).
- HiDream-AI may release a Llama-free variant (no announced precedent, but the ecosystem is fast-moving).
- Quality measurements from Story 6.1 are still useful as a baseline if revisit happens.

### What is NOT recommended: **ADOPT**

Even if Story 6.1 measurements are favorable AND Story 6.2 win rate ≥ 45%, the license posture violates servegate's portfolio commitment. AC5's CON-audit-veto rule applies: *"any RED audit finding (Task 7) overrides win rate — pivots ADR to reject regardless of quality result."*

---

## Implications for Story 6.1 (in-flight)

**Story 6.1 is currently In Progress** (per its own Status field — @dev Dex executing RunPod benchmarks at 2026-05-07). This audit raises the question of whether continuing the $50 GPU spend is justifiable given the RED finding.

**Recommendation: pause 6.1 Task 4 (warm latency runs) pending @architect call.**

Justification:
- 6.1 Tasks 2-3 (endpoint provision + cold-start measurement) may still proceed for documentation completeness — they're cheap.
- 6.1 Task 4 (50 warm invocations) is the bulk of the $50 spend; pausing it preserves budget if the @architect concurs with the REJECT pivot.
- If @architect prefers DEFER over REJECT, completing 6.1 measurements gives a baseline for the future revisit window.
- If @architect insists on full eval despite RED audit, 6.1 Task 4 + 6.2 eval pipeline can resume.

---

## Cross-References

- Story 6.2: [`docs/stories/6.2.hidream-eval-and-adr-0006.story.md`](../stories/6.2.hidream-eval-and-adr-0006.story.md)
- Story 6.1: [`docs/stories/6.1.hidream-i1-poc-spike.story.md`](../stories/6.1.hidream-i1-poc-spike.story.md)
- Epic 6 PRD: [`docs/prd/epic-6-hidream-poc-validation.md`](../prd/epic-6-hidream-poc-validation.md)
- Brainstorm session: [`docs/brainstorms/2026-05-06-open-source-image-generation-model.md`](../brainstorms/2026-05-06-open-source-image-generation-model.md)
- Prior precedent (HiDream-E1.1 rejection): [`docs/architecture/recommended-approach.md`](../architecture/recommended-approach.md) line 69
- ADR-0003 (precedent for empirical-decision-before-commit): [`docs/architecture/adr-0003-image-to-image-model-selection.md`](../architecture/adr-0003-image-to-image-model-selection.md)
- ADR-0006 (TBD pending @architect verdict on this audit's recommendation): `docs/architecture/adr-0006-hidream-i1-poc-verdict.md` (not yet authored)

---

*Audit complete 2026-05-07. Per AC5 escalation rule: HALT eval pipeline. Next step: @architect call on REJECT vs DEFER pivot for ADR-0006.*
