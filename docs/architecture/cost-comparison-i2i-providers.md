# Cost Comparison — Image-to-Image Providers

**Generated:** 2026-04-23
**Prepared by:** @architect (Aria)
**Purpose:** Stakeholder decision artifact — comparing **current provider (Google Gemini 2.5 Flash Image / "Nano Banana")** against **proposed provider at the time (Black Forest Labs — FLUX family)** for servegate's image-to-image (editing) workload.

> **⚠️ Superseded by [ADR-0003](./adr-0003-image-to-image-model-selection.md) (2026-04-23, same day).** This doc compared **Gemini vs BFL hosted APIs** — both of which were ultimately rejected in favor of **self-hosted Qwen-Image-Edit (Apache 2.0, ~$0.009/image)**. The comparison below remains useful as **stakeholder-facing evidence for why a per-image vendor invoice was deemed economically wrong for a portfolio-grade capability** — but the verdict at the bottom ("ship on BFL FLUX.2 [pro]") does not reflect the current decision. For the chosen path and revised cost envelope, see [`adr-0003-image-to-image-model-selection.md`](./adr-0003-image-to-image-model-selection.md) + [`recommended-approach.md`](./recommended-approach.md) §6.
>
> **Context for readers arriving fresh:** this document was generated while evaluating option set {Gemini, BFL} against each other. A third option — **Apache 2.0 self-host** — entered scope later the same day after deeper research ([`research-commercial-i2i-models.md`](./research-commercial-i2i-models.md)) and a user directive prioritizing portfolio commercialization freedom. That third option is what actually ships.

> **TL;DR of the Gemini-vs-BFL analysis (historical).** Gemini 2.5 Flash Image at Standard tier (**~$0.0395/img for i2i**) is **the cheapest commercially-licensed hosted-API i2i path** currently available at scale. Moving to BFL **FLUX.2 [pro]** costs **+13.9% per image** (**$0.045/img**). Moving to BFL **FLUX.1 Kontext [pro]** is **+1.3% per image** (**$0.04/img**) — essentially price-parity. Non-cost factors (quality on specific edit types, vendor diversification, licensing clarity, latency, moderation behavior) must carry the case for the switch. **Superseding insight:** neither option is the right choice once Apache-licensed self-hosted Qwen-Image-Edit enters consideration — both are ~4-5× more expensive per image than the chosen path and lock the capability to a vendor invoice at portfolio scale.

---

## 1. Unit Pricing (Official, 2026-04-23)

All prices USD, per image at 1024×1024 output. i2i = sending (input image + prompt) and receiving an edited image.

### 1.1 Google — Gemini 2.5 Flash Image (Nano Banana)

Token-based; "1 image at 1024×1024 = 1,290 output tokens"; priced at $30 per 1M output tokens for the image modality.

| Tier | Output image (1024×1024) | Input image (same size) | Realistic total per i2i call* | Latency profile | Source |
|---|---|---|---|---|---|
| **Standard** (real-time user-facing) | **$0.0387** | ~$0.000387 (1290 input tokens × $0.30/1M) | **~$0.0395** | Sync/streaming — seconds | [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Batch (up to 24h async) | $0.0195 | ~$0.000194 | ~$0.02 | Deferred — up to 24h | idem |
| Flex | $0.0195 | same as Batch input | ~$0.02 | Variable | idem |
| Priority | $0.0702 | $0.000697 | ~$0.071 | Lowest latency | idem |

*Assumes a ~500-token text prompt (+ $0.00015) and one 1024×1024 input image. Scales linearly with output resolution: 2048×2048 ≈ 4× tokens ≈ **~$0.155/img** at Standard.

### 1.2 Black Forest Labs — FLUX family

Credit-based (1 credit = $0.01 USD). Editing prices shown; output is a signed URL (10-min TTL).

| Model | Endpoint | Editing price / image | Pricing mode | Source |
|---|---|---|---|---|
| **FLUX.1 Kontext [pro]** | `POST /v1/flux-kontext-pro` | **$0.04** (4 credits, flat) | Flat | [docs.bfl.ml/quick_start/pricing.md](https://docs.bfl.ml/quick_start/pricing.md) |
| **FLUX.2 [pro]** ⭐ BFL-recommended default for editing | `POST /v1/flux-2-pro` | **$0.045** (from, scales by megapixel) | Per MP ("first MP flat, then additional MP adds") | idem |
| FLUX.2 [flex] | `POST /v1/flux-2-flex` | $0.06 | Flat | idem |
| FLUX.2 [max] | `POST /v1/flux-2-max` | from $0.07 | Per MP | idem |
| FLUX.1 Kontext [max] | `POST /v1/flux-kontext-max` | $0.08 (8 credits, flat) | Flat | idem |
| FLUX.2 [klein 4B] | `POST /v1/flux-2-klein-4b` | from $0.014 | Per MP | Preview — pricing may change |
| FLUX.2 [klein 9B] | `POST /v1/flux-2-klein-9b` | from $0.015 | Per MP | Preview |

---

## 2. Monthly Cost at Volume — Primary Comparison

Scenario: **all requests are image-to-image at 1024×1024** (baseline resolution). Numbers assume the **user-facing** (Standard / Pro) tiers on each side — batch/flex is a different product category.

| Monthly volume | Gemini 2.5 Standard (~$0.0395) | BFL FLUX.1 Kontext [pro] ($0.04) | BFL FLUX.2 [pro] ($0.045) | Δ vs Gemini — FLUX.2 [pro] | Δ vs Gemini — Kontext [pro] |
|---|---|---|---|---|---|
| **100 imgs/mo** (heavy testing) | $3.95 | $4.00 | $4.50 | +$0.55 (+14%) | +$0.05 (+1%) |
| **1,000 imgs/mo** (pre-launch) | $39.50 | $40.00 | $45.00 | +$5.50 (+14%) | +$0.50 (+1%) |
| **10,000 imgs/mo** (early product) | $395 | $400 | $450 | +$55 (+14%) | +$5 (+1%) |
| **50,000 imgs/mo** (growth) | $1,975 | $2,000 | $2,250 | +$275 (+14%) | +$25 (+1%) |
| **100,000 imgs/mo** (scale) | $3,950 | $4,000 | $4,500 | **+$550** (+14%) | **+$50** (+1%) |
| **500,000 imgs/mo** | $19,750 | $20,000 | $22,500 | +$2,750 (+14%) | +$250 (+1%) |
| **1,000,000 imgs/mo** (heavy scale) | $39,500 | $40,000 | $45,000 | **+$5,500/mo** (+14%) | **+$500/mo** (+1%) |

**Annualized at 1M imgs/mo:** FLUX.2 [pro] = $540,000/yr · Gemini Std = $474,000/yr · delta **$66,000/yr**.

---

## 3. Budget-Tier Comparison (async-tolerant workloads only)

If the product can tolerate async delivery (hours, not seconds — e.g., scheduled batch jobs, overnight pipelines), Gemini's **Batch tier at $0.02/img** undercuts every BFL option. **BFL does not offer a comparable batch discount** in the public API.

| Monthly volume | Gemini Batch (~$0.02) | BFL Kontext [pro] ($0.04) | Δ (BFL extra over Gemini Batch) |
|---|---|---|---|
| 10,000 imgs/mo | $200 | $400 | **+$200 (+100%)** |
| 100,000 imgs/mo | $2,000 | $4,000 | **+$2,000 (+100%)** |
| 1,000,000 imgs/mo | $20,000 | $40,000 | **+$20,000 (+100%)** |

**Implication:** if any meaningful share of servegate's i2i volume can be served asynchronously (e.g., a "processing queue, delivered within 24h" product surface), Gemini retains a **2× cost advantage** at that workload tier.

---

## 4. Resolution Scaling

Cost behavior differs by pricing model. For a single edit, as output resolution grows:

| Output size | Gemini Std (token-based) | BFL Kontext [pro] (flat) | BFL FLUX.2 [pro] (per-MP) |
|---|---|---|---|
| 512×512 (0.25 MP) | ~$0.010 | $0.04 | ~$0.045 (floor) |
| 1024×1024 (1 MP) | ~$0.039 | $0.04 | $0.045 |
| 2048×2048 (4 MP) | **~$0.155** | **$0.04** ⭐ | ~$0.09-0.14 (est.) |
| 3072×3072 (9 MP) | ~$0.349 | **$0.04** ⭐ | ~$0.14-0.22 (est.) |

**Key insight:** Gemini's token-based pricing punishes large outputs — at 2048×2048 it's **4× its own 1024 price**. BFL Kontext [pro] remains **flat $0.04 regardless of size**. **If meaningful volume runs at >1 MP, BFL Kontext [pro] becomes strictly cheaper than Gemini.**

---

## 5. Non-Cost Factors (Stakeholder-Level)

| Factor | Google Gemini 2.5 Flash Image | BFL FLUX.2 [pro] / Kontext [pro] |
|---|---|---|
| **Core capability** | General multimodal; image-gen is one modality of a chat-shaped API | Dedicated image-editing model family; instruction-following is the core product |
| **Licensing** | Google Cloud / Gemini API Terms — standard SaaS | BFL commercial API terms — pay-per-use, no minimum |
| **Data handling** | Google policy — customer data not used for model improvement when billed (paid tier); governed by Google Cloud DPA | BFL policy — to confirm retention window; built-in NSFW/CSAM filter; `safety_tolerance` 0-6 lever |
| **Vendor concentration** | Adds to existing Google dependency if any (GCP, Workspace, Ads) | Independent vendor — diversifies concentration |
| **API pattern** | Sync request/response streaming | Async submit → polling_url → get_result (**1:1 match with servegate's existing async contract** — ADR-0002) |
| **Output delivery** | Inline bytes in response | **Signed URL, 10-min TTL** → requires download-and-rehost in our gateway (see `recommended-approach.md` §5.1) |
| **Max input images** | Multiple via multimodal context | Up to 4 (Kontext) or 10 (FLUX.2 [flex]) reference images |
| **Batch discount** | **50% off** via Batch API (async, up to 24h) | None published |
| **Moderation tuning** | Fixed by Google policy | `safety_tolerance` parameter 0-6 exposed |
| **SLA / status transparency** | Google Cloud SLA tiers (standard, committed-use discounts) | No public SLA numbers as of 2026-04-23 |
| **Lock-in risk** | High on Google ecosystem | Lower — BFL is a single-product vendor; migration to Replicate/fal.ai/self-host is ~1 module swap in our gateway |
| **Quality (instruction-following edits)** | Strong — Gemini 2.5 Flash Image is Google's best-in-class edit model as of 2025 | Strong — FLUX.2 and Kontext are purpose-built for instruction-based editing; independent benchmarks show both families competitive, task-dependent |

---

## 6. Decision Matrix — Reading the Numbers

| If stakeholder priority is… | Recommendation |
|---|---|
| **Lowest unit cost at 1024×1024 scale** | Stay on Gemini Standard ($0.0395/img) — ~14% cheaper than FLUX.2 [pro] |
| **Lowest unit cost across all resolutions** | **Switch to BFL Kontext [pro] ($0.04/img flat)** — wins at 1 MP by $0.0005 and wins dramatically at >1 MP |
| **Best model-to-purpose fit (dedicated editing model family)** | Switch to BFL — FLUX.2 [pro] is BFL's current default for editing workflows; Kontext is the legacy instruction-edit model |
| **Vendor diversification / reduce Google concentration** | Switch to BFL |
| **Lowest async/batch cost** | Stay on Gemini Batch ($0.02/img) — 2× cheaper than any BFL option; only applicable if workload can tolerate up to 24h latency |
| **Simplest integration into servegate** | Switch to BFL — async submit/poll pattern is 1:1 with our existing ADR-0002 contract; SDK retrofits cleanly |
| **Highest flexibility on resolution pricing** | Switch to BFL Kontext [pro] — flat $0.04 regardless of output MP |
| **Minimum stakeholder/legal overhead** | Stay on Gemini if GCP DPA already exists and covers Gemini API scope |

---

## 7. Recommended Path for servegate

Based on the architectural analysis in [`recommended-approach.md`](./recommended-approach.md):

1. **Switch primary i2i provider to BFL.** Rationale is **not** cost — Gemini Standard is marginally cheaper at 1 MP. Rationale is (a) stronger fit with servegate's existing async submit/poll architecture (zero protocol adaptation), (b) vendor diversification, (c) flat-price Kontext [pro] wins at any resolution >1 MP, (d) purpose-built editing model family.
2. **Ship on FLUX.2 [pro]** ($0.045/img) per BFL's own default recommendation — newer architecture, BFL-preferred.
3. **Fallback to FLUX.1 Kontext [pro]** ($0.04/img flat) if cost pressure from stakeholders outweighs the model generation difference — architecturally identical integration, only the endpoint path changes.
4. **Preserve Gemini integration as a hot fallback** (optional) — implementing multi-provider shape in the gateway means we can keep Gemini in config as secondary for disaster recovery; near-zero incremental cost to do so.
5. **Budget posture:** at alpha rate-limit (100/day global, ~3K/mo peak utilization) the cost delta over Gemini is **~$20/month**. Stakeholder framing should focus on architecture and strategy, not unit economics at this stage. Re-evaluate at 30-day review (2026-05-21) with real usage data and BFL quality observations.

---

## 8. Assumptions & Caveats

- All BFL prices per [docs.bfl.ml/quick_start/pricing.md](https://docs.bfl.ml/quick_start/pricing.md) snapshot 2026-04-23. BFL pricing can change without notice.
- Gemini prices per [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) snapshot 2026-04-23. Subject to Google's published tier structure changes.
- Gemini per-image cost calculation uses 1,290 output tokens × $30/1M tokens = $0.0387; plus ~$0.0008 for (input prompt + input image tokens) at 1024×1024 → total ~$0.0395. Actual costs vary with prompt length and input image size.
- BFL FLUX.2 pricing is "from $0.045" (per-MP scaling); 1024×1024 ≈ 1 MP baseline. Larger output resolutions cost proportionally more.
- Priority, Flex, and Batch tier prices for Gemini image generation are published; SLAs on those tiers differ and may not be appropriate for real-time user-facing flows.
- Neither provider publishes volume-discount tiers below $1M annual spend; contact sales for enterprise terms at that scale.
- Rate-limit differences (requests per minute, per day, per account) are NOT factored in this cost comparison — they may affect achievable volume under either provider independently of unit price.
- This document is decision support, not a contract. Final pricing at execution time controls.

---

## 9. References

- Google: [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Google (Vertex AI): [cloud.google.com/vertex-ai/generative-ai/pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- BFL: [docs.bfl.ml/quick_start/pricing.md](https://docs.bfl.ml/quick_start/pricing.md)
- BFL OpenAPI spec: [api.bfl.ai/openapi.json](https://api.bfl.ai/openapi.json)
- BFL integration guide: [docs.bfl.ml/api_integration/integration_guidelines.md](https://docs.bfl.ml/api_integration/integration_guidelines.md)
- Internal context: [`recommended-approach.md`](./recommended-approach.md), [`project-analysis.md`](./project-analysis.md)
