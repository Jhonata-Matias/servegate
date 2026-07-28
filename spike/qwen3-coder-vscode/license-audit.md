# License Stack Audit — Qwen3-Coder-30B agentic coding spike

> **Story:** 7.1 · **AC:** 1 · **Precedent:** [`docs/research/hidream-i1-dev-model-card-audit.md`](../../docs/research/hidream-i1-dev-model-card-audit.md)
> **Auditor:** @dev (YOLO 2026-07-25 initial draft; @dev revisit at Task 2 kickoff to pin exact HF revision hash)
> **Status:** DRAFT — sections marked ⚠️ VERIFY require confirmation at Task 2 execution time (before running `download-model.sh`)

## Rationale

Following the repo precedent (ADR-0003 FLUX NC rejection, ADR-0006 HiDream/Llama rejection, FU-6.1 SD 3.5L rejection), every model install requires a full stack audit BEFORE downloading weights. Licenses are read from the actual LICENSE / LICENSE-MODEL file — not from model card claims. Auxiliary components (tokenizer, serving stack, embedded safety filters, reward models) are audited separately because contamination in any layer contaminates the whole stack.

## Stack components

| Layer | Component | Version target | License claim | Verified via |
|-------|-----------|----------------|---------------|--------------|
| 1 | Model weights | `Qwen/Qwen3-Coder-30B-A3B-Instruct` (⚠️ VERIFY exact revision hash at Task 2) | Apache-2.0 | ⚠️ VERIFY — read `LICENSE` from HF repo directly |
| 2 | Tokenizer | Same as weights (bundled) | Apache-2.0 (inherited) | ⚠️ VERIFY — inspect `tokenizer_config.json` for any `license` override |
| 3 | Serving stack | vLLM `v0.6.x` (exact tag at Task 2) | Apache-2.0 | Confirmed — https://github.com/vllm-project/vllm/blob/main/LICENSE |
| 4 | Quantization | AWQ (built into vLLM args, no separate library) | Apache-2.0 (via vLLM) | Same as #3 |
| 5 | Container image | `vllm/vllm-openai:v0.6.x` (official DockerHub) | Apache-2.0 (via vLLM) | Same as #3 |
| 6 | Any embedded safety/reward model | ⚠️ VERIFY — inspect Qwen3-Coder release notes at Task 2 | TBD | If present, individual audit required |

## Detailed findings — Layer 1 (Model weights)

**⚠️ Pending Task 2 verification. Draft based on prior audit findings 2026-07-02 (see memory `10245`).**

Prior audit (Qwen2.5-Coder-32B-Instruct + Qwen3-Coder generic) confirmed:
- **License:** Apache-2.0 (unmodified, no addendum)
- **Restrictions:** None material
- **Revenue cliffs:** None
- **Attribution requirements:** Standard Apache-2.0 NOTICE reproduction (already the pattern for FLUX schnell in servegate — see `docs/legal/`)
- **RAI clauses:** None
- **Verdict for owner-internal use:** ✅ **Cleanest of all candidates**

**@dev at Task 2 MUST re-verify:** Qwen sometimes issues sub-variants (Instruct vs Base vs Coder-Next) with different licenses. Pin the exact revision hash and re-read that specific revision's LICENSE.

## Detailed findings — Layer 2 (Tokenizer)

**⚠️ Pending Task 2 verification.**

Qwen tokenizers historically ship under the same Apache-2.0 as weights. Contrast: Llama tokenizer inherits Meta Llama Community License even when a "clean" model bundles it (this is why HiDream-E1 was rejected in Epic 3 and HiDream-I1 in Epic 6). Qwen3-Coder is NOT Llama-derived — no such risk.

**@dev at Task 2:** grep the tokenizer_config.json for any embedded license field or vocab source attribution.

## Detailed findings — Layer 3 (Serving stack — vLLM)

**Confirmed:** vLLM is Apache-2.0. Repository: https://github.com/vllm-project/vllm. Same license across all versions ≥ 0.5.

vLLM's `qwen3_xml` tool parser (used for Qwen3-Coder function-calling) is part of the main vLLM codebase — inherits the same Apache-2.0. No separate license concern.

## Detailed findings — Layer 4 (Quantization — AWQ)

AWQ (Activation-aware Weight Quantization) is not a separately-licensed library in the vLLM pipeline — it's an option flag in vLLM's built-in quantization kernels. Inherits vLLM's Apache-2.0.

Alternative: if @dev at Task 2 finds Qwen3-Coder's pre-quantized weights on HF (e.g., `Qwen/Qwen3-Coder-30B-A3B-Instruct-AWQ`), those pre-quant weights inherit the base model's Apache-2.0. Verify the specific quantized-weights repo's LICENSE too.

## Detailed findings — Layer 5 (Container image)

**Confirmed:** `vllm/vllm-openai` official image — Apache-2.0 (inherits vLLM). Distributed via DockerHub `vllm/vllm-openai:v0.6.x` tags.

If @dev at Task 2 needs a custom Dockerfile (unlikely, but possible if tool-parser needs a patch), the custom Dockerfile itself sits in `spike/qwen3-coder-vscode/` under servegate's own licensing (project TBD, currently unstated). Custom image build must NOT bundle non-permissive dependencies.

## Detailed findings — Layer 6 (Auxiliary models — reward/safety filters)

**⚠️ Pending Task 2 verification.**

Some coder-model releases bundle auxiliary components (Qwen didn't historically, but this can change per release). @dev at Task 2 must inspect the HF repo file tree for any `safety_model/`, `reward_model/`, `classifier/`, or similar directories — if present, audit each individually.

Known auxiliary risks in the ecosystem (for cross-reference):
- Llama-Guard-based safety filters → Meta Llama Community License (REJECTED per Epic 6 pattern)
- OpenAI moderation model wrappers → generally not open weights
- HuggingFace's `moderation` module → Apache-2.0 (safe if used)

## Verdict summary (DRAFT — locks at Task 2)

Preliminary: **All 6 layers CLEAR for owner-internal + VS Code BYOK use** under Apache-2.0 stack. No RAI clauses, no revenue cliffs, no non-commercial restrictions, no attribution beyond standard Apache-2.0 NOTICE.

**Blocking gate:** @dev at Task 2 MUST re-verify Layer 1 (exact revision hash + LICENSE file), Layer 2 (tokenizer_config inspection), and Layer 6 (auxiliary components scan) BEFORE running `download-model.sh`. If any layer fails audit, ABORT and escalate to @architect (fallback: pivot to Qwen2.5-Coder-32B-Instruct which was 100% cleared 2026-07-02).

## Change log

| Date | Auditor | Change |
|------|---------|--------|
| 2026-07-25 | @dev (YOLO) | Initial draft based on prior audit findings 2026-07-02 (memory 10245). 3 layers flagged ⚠️ VERIFY for Task 2 re-check. No blocking issues at draft time. |
