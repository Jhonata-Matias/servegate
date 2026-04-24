# ADR-0003: Image-to-Image Model Selection — Self-Hosted Qwen-Image-Edit

## Status

**Accepted**

Date: 2026-04-23 (Proposed → Accepted same day)
Accepted by: @pm (Morgan)

Apache 2.0 license scope validated for portfolio-wide commercial use: Apache 2.0 is unconditionally permissive — perpetual, worldwide, royalty-free, commercial OK, derivative works OK, no revenue cap, no MAU cap, no attribution requirement beyond preserving the NOTICE file. All model components in the chosen stack (Qwen-Image-Edit UNet, Qwen2.5-VL encoder, Qwen VAE, Lightning 8-step LoRA) are Apache 2.0 or Apache-compatible. No DPA, vendor-approval gate, or license renegotiation required for any future app in the portfolio.

TERMS.md / PRIVACY.md update scope is **additive and minor** — declare that user-submitted images are processed on our own compute only with no third-party data processor for i2i. Legally simpler than the BFL-path alternative would have been. @dev will update EN + pt-BR variants in Story 3.1.

Next gate: `@po` 10-point validation of Story 3.1 after `@sm` drafts it, then `@dev` implementation per `recommended-approach.md` §7 Phase 2-5.

## Context

servegate currently exposes text-to-image (T2I) via FLUX.1-schnell running on RunPod Serverless (RTX 4090), costed at approximately $0.001/image (Story 2.1; ADR-0001 Path A). The project now needs to add an **image-to-image (i2i)** capability so that consumers of servegate — and future apps in the same portfolio — can submit `(input image + text instruction) → edited image`.

Three constraints shaped this decision and eliminated most candidates:

1. **Commercial license is required day one, across the product portfolio.** Not a SaaS-TOS license from a hosted API provider, but a license on the model weights that permits perpetual commercial redistribution across multiple products without per-seat / per-MAU caps and without vendor approval rails.
2. **Per-image ongoing cost must not scale linearly with a vendor invoice.** Hosted API providers (BFL, Google Gemini, OpenAI) charge $0.039–$0.045 per image. Across a portfolio growing to 100k+/month this becomes a fixed tax on every product — economically unacceptable for a capability meant to be reusable infrastructure.
3. **Existing RunPod Serverless stack must be reusable.** The schnell T2I path already runs here at ~$0.001/image; adding i2i as a second workflow branch in the same handler avoids standing up new infrastructure.

These three constraints together eliminate every hosted API and every Non-Commercial-weight model.

Three exploratory decision branches were evaluated before arriving here:

1. **Self-host FLUX.1-Kontext-[dev]** — rejected: FLUX.1 [dev] Non-Commercial License blocks commercial portfolio use.
2. **BFL hosted API (FLUX.2 [pro])** — rejected: $0.045/image perpetual cost, vendor lock, per-image invoice scales linearly with portfolio volume.
3. **Self-hosted commercially-licensed open-weight model (this ADR)** — accepted.

Detailed candidate analysis is in [`research-commercial-i2i-models.md`](./research-commercial-i2i-models.md). Economics comparison is in [`cost-comparison-i2i-providers.md`](./cost-comparison-i2i-providers.md).

## Decision

**servegate will self-host `Qwen/Qwen-Image-Edit` (Alibaba, Apache 2.0, released 2025-08-19) on the existing RunPod Serverless endpoint as the image-to-image inference model for this product and for future portfolio apps.**

Specific choices:

- **Model variant:** `qwen_image_fp8_e4m3fn` + Qwen2.5-VL encoder + Qwen-Image VAE (all Apache 2.0)
- **Inference acceleration:** Lightning 8-step LoRA (community-distributed, Apache 2.0) to bring inference time to ~34s warm at 1024² on RTX 4090
- **Runtime:** ComfyUI native workflow (already the runtime for the existing T2I schnell path)
- **Deployment:** additive to existing network volume; handler branches between T2I and i2i based on presence of `input_image_b64` in request payload
- **SDK surface:** new `edit()` method in `@jhonata-matias/flux-client` v0.3.0 (additive, non-breaking for existing `generate()` consumers)
- **Gateway:** existing async submit/poll contract (ADR-0002) absorbs i2i with zero contract change

## Rationale

### Why Qwen-Image-Edit specifically

| Competitor | License | Verdict |
|---|---|---|
| **Qwen-Image-Edit** ⭐ | **Apache 2.0** | Selected |
| OmniGen2 | Apache 2.0 | Community consensus (April 2026): *"not quite there yet"* — quality/consistency insufficient for user-facing product |
| HiDream-E1.1 | MIT transformer + **Llama 3.1 Community License** on text encoder | Fails portfolio-wide Apache test: Llama license imposes 700M MAU cap and *"Built with Llama"* attribution requirement — a license complication this decision is explicitly designed to avoid |
| FLUX.1-schnell + ControlNet + IP-Adapter | Apache 2.0 stack | Cannot do instruction-based editing; only structural/style transfer. Wrong tool for the use case |
| FLUX.1-Kontext-[dev] / FLUX.2-[dev] / FLUX.1-Fill / FLUX.1-Redux | **FLUX Non-Commercial License** | Commercial use prohibited |
| Stable Diffusion 3.5 Medium/Large | Stability Community License ($1M annual revenue cap) | Fails Apache criterion; also no native i2i pipeline |
| SDXL 1.0 + img2img + ControlNet | CreativeML OpenRAIL-M | Commercial use permitted but with use restrictions; model is two generations older; weaker quality on instruction editing |
| Playground v2.5 / v3 | Playground Community License | No instruction-edit variant |
| Z-Image-Edit | Apache 2.0 (announced) | **Not released as of 2026-04-23** — watch-list for 90-day review |
| Step1X-Edit | Apache 2.0 (to verify) | Community reception not yet mature — watch-list for 90-day review |

### Why self-host vs hosted API

| Factor | Hosted API (BFL, Gemini) | Self-host Qwen |
|---|---|---|
| Per-image cost at 100k/mo | $3,950–$4,500/mo | ~$887/mo (~5× cheaper) |
| Per-image cost at 1M/mo | $39,500–$45,000/mo | ~$8,870/mo |
| Annualized savings at 100k/mo | — | ~$37k–$44k/yr |
| Portfolio reusability | Pay per app | Single deploy, all apps reuse |
| License clarity | SaaS TOS (can change) | Apache 2.0 (immutable) |
| Data residency | Prompts + images transit vendor infra | All stays on our RunPod |
| Vendor risk | BFL outage = feature down | None |
| Privacy / PII disclosure | Required in TERMS | Not required |
| Quality (April 2026) | Kontext-class (gold standard) | ~80-85% of Kontext on worst case (localized precision edits); parity to surpassing on color/text/style |

## Known Gotchas & Mitigations

The community has reported real issues with base Qwen-Image-Edit that will affect some user prompts. These are accepted into the product with the following mitigations:

| Gotcha | Source | Mitigation |
|---|---|---|
| Changes aspect ratio / zoom of output vs input | HF discussion #11; multiple reviews | Post-process: crop or resize output to match input dimensions before returning. Document as known behavior. |
| Crops or outpaints background on simple edits | HF discussion thread; r/StableDiffusion chatter | Prompt engineering guidance in docs (*"keep background unchanged"*). Future: ControlNet canny/depth overlay to preserve structure. |
| 1 megapixel maximum input | Model card | SDK downsamples inputs >1 MP client-side. Document as API constraint. |
| Square (1:1) aspect ratio degrades coherence | GitHub issue #243 | API/SDK rejects exact 1:1 or converts to 16:15 or 15:16 internally. Document. |
| "Plastic-y feel" on base outputs | Oxen.ai fine-tuning comparison | Use Qwen-Image-Edit 2509 or 2511 checkpoint (newer, improved). Fine-tune with portfolio-specific data when a specific app has volume to justify. Community LoRAs from CivitAI for vertical use cases. |
| Quality degrades on sequential edits | Multiple reviews | Documentation: prefer single-call comprehensive edits. Future API: optional `final_pass` flag for multi-step workflows. |

None of these mitigations requires changing the core architecture.

## Contract Summary

### Request (extends existing `POST /jobs`)

```jsonc
{
  "prompt": "add a red hat to the cat",
  "input_image_b64": "<base64 PNG or JPEG, ≤8 MB decoded, ≤1 MP>",  // presence triggers i2i path
  "strength": 0.85,           // optional, 0.0-1.0, maps to KSampler denoise
  "steps": 8,                 // default 8 (Lightning LoRA); 50 if Lightning disabled
  "seed": 12345,              // optional
  "aspect_ratio": "16:9"      // optional; rejects exact "1:1"
}
```

### Response (same shape as existing T2I; AD-1 from ADR-0002 preserved)

```jsonc
{
  "output": {
    "image_b64": "<base64 PNG>",
    "metadata": { "seed": 12345, "elapsed_ms": 34000 }
  }
}
```

### Async contract

Unchanged from ADR-0002. Client submits via `POST /jobs`, polls `GET /jobs/{job_id}` until `200`.

## Consequences

### Positive

- **Apache 2.0 across the inference stack** — no per-seat / per-MAU caps, no attribution requirements, no TOS revocation risk. The capability becomes a reusable asset across the product portfolio.
- **Economics scale sublinearly** — per-image inference cost stays at ~$0.009/image at any volume; no vendor invoice grows with success.
- **Single runtime** — both T2I and i2i run on the same ComfyUI-on-RunPod deploy; operational surface doesn't grow.
- **Data residency** — user images never leave our infrastructure; TERMS/PRIVACY do not need a third-party data processor clause for i2i.
- **Preserves existing contracts** — async submit/poll from ADR-0002, image_b64 inline from AD-1, SDK retry logic, rate-limit layer — all unchanged.
- **Vendor-independence** — if the model ecosystem shifts (Z-Image-Edit, Step1X-Edit, Qwen successors), migration is a weight swap, not a re-architecture.

### Negative

- **~15-20% quality gap vs Flux Kontext on localized precision edits** at the time of this decision. Acceptable for alpha; revisited at 90-day review.
- **Cold start cost increases** — adding a ~20 GB UNet weight to the serverless network volume extends first-invocation load time. Approximate impact: +20-30s on worst-case cold start; amortized across many warm invocations in practice.
- **Known gotchas** (see above) mean some user edit requests will produce suboptimal output until mitigations are in place. Transparent documentation is required.
- **Longer implementation** — ~4-5 dev-days vs ~2 dev-days that a hosted-API integration would require. One-time cost, amortized across every future app that uses this capability.
- **ComfyUI workflow complexity grows** — handler.py branches by payload shape; more code paths to test.

### Neutral

- Multi-provider gateway abstraction introduced earlier (`JobMapping.upstream` field, separate upstream modules) is retained. Even though Qwen self-host is the selected path, the gateway stays shaped for future provider additions (e.g., optional BFL fallback for premium-quality edits in a higher tier).

## Pivot Criteria (90-day review — target 2026-07-23)

This decision is accepted with a 90-day review clock. The decision is revisited if any of the following hold:

1. **Quality complaints from alpha users** materially exceed a threshold (to be set by @pm — e.g., >15% of i2i requests generate user-reported quality issues).
2. **Newer Apache-licensed edit model reaches Kontext parity** — specifically: Qwen-Image-Edit v2512+, Z-Image-Edit at release, Step1X-Edit maturity, or an unannounced successor. Re-benchmark and swap weights if one materially surpasses current Qwen.
3. **BFL introduces open-weight Apache-licensed variant** of Kontext or FLUX.2 family (unlikely but would force reconsideration).
4. **Self-host operational issues** (cold start regression, OOM on production workloads, inference time degradation) prove unrecoverable after two iterations of tuning.
5. **Portfolio economics shift** — if a specific app reaches a volume where fine-tuning becomes cost-justified, revisit the fine-tune vs hosted-premium-tier question for that app specifically (while retaining self-host as portfolio default).

If none of the above trigger, the decision remains in effect and the next review is at 180 days.

## Implementation Notes

### Network volume additions

| File | Size | Source |
|---|---|---|
| `qwen_image_edit_fp8_e4m3fn.safetensors` | ~20.4 GB | Qwen-Image-Edit HF |
| `qwen_image_vae.safetensors` | ~160 MB | Qwen-Image HF |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | ~8 GB | Qwen2.5-VL |
| Lightning 8-step LoRA for Qwen-Image | ~150 MB | ComfyUI community distribution |

Total additional storage ~29 GB. At $0.07/GB/month = **~$2/month additional fixed cost.**

### handler.py changes

New function `build_kontext_workflow(prompt, input_image_b64, strength, seed, steps)` generates the Qwen-Image-Edit ComfyUI graph:

- `QwenImageEditDiffusionModelLoader` → Qwen UNet
- `QwenImageEditVAELoader` → Qwen VAE
- `QwenImageEditCLIPLoader` → Qwen2.5-VL text/image encoder
- `LoadImageBase64` (custom) → decode `input_image_b64`
- `VAEEncode` → input image to latent
- `KSampler` with `denoise=strength`
- `LoraLoader` → Lightning 8-step LoRA
- `CLIPTextEncode` → positive/negative conditioning
- `VAEDecode` → output latent to pixel
- `SaveImage`

`normalize_input` accepts new optional fields: `input_image_b64`, `strength` (0.0-1.0, default 0.85), rejects exact 1:1 aspect ratio with clear error, and enforces ≤1 MP input size.

Dispatch in `handler()`:

```python
if params.get("input_image_b64"):
    workflow = build_kontext_workflow(**params)
else:
    workflow = build_t2i_workflow(**params)  # existing, unchanged
```

### SDK changes

`sdk/src/types.ts` adds `EditInput`, `EditOutput`. `sdk/src/client.ts` adds `edit()` method using the same submit/poll machinery as `generate()`. Client-side image normalization: accept `Buffer | Uint8Array | Blob | string`, encode to base64, verify ≤1 MP (downsample if larger), verify non-1:1 aspect ratio.

### Backward compatibility

- Existing T2I `generate()` callers see zero change.
- Gateway handles legacy (pre-`upstream` field) KV mappings by defaulting `upstream = "runpod"` (see `recommended-approach.md`).
- Async contract and all status codes unchanged per ADR-0002.

## References

- [`recommended-approach.md`](./recommended-approach.md) — architectural plan with phased implementation
- [`research-commercial-i2i-models.md`](./research-commercial-i2i-models.md) — full candidate comparison + community sentiment synthesis
- [`cost-comparison-i2i-providers.md`](./cost-comparison-i2i-providers.md) — stakeholder cost analysis
- [`project-analysis.md`](./project-analysis.md) — current-state architecture inventory
- [`adr-0001-flux-cold-start.md`](./adr-0001-flux-cold-start.md) — Path A cold-start decision (still in effect)
- [`adr-0002-async-gateway-pattern.md`](./adr-0002-async-gateway-pattern.md) — submit/poll contract (reused)
- [Qwen-Image-Edit model card (HF)](https://huggingface.co/Qwen/Qwen-Image-Edit) — Apache 2.0 license text
- [Qwen-Image-Edit ComfyUI deployment docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image) — workflow + inference time benchmarks
- [Fine-tuned Qwen-Image-Edit vs Nano-Banana vs FLUX Kontext Dev — Oxen.ai](https://ghost.oxen.ai/fine-tuned-qwen-image-edit-vs-nano-banana-and-flux-kontext-dev/)

## Change Log

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-04-23 | @architect (Aria) | Initial draft. Decision: Qwen-Image-Edit self-host, Apache 2.0, Lightning 8-step LoRA acceleration. Awaiting @pm license review and @po story validation. |
| 1.1 | 2026-04-23 | @pm (Morgan) | **Status: Proposed → Accepted.** Apache 2.0 portfolio-wide commercial scope validated (unconditional, no revenue/MAU caps, preserve NOTICE file only). TERMS/PRIVACY updates scoped as minor-additive (on-infra processing declaration; no third-party data processor clause). Epic 3 created at `docs/prd/epic-3-image-to-image-capability.md`. Handoff to @sm for Story 3.1 drafting. |
