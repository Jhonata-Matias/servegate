# Deep Research — Self-Hosted i2i Models with Commercial-Permissive Licenses

**Generated:** 2026-04-23
**Prepared by:** @architect (Aria)
**Scope:** Systematic evaluation of open-weight image-to-image / instruction-editing models with licenses that permit commercial SaaS use, deployable on our existing RunPod Serverless RTX 4090 (24 GB) infrastructure.
**Driving question:** Does a credible self-hosted alternative to BFL FLUX.2 [pro] ($0.045/image) exist at materially lower per-image cost under a commercial-permissive license, as of April 2026?
**Bottom line (spoiler, superseded by [ADR-0003](./adr-0003-image-to-image-model-selection.md)):** Viable Apache 2.0 candidates exist (Qwen-Image-Edit Apache 2.0, OmniGen2 Apache 2.0, HiDream-E1.1 MIT), with an estimated ~5× per-image cost advantage vs BFL FLUX.2 [pro]. Community consensus as of April 2026: no open-weight model has closed Flux Kontext's lead on localized precision edits — base Qwen-Image-Edit shows specific production-quality gotchas (background cropping, aspect-ratio shifts, 1 MP input cap).

> **⚠️ Decision that actually shipped (ADR-0003, 2026-04-23):** After this research + a subsequent user directive prioritizing **portfolio-wide Apache 2.0 licensing for future commercial apps**, the chosen path is **Qwen-Image-Edit self-hosted as primary** (not BFL; not as Phase-2 fast-follow). The "~20% quality gap vs Kontext" is accepted in exchange for (a) no per-image vendor invoice across the portfolio, (b) Apache 2.0 license clarity for commercial redistribution, (c) data residency on our infra. All known gotchas have documented mitigations. See [`adr-0003-image-to-image-model-selection.md`](./adr-0003-image-to-image-model-selection.md) for the formal decision record, and [`recommended-approach.md`](./recommended-approach.md) v0.3 for the current architectural plan. **The §6.6 "Revised verdict" below preserves the intermediate BFL-primary recommendation as decision-trail evidence — it is not the final call.**

---

## 1. License Framework Used

Models are grouped by **commercial-use permissiveness** — not raw "openness":

| Tier | License families | Commercial SaaS eligible? |
|---|---|---|
| **A. Unconditionally permissive** | Apache 2.0, MIT, CC0, BSD | ✅ Yes, no strings |
| **B. Conditionally permissive** | Stability AI Community License ($1M annual revenue cap), CreativeML OpenRAIL-M (commercial OK w/ use restrictions), Playground Community License, Llama 3.1 Community License (700M MAU cap + attribution) | ⚠️ Yes with conditions |
| **C. Non-commercial** | FLUX [dev] Non-Commercial, FLUX.2 [dev] Non-Commercial, SD Non-Commercial Research | ❌ **Disqualified** |

Note on FLUX.2 [dev]: the public web chatter around "FLUX.2 VAE Apache 2.0" is technically correct for the VAE component **only**. The 32B main transformer is under the FLUX.2 [dev] Non-Commercial License per the model card. **Disqualified from this evaluation.**

---

## 2. Part 1 — Tier A Candidates (Apache 2.0 / MIT / BSD)

### 2.1 Qwen-Image-Edit (Alibaba, Aug 2025) — **Top candidate**

| Field | Value |
|---|---|
| Model page | [huggingface.co/Qwen/Qwen-Image-Edit](https://huggingface.co/Qwen/Qwen-Image-Edit) |
| License | **Apache 2.0** (quoted verbatim: *"Qwen-Image is licensed under Apache 2.0"*) |
| Publisher | Alibaba Qwen team |
| Release | 2025-08-19 (paper [arXiv:2508.02324](https://arxiv.org/abs/2508.02324), 2025-08-04) |
| Parameters | **20B** |
| Architecture | Qwen2.5-VL (semantic) + VAE Encoder (appearance) — dual-path i2i |
| Primary capability | **Instruction-based image editing** (add/remove/modify objects, style transfer, rotation, IP creation). Bilingual (CN/EN) text-in-image editing. |
| VRAM (fp8_e4m3fn) | **20.4 GB** — fits on RTX 4090 (24 GB), uses ~86% VRAM per ComfyUI docs |
| VRAM (bf16) | 40.9 GB — does not fit on 4090 |
| Inference @ 1024² (fp8) | **~71s warm, ~94s cold** (first gen) per ComfyUI RTX 4090D benchmarks |
| Inference @ 1024² (fp8 + Lightning 8-step LoRA) | **~34s warm, ~55s cold** |
| Diffusers | ✅ `QwenImageEditPipeline` |
| ComfyUI | ✅ **Native** workflow (built-in templates) |
| Benchmarks | Claim: *"state-of-the-art (SOTA) performance in image editing"* — card provides no numeric comparisons vs Flux Kontext |

**Verdict — i2i fitness:** Strong fit. License is unconditionally permissive. Native instruction editing is the model's purpose. fp8 quantization lands it safely on 24 GB VRAM. The Lightning 8-step LoRA is the key enabler for cost — drops inference by ~50%.

---

### 2.2 OmniGen2 (Vector Space Lab, June 2025)

| Field | Value |
|---|---|
| Model page | [huggingface.co/OmniGen2/OmniGen2](https://huggingface.co/OmniGen2/OmniGen2) |
| License | **Apache 2.0** |
| Publisher | Vector Space Lab |
| Release | 2025-06-16 (initial); 2025-06-24 (tech report) |
| Parameters | Not explicitly stated on model card |
| Primary capability | **Unified**: T2I + instruction-guided editing + in-context multi-image composition + visual understanding |
| Architecture | Built on Qwen-VL-2.5 |
| VRAM (native) | **~17 GB** → fits comfortably on RTX 4090 |
| VRAM (with cpu_offload) | ~8.5 GB |
| VRAM (sequential_cpu_offload) | <3 GB (slower) |
| Diffusers | ✅ `OmniGen2Pipeline` |
| ComfyUI | ✅ Official integration since 2025-07-01 |
| Positioning | Explicitly marketed in community as "open-source FLUX Kontext alternative" per [HF blog post](https://huggingface.co/blog/azhan77168/omnigen2) |
| Benchmarks | Released their own `OmniContext` benchmark; no published Kontext head-to-head |
| Inference time @ 1024² | **Not in the fetched docs** — needs benchmarking on our hardware |

**Verdict:** Apache 2.0 + native i2i + fits 17 GB + unified gen/edit + ComfyUI official support. Strong candidate but missing the hard inference-time data we have for Qwen-Image-Edit. **Treat as co-top candidate pending a spike measurement.**

---

### 2.3 HiDream-I1 / HiDream-E1.1 (HiDream.ai, Apr–Jul 2025)

| Field | Value |
|---|---|
| Edit model page | [huggingface.co/HiDream-ai/HiDream-E1-1](https://huggingface.co/HiDream-ai/HiDream-E1-1) |
| Transformer license | **MIT** (quoted: *"The Transformer models in this repository are licensed under the MIT License"*) |
| Dependent component licenses | VAE from FLUX.1-schnell (Apache 2.0 ✅) · T5 encoder (Apache 2.0 ✅) · **Meta-Llama-3.1-8B-Instruct text encoder (Llama 3.1 Community License ⚠️)** |
| Publisher | HiDream.ai |
| Release | E1-Full 2025-04-28; E1.1 update 2025-07-16 |
| Parameters | 17B (from I1; E1 built on same backbone) |
| Primary capability | Instruction-based image editing |
| Diffusers | ✅ `HiDreamImageEditingPipeline` |
| ComfyUI | ❌ Not mentioned on model card (may exist via community) |
| VRAM | **Not specified** on card; 17B is similar to Qwen-Image-Edit's 20B — likely needs quantization to fit on 24 GB |
| Published benchmarks (EmuEdit Avg / ReasonEdit) | **HiDream-E1.1: 7.57 / 7.70**; Gemini-2.0-Flash 5.99/6.95; UltraEdit 4.07/2.89 — strong result, but no Kontext comparison |
| Inference time @ 1024² | **Not specified** on card |

**License wrinkle — Llama 3.1 Community License:** HiDream-E1.1 uses Meta-Llama-3.1-8B-Instruct as a text encoder. Llama 3.1 Community License permits commercial use but imposes:

1. **700M monthly-active-users cap** on commercial use (far above our alpha/scaling range — non-issue in practice).
2. **Attribution requirement**: products must display *"Built with Llama"* in UI or documentation.
3. **Acceptable Use Policy** compliance (no weapons, CSAM, etc. — standard).

For servegate, this is workable (display the attribution in TERMS + footer) but represents a **non-zero legal/UX overhead** vs Apache/MIT-only options.

**Verdict:** Credible but lower priority than Qwen-Image-Edit and OmniGen2 due to (a) the Llama license wrinkle, (b) no ComfyUI native support documented, (c) inference benchmarks not public for our hardware.

---

### 2.4 AuraFlow v0.3 (Fal.ai, 2024)

Not fetched in depth. Known facts: Apache 2.0, 6.8B params, text-to-image flow model. No native i2i / editing pipeline — would require img2img + ControlNet tooling (ControlNet for AuraFlow is less mature than for SDXL/Flux). **Lower priority.**

---

### 2.5 Z-Image-Edit (announced, not yet released)

Per [BentoML Open-Source Image Generation Models (2026) guide](https://www.bentoml.com/blog/a-guide-to-open-source-image-generation-models), Z-Image includes a planned edit variant under Apache 2.0. **Not evaluable — not released as of 2026-04-23.** Watch-list item.

---

## 3. Part 2 — Tier B Candidates (Conditionally Permissive)

### 3.1 Stable Diffusion 3.5 Medium (Stability AI, 2024)

| Field | Value |
|---|---|
| License | **Stability AI Community License** ([full text](https://stability.ai/community-license-agreement)) |
| Commercial-use clause | *"Free for research, non-commercial, and commercial use for organizations or individuals with less than $1M in total annual revenue"* |
| Enterprise tier | Above $1M/yr → Stability Enterprise License (contact sales) |
| i2i support | ❌ **Not native** — card documents T2I only; no native `img2img` pipeline, ControlNet for SD 3.5 Medium is immature |

**Verdict — disqualified for this use case.** Even if the license is fine, SD 3.5 Medium is not architected for instruction editing. It would require img2img + ControlNet-Union + potentially IP-Adapter stacking, none of which is officially supported as of April 2026.

### 3.2 SDXL 1.0 + img2img + ControlNet-Union + IP-Adapter (Stability AI, 2023)

Mature, well-documented stack. License: **CreativeML OpenRAIL-M** (commercial allowed, with use restrictions on harmful content). Weight quality for i2i is adequate but several generations behind Flux/Kontext/Qwen-Edit. Included for completeness — would only make sense if a specific niche (legacy pipelines, very strong ControlNet coverage) demanded it.

### 3.3 Playground v2.5 / v3 (Playground, 2024)

Playground Community License — allows commercial use with some conditions. Native T2I only; no instruction-edit variant. Disqualified for this use case.

---

## 4. Part 3 — Composable Apache-Only Path (FLUX.1-schnell + Adapters)

Can we stack existing Apache-licensed components to get instruction editing without a new base model?

### 4.1 Component inventory

| Component | License | Status for FLUX.1 |
|---|---|---|
| FLUX.1-schnell base | Apache 2.0 | Already deployed |
| ControlNet-Union (InstantX / Xlabs / Shakker) | Various — InstantX ControlNet-Union for Flux: Apache 2.0 | Mature, actively maintained |
| IP-Adapter for Flux (Xlabs) | Apache 2.0 | Released 2024; Image-conditioned generation |
| InstantID for Flux | Apache 2.0 | Face-focused identity preservation |
| InstantStyle | Apache 2.0 | Style transfer via reference image |

### 4.2 What this stack can and can't do

**Can do:**
- Pose/depth/canny-guided generation (via ControlNet) — strong for structure-preserving edits.
- Image-conditioned generation (via IP-Adapter) — strong for style transfer or "make it look like this reference".
- Identity preservation across edits (via InstantID) — narrow use case.

**Can NOT do well:**
- **Instruction-based editing** ("add a hat to the cat", "remove the background", "make it a watercolor") — this is Kontext's core capability. The schnell + adapters stack can approximate some of these via careful ControlNet + prompt engineering, but it's fundamentally a different paradigm. Per community reports ([r/StableDiffusion](https://www.reddit.com/r/StableDiffusion/), HF discussions), instruction-following for specific edits is where schnell-stack falls short vs Kontext-class models.

### 4.3 Verdict

**Viable as a specialized tool, not as a Kontext replacement.** If the product's i2i surface were narrowed to "style transfer and pose control", the schnell+adapters stack could work at near-T2I cost (~$0.002/image). For the general "send me an image + tell me what to change" experience stakeholders likely want, this is the wrong tool.

---

## 5. Part 4 — Cost Analysis & Honest Verdict

### 5.1 Per-image cost on RunPod Serverless RTX 4090 (Flex: $0.000261/sec)

Assumes warm inference, 1024×1024 output, single-image edit.

| Path | Inference time @ 1024² | Cost / image (Flex) | Ratio vs BFL FLUX.2 [pro] ($0.045) | Ratio vs current T2I ($0.0009) |
|---|---|---|---|---|
| **Current T2I** — FLUX.1-schnell, fp8, 4 steps | 3.5s | **$0.00091** | 0.02× | 1× (baseline) |
| **Qwen-Image-Edit (fp8, 50 steps default)** | ~71s | **$0.0185** | 0.41× | ~20× |
| **Qwen-Image-Edit (fp8 + Lightning 8-step LoRA)** ⭐ | ~34s | **$0.00887** | **0.20×** (5× cheaper) | ~10× |
| **OmniGen2** (native, no quant required) | unknown — est. 30-60s | **~$0.008-0.016** (est.) | ~0.18-0.36× | ~9-17× |
| **HiDream-E1.1** (17B, likely fp8) | unknown — est. 50-80s | **~$0.013-0.021** (est.) | ~0.29-0.47× | ~14-23× |
| **Schnell + adapters** (for structural edits only) | ~5-8s | **~$0.0013-0.002** | 0.03-0.04× | ~1.5-2× |
| **BFL FLUX.2 [pro]** | (hosted by BFL) | $0.045 | 1× | ~50× |
| **Gemini 2.5 Std** | (hosted by Google) | $0.0395 | 0.88× | ~43× |

> Estimates marked "est." assume 40-80s plausible inference time — **these must be validated by a benchmark on our hardware before committing to the cost case.**

### 5.2 Monthly spend at stakeholder-scale volumes

Using **Qwen-Image-Edit + Lightning LoRA ($0.00887/img)** as the pragmatic target:

| Monthly volume | Qwen-Edit self-host | BFL FLUX.2 [pro] | Gemini 2.5 Std | Monthly savings (vs BFL) |
|---|---|---|---|---|
| 10.000 | $88.70 | $450 | $395 | **$361** |
| 100.000 | $887 | $4.500 | $3.950 | **$3.613** |
| 1.000.000 | $8.870 | $45.000 | $39.500 | **$36.130** |

**At 1M imgs/mo, the annualized savings vs BFL are ~$433k/year** — meaningful enough to justify meaningful engineering investment.

### 5.3 Caveats on the estimates

1. **Inference time is from third-party benchmarks** (ComfyUI RTX 4090D docs for Qwen-Image-Edit). Our RunPod 4090 may differ slightly. A 1-hour benchmark on our Pod validates this.
2. **Cold start cost is excluded.** Adding a 20 GB Qwen-Image-Edit weight to the serverless worker will make the cold-start-on-new-worker meaningfully more expensive than schnell alone. If cold-start frequency is low (few per day), the amortized cost bump is negligible; if high, it adds ~$0.03-0.04 per cold start. **30-day review criterion already scheduled** (Epic 2 governance, 2026-05-21).
3. **Quality parity is not validated.** Benchmark scores (Qwen-Edit's SOTA claim, HiDream-E1.1 beating Gemini-2.0-Flash on EmuEdit) are encouraging but not a substitute for side-by-side testing on our actual prompts.
4. **Network volume storage** cost: adding ~20 GB of new weights = ~$1.40/mo extra (at $0.07/GB/mo) — negligible.
5. **Engineering cost** to integrate a new model family into `serverless/handler.py` + add a new ComfyUI workflow + SDK wiring: estimated **2-3 dev-days**. Amortized over 12 months at 100k imgs/mo = $301/mo savings; engineering payback period measured in weeks, not months.

### 5.4 Honest verdict

Three findings worth naming plainly:

1. **The original "zero good Apache-licensed i2i alternative exists" stance was wrong.** At least one strong candidate (**Qwen-Image-Edit, Apache 2.0**) and one credible co-candidate (**OmniGen2, Apache 2.0**) are real, deployable on our hardware, and represent a ~5× per-image cost advantage over BFL FLUX.2 [pro].

2. **The cost advantage is ~10× vs T2I baseline, not 40×.** i2i edit models are inherently 10-30× heavier at inference time than a distilled 4-step schnell T2I. No Apache-licensed model closes this gap fully — it's a physics/architecture reality, not a license issue.

3. **The decision now hinges on quality, not cost.** If Qwen-Image-Edit output quality is within ~80-90% of what BFL FLUX.2 [pro] produces on real user prompts, the ~$433k/yr savings at 1M imgs/mo (or ~$40k/yr at 100k imgs/mo) strongly favors self-hosting. If quality is materially worse on edit types users will attempt, BFL remains the right call — the cost savings don't redeem a visibly weaker product. **This is a spike, not a decision paper.**

---

## 6. Community Sentiment — Synthesis (No Own Testing)

Performed 2026-04-23 via web search + fetches across Medium, DigitalOcean, Oxen.ai, r/StableDiffusion references, MyAIForce, ArtificialAnalysis, Diffusion Doodles, and HF model-card discussion threads. **All quotes and claims below are from third-party sources** — substitute for our own side-by-side spike, not a replacement for one at GA.

### 6.1 Qwen-Image-Edit — community verdict: **good but production-gotchas**

**Strengths reported:**
- "Clean, targeted color adjustments" — preferred over Kontext in some color-change tasks
- "SOTA performance in image editing tasks" per public benchmarks (Qwen team claim, unverified head-to-head)
- **Fine-tuned Qwen-Image-Edit reached production quality** in the [Oxen.ai head-to-head](https://ghost.oxen.ai/fine-tuned-qwen-image-edit-vs-nano-banana-and-flux-kontext-dev/) — *"perfect texture, color, chrome gleam, and the logo looks perfect"* vs Flux Kontext which *"struggles to keep consistent style"*
- Newer versions (Qwen-Image-Edit 2509, 2511) reported incrementally better on character consistency per [MyAIForce](https://myaiforce.com/nano-banana-vs-kontext-vs-qwen/)
- Strong text rendering in edits (common fonts)

**Weaknesses reported (these are deal-breakers for a public alpha):**
- *"Changes zoom levels and aspect ratios of the output image compared to the input"* — per [HF discussion #11](https://huggingface.co/Qwen/Qwen-Image-Edit/discussions/11)
- *"Background keeps being cropped or outpainted even when making simple changes"*
- *"Square aspect ratios break the model's coherence"* — specific failure mode
- **Max 1 megapixel input** — hard limit; rules out high-res workflows
- *"Plastic-y feel"* on base (non-fine-tuned) outputs per Oxen.ai
- *"Tends to cause changes outside the targeted area"* — Kontext is the gold standard at *"focus solely on the area being edited, with the rest of the image remaining unchanged"* per [MimicPC comparison](https://www.mimicpc.com/learn/qwen-image-edit-vs-flux-kontext-which-better-for-image-editing)
- Quality degrades on sequential edits — prefer single-call comprehensive edits
- Custom fonts only ~70-80% accurate

**Translation to servegate use case:** Out-of-the-box Qwen-Image-Edit will make users say *"what did it do to my background?"* on a meaningful fraction of first interactions. For an alpha positioning itself as a FLUX-grade API, this is a brand risk. Fine-tuning closes the gap but requires training data + pipeline — not alpha-appropriate investment.

### 6.2 OmniGen2 — community verdict: **not ready for production**

**Representative quotes:**
- From [kombitz ComfyUI test](https://www.kombitz.com/2025/07/04/testing-omnigen2-in-comfyui-vs-flux-1-kontext-a-promising-tool-thats-not-quite-there-yet/): *"results were inconsistent, with the model sometimes ignoring instructions and other times degrading images greatly. The overall quality is low in terms of face, clothing and background detail, with anatomical issues in feet and hands."*
- *"Attempts at simple edits like hair changes resulted in the woman's pose changing to some degree along with background and setting"*
- Reviewer personally preferred Flux Kontext over OmniGen2 in *"most comparisons, with only one exception"*
- Positive exception: *"did well on some tasks and took about 3 minutes to edit clothing, which Kontext won't attempt"*
- Overall: *"not quite there yet"*

**Translation:** Not a credible primary i2i path for a user-facing API in April 2026. Watch the next release.

### 6.3 HiDream-E1.1 — community verdict: **mixed, second-tier**

- Strong EmuEdit / ReasonEdit benchmarks (HiDream team reports HiDream-E1.1 = 7.57 avg vs Gemini-2.0-Flash 5.99) — but **no published Kontext head-to-head**
- [StableDiffusionTutorials review](https://www.stablediffusiontutorials.com/2025/09/hidream-edit-e1.1.html): balanced on *"global edits, text manipulation, color adjustment, style transfer, object removal"*
- One review flagged *"mixed and overall disappointing results"* vs Flux-Dev-Fill for masked inpainting specifically, with *"odd changes, incorrect blending and lighting"*
- ComfyUI native workflow now documented ([ComfyUI HiDream-E1 tutorial](https://docs.comfy.org/tutorials/image/hidream/hidream-e1))
- Llama 3.1 license wrinkle (attribution + 700M MAU cap) remains

**Translation:** Credible second-tier option. Not a standout win over Qwen-Image-Edit, and carries Llama license overhead. Lower priority.

### 6.4 Step1X-Edit — **newly surfaced, deserves watch**

Found during this research round: [Step1X-Edit](https://github.com/stepfun-ai/Step1X-Edit) from Stepfun — self-described as *"SOTA open-source image editing model, which aims to provide comparable performance against the closed-source models like GPT-4o and Gemini 2 Flash"*. Not investigated in depth this round; flag for 30/90-day review.

### 6.5 Consensus across the ecosystem

From the meta-reviews ([Diffusion Doodles model rundown](https://medium.com/diffusion-doodles/model-rundown-z-image-turbo-qwen-image-2512-edit-2511-flux-2-dev-fc787f5e87ad), [SiliconFlow guides](https://www.siliconflow.com/articles/en/best-open-source-AI-for-on-device-image-editing), [KDnuggets editing-AI roundup](https://www.kdnuggets.com/5-open-source-image-editing-ai-models), [BentoML guide](https://www.bentoml.com/blog/a-guide-to-open-source-image-generation-models)):

> **Flux Kontext (proprietary / BFL-hosted commercial) remains the quality bar for localized precision edits. No open-weight model has fully closed the gap as of April 2026.** The gap is narrowest on certain tasks (color changes, global style transfer) where Qwen-Image-Edit is competitive or wins. The gap is widest on the task users most want ("edit this region, leave the rest alone") — where Kontext is still clearly ahead.

### 6.6 Revised verdict (based on sentiment, no spike required)

**Go with BFL FLUX.2 [pro] as primary for alpha.** Reasoning:

1. **Quality gap is user-visible, not theoretical.** Qwen-Image-Edit's background-cropping and aspect-ratio-shifting failure modes will be noticed by users on a meaningful fraction of first interactions. No cost advantage redeems a visibly weaker product at alpha.
2. **Fine-tuning Qwen is feasible but not alpha-appropriate investment** — requires data + training budget + MLOps pipeline we don't currently have.
3. **The field is moving fast** — Qwen-Image-Edit 2511 is reportedly better than the original August 2025 release; Z-Image-Edit, Step1X-Edit, and others are emerging. **90-day revisit is the right cadence, not a Phase-0 commitment.**
4. **5× cost advantage is meaningful only at scale** — at alpha rate-limit (100/day = 3K/mo), the BFL bill is $3-10/mo. Not worth introducing a quality gap to save $20/mo.
5. **Multi-provider architecture** in `recommended-approach.md` §5.5 is still the correct design — we can swap Qwen in later without re-architecting.

**What changes in the plan vs `recommended-approach.md`:** nothing substantive. BFL remains primary. Qwen-Image-Edit (or whichever open model leads in 90 days) becomes a **documented Phase-2 optimization** rather than a "maybe we never do this" afterthought.

---

## 7. Recommended Action Chain

### 7.1 Immediate (this session / next session)

- **Skip the ½-day quality spike** — community sentiment has already answered the question consistently enough to act on.
- **Proceed with ADR-0003** recording: "BFL FLUX.2 [pro] primary; self-host as documented Phase-2 optimization when (a) volume crosses a defined threshold per 30-day review, (b) Qwen/Step1X/successor model reaches parity with Kontext on localized precision edits, OR (c) BFL pricing / TOS materially changes."

### 7.2 Half-day validation spike — @architect + @dev

**Goal:** Measure actual inference time + output quality for Qwen-Image-Edit on the existing Pod (`pod.sh up`, not serverless). Zero commitment, pure data gathering.

**Method:**
1. Deploy Qwen-Image-Edit fp8 to existing Pod (ComfyUI native workflow).
2. Also deploy via BFL API — same 5-10 prompts through FLUX.2 [pro] (via a fresh BFL sandbox key, $5-10 cost).
3. Compare outputs side-by-side for: instruction-following accuracy, subject preservation, prompt adherence, edge artifacts.
4. Measure inference time 3× per prompt for statistical basis.

**Exit criteria:**
- Quality ≥ 90% of BFL on our eval set → **proceed to ADR-0003 recommending self-host**.
- Quality 70-89% of BFL → **proceed with hybrid: BFL for premium tier / high-complexity prompts; self-host for bulk**.
- Quality < 70% of BFL → **BFL-only path**, revisit in 90 days with next Qwen release.

### 6.2 If spike greenlights self-hosting

1. ADR-0003 records the Qwen-Image-Edit (or OmniGen2, if it wins the spike) decision + license chain + fallback to BFL.
2. `serverless/handler.py` extension: new workflow branch for the edit model (mirrors the plan in `recommended-approach.md` §3.1, adjusted for the actual chosen model).
3. Network volume upload of new weights.
4. SDK v0.3.0 `edit()` method — architecturally identical to the BFL-route plan, just different upstream.
5. Keep BFL integration code as a **shadow fallback** — minimal extra engineering, meaningful vendor-risk mitigation.

### 6.3 If spike vetoes self-hosting

Fall back to the plan in `recommended-approach.md`: BFL FLUX.2 [pro] as primary, SDK v0.3.0 ships against BFL. Revisit self-host path in 90 days after newer permissive models (Z-Image-Edit) release or quantization tooling improves further.

---

## 7. Sources

- [Qwen-Image-Edit model card](https://huggingface.co/Qwen/Qwen-Image-Edit)
- [Qwen-Image ComfyUI deployment docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image)
- [Qwen-Image-Edit deep dive (Medium)](https://medium.com/@meshuggah22/qwen-image-edit-a-deep-dive-into-alibabas-open-source-image-editing-model-460618d9a935)
- [OmniGen2 model card](https://huggingface.co/OmniGen2/OmniGen2)
- [OmniGen2 — HF blog post positioning as Kontext alternative](https://huggingface.co/blog/azhan77168/omnigen2)
- [HiDream-E1.1 model card](https://huggingface.co/HiDream-ai/HiDream-E1-1)
- [HiDream-I1-Full model card](https://huggingface.co/HiDream-ai/HiDream-I1-Full)
- [Stable Diffusion 3.5 Medium model card](https://huggingface.co/stabilityai/stable-diffusion-3.5-medium)
- [Stability AI Community License](https://stability.ai/community-license-agreement)
- [FLUX.2-dev model card (reference — disqualified)](https://huggingface.co/black-forest-labs/FLUX.2-dev)
- [BFL Commercial Licensing](https://bfl.ai/licensing)
- [BFL Self-Hosted Commercial License Terms](https://bfl.ai/legal/self-hosted-commercial-license-terms)
- [BentoML — Open-Source Image Generation Models Guide (2026)](https://www.bentoml.com/blog/a-guide-to-open-source-image-generation-models)
- [Flowith — 10 Best Flux Alternatives (2026)](https://flowith.io/blog/10-best-flux-alternatives-open-commercial-ai-image-generation-2026/)
- [Pixazo — Best Open-Source AI Image Generation Models (2026)](https://www.pixazo.ai/blog/top-open-source-image-generation-models)
- Internal: [`recommended-approach.md`](./recommended-approach.md) · [`cost-comparison-i2i-providers.md`](./cost-comparison-i2i-providers.md) · [`project-analysis.md`](./project-analysis.md)
