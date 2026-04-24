# ADR-0004: Gemma Text Generation Stack — Self-Hosted Gemma 3 via RunPod worker-vllm

## Status

**Accepted**

Date: 2026-04-24 (Proposed → Accepted same day via Story 4.1 QA gate PASS 92/100)
Proposed by: @architect (Aria) — Phase 0.4 of `wf-gated-model-serve`
Accepted by: @po (Pax) — FOUNDATION_SET (GMS_FND_001) GO verdict (5/5 criteria), composite gate 92/100
Gate record: [`docs/qa/gates/4.1-gemma-foundation.yml`](../qa/gates/4.1-gemma-foundation.yml)

Next gate: Story 4.2 must spike SSE pass-through (`new Response(upstream.body, …)` against real RunPod vLLM endpoint) before further implementation, per gateway-decision Risk R1.

## Context

servegate (codename `gemma4`) currently exposes **image generation and editing** via FLUX.1-schnell (T2I) + Qwen-Image-Edit (i2i) running on a single RunPod Serverless endpoint with ComfyUI + custom `handler.py`. Gateway, SDK (`@jhonata-matias/flux-client@0.3.0`), rate-limit (100 img/day global), TERMS/PRIVACY, and alpha-access flow are all established (Epics 1–3, shipped 2026-04-24).

We now add a **text-generation** capability to the same product. Three constraints shape this decision:

1. **Cost ceiling at alpha:** target ≤ **<alpha cost ceiling>** at ~100 calls/day global rate-limit. The existing image-gen product runs at roughly <incremental cost> at the same volume; text-gen should not dominate that budget.
2. **Portfolio reusability:** same reusability bar as Epic 3. License on the model weights must allow perpetual commercial redistribution across multiple future products without per-seat / per-MAU caps or vendor approval rails.
3. **Reuse existing stack:** RunPod account, Cloudflare Worker gateway, SDK build/publish pipeline, alpha-access issue template, rate-limit KV, TERMS/PRIVACY scaffold. Do not stand up a second infrastructure stack.

A fourth constraint is implicit: the project's code-name is `gemma4` and the user's explicit directive was to use **Google Gemma via HuggingFace**. This is not an open competitive evaluation — the model family is user-selected. Phase 0 work therefore focused on (a) choosing the **right Gemma variant** across 270m/1b/4b/12b/27b/3n, (b) the **right serving runtime**, (c) the **right gateway integration**.

Detailed candidate analysis is in [`gemma-model-candidates.md`](./gemma-model-candidates.md). Provider integration plan is in [`gemma-provider-assessment.md`](./gemma-provider-assessment.md). Gateway reuse + streaming contract is in [`gemma-gateway-decision.md`](./gemma-gateway-decision.md). Unit economics are in [`cost-model-text-gen.md`](./cost-model-text-gen.md).

## Decision

**servegate will self-host `google/gemma-3-4b-it` as the default alpha text-gen model on a new RunPod Serverless endpoint running `runpod-workers/worker-vllm:v2.14.0`, fronted by the existing Cloudflare Worker gateway on a new `/v1/generate` route with native SSE streaming, rate-limited by a 50,000-tokens-per-day global budget.**

Specific choices:

- **Alpha model:** `google/gemma-3-4b-it` on **L4 24GB** RunPod serverless (flex), `bf16`, `MAX_MODEL_LEN=8192`
- **Premium tier (pre-approved for Story 4.3+):** `google/gemma-3-27b-it` on A100 80GB (flex), same worker image, no architectural changes
- **Runtime:** `runpod-workers/worker-vllm:v2.14.0` (official, OpenAI-compatible `/openai/v1/chat/completions`)
- **Weight storage:** RunPod **network volume** mounted at `/runpod-volume`, shared across workers (NOT baked Docker image)
- **Endpoint topology:** NEW dedicated serverless endpoint `endpoint-text-gen-alpha`; existing `endpoint-image-gen` stays untouched
- **Gateway:** REUSE existing Cloudflare Worker at `gateway/`. Add new route `POST /v1/generate` alongside `POST /jobs`. Zero changes to image-gen routes.
- **Response mode:** SSE streaming (default) with non-streaming JSON fallback on `stream: false`
- **Rate-limit:** **50,000 tokens/day global**, post-flight accounting from upstream `usage.total_tokens`, KV key `tokens:YYYY-MM-DD` parallel to existing `count:YYYY-MM-DD`
- **Auth:** Reuse existing `Authorization: Bearer` / `X-API-Key` scheme unchanged
- **SDK:** `@jhonata-matias/flux-client@0.4.0` adds `client.generate({ messages, model?, stream? })` — additive, non-breaking (generate(), edit() remain intact)
- **pt-BR roadmap:** official [GAIA fine-tune](https://huggingface.co/CEIA-UFG/Gemma-3-Gaia-PT-BR-4b-it) (CEIA-UFG + Google DeepMind) pre-approved as drop-in swap if pt-BR quality becomes a differentiator — no infra change needed

## Rationale

### Why Gemma 3 4B as alpha default (vs 1b, 12b, 27b, 3n)

| Variant | Cost @ 100 calls/day | Quality (MMLU-Pro) | Cold-start | pt-BR | Verdict |
|---|---|---|---|---|---|
| gemma-3-270m-it | ~$1/mo | below-usable | instant | weak | **Reject** — quality floor too low |
| gemma-3-1b-it | ~$2/mo | 14.7% | ~30s | marginal | **Reject** — marginal savings, sharp quality drop |
| **gemma-3-4b-it** ⭐ | **<alpha range>** | **43.6%** | **~50s** | **good (GAIA base)** | **Selected** — sweet spot |
| gemma-3-12b-it | ~$11–14/mo | 60.6% | ~85s | strong | Hold as tier-2 fallback |
| gemma-3-27b-it | ~$27/mo | 67.5% | ~140s | strongest | Pre-approved premium tier |
| gemma-3n-E2B/E4B | N/A | mobile-optimized | — | — | **Reject** — designed for edge; no server-side advantage |

The 4B model **already surpasses Gemma-2-27B-IT** on most benchmarks per the [Gemma 3 technical report](https://arxiv.org/abs/2503.19786) — we get "last year's flagship quality" at a 4B footprint. Cost headroom allows full-budget (~<alpha cost ceiling>) even at 10× alpha volume (1,000 calls/day).

### Why RunPod worker-vllm (vs TGI, vs custom vLLM container, vs direct TGI)

| Option | Pro | Con |
|---|---|---|
| **worker-vllm:v2.14.0** ⭐ | Official RunPod image, OpenAI-compatible, SSE native, FlashBoot integrated, stable env-var config | One-release-per-month cadence, `v2.14` pinned (not `latest`) |
| Hugging Face TGI | Equally capable | No RunPod-official maintained image; we'd build our own; maintenance debt |
| Custom vLLM container | Full control | Reinventing wheel; no cost justification at alpha |
| RunPod `/runsync` native shape (non-OpenAI) | Simpler for one request | No streaming; poor DX; breaks industry-standard client expectations |

### Why self-host (vs hosted API like Google AI Studio, Groq, Together)

| Factor | Hosted API (AI Studio / Groq / Together) | Self-host Gemma (this ADR) |
|---|---|---|
| License clarity | SaaS TOS (can change) | Gemma Terms of Use (immutable + commercial OK) |
| Per-token cost at 50k tokens/day | $0 (AI Studio free tier); $0.10–$0.50 (Groq/Together) | ~$0.005/day = $0.15/mo GPU |
| Data residency | Prompts transit vendor infra | All stays on our RunPod |
| Rate-limit control | Vendor-imposed | Ours (50k tokens/day alpha, tunable) |
| Portfolio reusability | Per-app vendor keys | Single infra, all apps reuse |
| DX parity with image-gen | Different stack, different key | Same stack, same key, same gateway |

Google AI Studio **would** be cheaper at $0 and is a legitimate alternative. It was rejected in the Phase 0 alignment question because the user explicitly chose "self-hosted serverless ~$5-10/mo (Recommended)" — preserving control, portfolio reusability, and stack coherence with image-gen.

### Why SSE streaming (vs async submit/poll)

- Text gen TTFT is ≤ 2s — fits a sync HTTP response budget.
- Industry standard (OpenAI, Anthropic, Google AI Studio all use SSE).
- RunPod worker-vllm emits SSE natively via `/openai/v1/chat/completions` — gateway is pure pass-through.
- The image-gen async-polling pattern (ADR-0002) exists because images take 30–90s; text-gen does not have that latency profile.

### Why reuse existing Cloudflare Worker (vs new worker)

- Shared auth + rate-limit KV bindings
- One deploy surface, one log stream
- Adds ~200 LOC to an existing ~1,500-LOC worker — negligible bundle impact
- Image-gen regression risk mitigated by **CON-text-routing** constraint (new modules `runpod-text.ts`, `sse.ts`, `generate.ts`; zero diff on `handleSubmit`/`handleStatus`/`runpod.ts`)

### Why per-day token budget (vs per-call counter)

- Text calls vary 10–8,000 tokens; per-call over/undercharges
- Token budget is industry standard for LLM rate-limit
- Post-flight accounting from upstream `usage.total_tokens` is accurate
- Pre-flight approximate check (`len(body)/4 + max_tokens`) prevents single-call budget blow

## Consequences

### Positive

- **Unit economics stay portfolio-friendly** — <alpha range> at 100 calls/day; scales to <scaled volume range> at 1,000 calls/day. Well inside the <alpha cost ceiling> alpha ceiling with 3–10× traffic headroom.
- **Gemma Terms of Use satisfied** — commercial use permitted; Prohibited Use Policy enforcement added to ToS; no attribution required when serving via hosted API.
- **Single stack for all three modalities** — T2I (FLUX), i2i (Qwen), text-gen (Gemma). Same gateway, same auth, same alpha-access flow, same legal doc pipeline.
- **OpenAI-compatible API** — existing OpenAI SDKs work against `/v1/generate` with just a base-URL swap. Big DX win for early adopters.
- **Streaming first-class** — TTFT in the 1–2s range on warm calls delivers ChatGPT-quality UX.
- **pt-BR upgrade path pre-validated** — GAIA (CEIA-UFG + Google DeepMind) is a drop-in Gemma-3-4b-it derivative; we can swap in a single env-var change if pt-BR quality becomes load-bearing.
- **Premium tier pre-engineered** — `gemma-3-27b-it` on A100 80GB has identical worker contract; rollout is "new endpoint, new route-param, no code change."

### Negative

- **Cold-start is the dominant UX risk.** 60–180s on fresh worker vs 5–15s on FlashBoot revive. The first user of the day pays a visible latency. Mitigations: pre-warm via cron (~$11/mo for 1 always-on L4) or accept worst-case for alpha.
- **Gated model = HF_TOKEN dependency.** EULA must be accepted on the token's HF account before the worker can download weights. One-time setup, rotates every 90 days.
- **New serverless endpoint = new monthly cost line-item.** Separate RunPod endpoint means separate billing granularity to audit.
- **Rate-limit shape changes** — moving from per-call (images) to per-token (text) adds code complexity in the Worker. Acceptable but non-trivial.
- **SSE pass-through is load-bearing.** If a future Cloudflare Workers runtime change breaks `new Response(upstream.body, …)` streaming, we need a fallback (TransformStream shim). Risk tracked as R1 in gateway-decision doc.

### Neutral

- **Worker-vllm version pinning** — we hold at `v2.14.0` (tag pinned), upgrade on explicit story. Matches existing practice on image-gen handler versioning.
- **pt-BR LoRA not needed at launch** — reserve GAIA swap for a follow-up story; ship base `4b-it` first.

## Alternatives Considered

### A. Abandon self-host; proxy Google AI Studio free tier
Rejected per Phase 0 alignment — user explicitly chose self-hosted ~$5–10/mo over $0 AI Studio because of control + portfolio + stack coherence. Keeping AI Studio as a documented fallback in case of RunPod outage (Story 4.3+ consideration).

### B. Hugging Face Inference Endpoints
Rejected — higher cost than self-host at scale ($0.50+/hr for similar GPU tier), less control, vendor-managed scaling that doesn't compose with our rate-limit strategy.

### C. Gemma 2 family (9b / 27b)
Rejected — Gemma 3 ships 2025; benchmarks uniformly better at all sizes; vLLM support equally stable. No reason to pick the older family.

### D. Bake weights into Docker image
Rejected for alpha — 50GB image (4B w/ vision) or 180GB (27B) is operationally painful and FlashBoot neutralizes the cold-start advantage after the first hour of traffic. Revisit if p99 first-boot > 180s consistently.

### E. Extend existing image-gen endpoint to run both
Rejected — different Docker images, different scaling profiles, different GPU fits, blast-radius concern. RunPod serverless endpoints are image-pinned.

### F. `gemma-3-1b-it` or `gemma-3-270m-it` for cheapest possible alpha
Rejected — quality floor below usable for chat. Cost savings ($1–2/mo) trivial vs 4B's ($3/mo).

## Pivot Criteria (90-day review — target 2026-07-23)

This decision is accepted with a 90-day review clock. It is revisited if any of the following hold:

1. **Actual alpha traffic cost exceeds <alpha cost ceiling>** — indicates rate-limit too generous or model too expensive. Likely resolution: tighten daily token budget before switching model.
2. **Cold-start p99 consistently > 180s** on network-volume path — trigger baked-image variant or always-on active worker.
3. **Quality complaints from alpha users** materially exceed threshold (>15% of sessions reporting low-quality responses). Likely resolution: swap to 12B on L40S (Tier 1.5 fallback) or 27B on A100 (premium tier).
4. **pt-BR quality drives ≥ 30% of complaints** — swap base model to GAIA fine-tune (`CEIA-UFG/Gemma-3-Gaia-PT-BR-4b-it`) in a single `MODEL_NAME` env-var change.
5. **RunPod worker-vllm v2.15+ introduces breaking env-var changes** — upgrade via explicit story; do not auto-track.
6. **Google ships Gemma 4 family with materially better quality/cost** — benchmark and swap within the Gemma family (same worker, same contract).
7. **Unexpected HF_TOKEN revocation or Gemma Terms change** — AI Studio fallback pattern engaged per Alternative A.

If none trigger, next review is at 180 days.

## Implementation Notes

### RunPod endpoint config (alpha, for `@devops` at deploy time)

```yaml
name: endpoint-text-gen-alpha
image: runpod/worker-v1-vllm:v2.14.0   # pinned, NOT :latest
gpu_preference: [L4_24GB, RTX_3090_24GB, A5000_24GB, RTX_4090_24GB]
workers:
  min_idle: 0
  max: 3
  idle_timeout_seconds: 60
flashboot: true
network_volume:
  size_gb: 50
  mount_path: /runpod-volume
execution_timeout_seconds: 300
env:
  MODEL_NAME: google/gemma-3-4b-it
  HF_TOKEN: ${{ RUNPOD_SECRET_HF_TOKEN }}
  MAX_MODEL_LEN: 8192
  GPU_MEMORY_UTILIZATION: 0.90
  MAX_NUM_SEQS: 16
  MAX_CONCURRENCY: 4
  DTYPE: bfloat16
  RAW_OPENAI_OUTPUT: 1
  BASE_PATH: /runpod-volume
```

### Gateway routing (alpha, for `@dev` in Story 4.2)

New module `gateway/src/generate.ts`:

```typescript
export async function handleGenerate(req: Request, env: Env): Promise<Response> {
  if (!(await validateAuth(req, env))) return authError();
  if (!(await rateLimit.checkTokenBudget(env))) return rateLimitError();

  const body = await req.json();
  const wantStream = body.stream ?? req.headers.get('Accept')?.includes('text/event-stream') ?? true;

  const upstream = await fetch(
    `https://api.runpod.ai/v2/${env.RUNPOD_TEXT_ENDPOINT_ID}/openai/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...body,
        model: body.model ?? 'google/gemma-3-4b-it',
        stream: wantStream,
      }),
      signal: req.signal, // propagate client-abort upstream
    },
  );

  if (wantStream) {
    // Pure pass-through — CF Workers preserves the ReadableStream.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-RateLimit-Limit': '50000',
        'X-RateLimit-Remaining': String(await rateLimit.getRemaining(env)),
      },
    });
  }

  const json = await upstream.json();
  event.waitUntil(rateLimit.recordUsage(env, json.usage?.total_tokens ?? 0));
  return Response.json(json);
}
```

### SDK addition (Story 4.3, v0.4.0, for `@dev`)

```typescript
// sdk/src/types.ts
export interface GenerateInput {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

// sdk/src/client.ts
async generate(input: GenerateInput): Promise<GenerateResult>;
async *generateStream(input: GenerateInput): AsyncGenerator<GenerateDelta>;
```

### Backward compatibility

- Existing T2I `generate()` — byte-identical behavior preserved (different semantic from new `generate()` text method; SDK is versioned v0.4.0 with a migration note).
- *Naming conflict handled:* to avoid overloading `client.generate()`, SDK v0.4.0 renames image-gen to `client.text2image()` with a deprecated alias `client.generate()` keeping old behavior until v1.0.0, and exposes a distinct `client.complete()` for text. Final surface TBD in Story 4.3.

### HF_TOKEN setup (one-time, for `@devops` at Story 4.1 kickoff)

1. Maintainer logs into HuggingFace, navigates to google/gemma-3-4b-it, clicks "Agree and access repository" (EULA acceptance).
2. Create read-scoped token with "Read access to contents of all public gated repos you can access."
3. Store in RunPod endpoint env as `HF_TOKEN` OR as RunPod secret `RUNPOD_SECRET_HF_TOKEN`.
4. Add calendar reminder to rotate at 90 days.

### Network volume pre-warm (one-time, for `@devops` at Story 4.1 kickoff)

Run a one-shot RunPod pod attached to the volume with:

```bash
pip install 'huggingface_hub[cli]'
hf download google/gemma-3-4b-it --token "$HF_TOKEN" --local-dir /runpod-volume/models/gemma-3-4b-it
```

Validates token, pre-populates volume, and exercises the ~50GB download path once instead of on every cold start.

## References

- [`gemma-model-candidates.md`](./gemma-model-candidates.md) — Phase 0.1 variant survey
- [`gemma-provider-assessment.md`](./gemma-provider-assessment.md) — Phase 0.2 provider integration plan
- [`gemma-gateway-decision.md`](./gemma-gateway-decision.md) — Phase 0.3 gateway reuse + SSE contract
- [`cost-model-text-gen.md`](./cost-model-text-gen.md) — unit economics projections
- [`adr-0001-flux-cold-start.md`](./adr-0001-flux-cold-start.md) — cold-start pattern precedent
- [`adr-0002-async-gateway-pattern.md`](./adr-0002-async-gateway-pattern.md) — async contract pattern (NOT used for text-gen; cited for distinction)
- [`adr-0003-image-to-image-model-selection.md`](./adr-0003-image-to-image-model-selection.md) — Qwen i2i pattern precedent
- [Gemma Terms of Use](https://ai.google.dev/gemma/terms)
- [Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy)
- [runpod-workers/worker-vllm](https://github.com/runpod-workers/worker-vllm)
- [vLLM Supported Models](https://docs.vllm.ai/en/latest/models/supported_models.html)

## Change Log

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-04-24 | @architect (Aria) | Initial draft. Alpha: `gemma-3-4b-it` on L4; premium tier pre-approved: `gemma-3-27b-it` on A100. Gateway reuse + SSE streaming + 50k tokens/day rate-limit. Awaiting @pm cost-ceiling sign-off + @po Story 4.1 validation. |
| 1.1 | 2026-04-24 | @po (Pax) | **Status: Proposed → Accepted.** Story 4.1 QA gate PASS (composite 92/100). FOUNDATION_SET GMS_FND_001: 5/5 GO (FS1 ADR/10, FS2 cost/10, FS3 cold-start 9/10 with empirical measurement deferred to Story 4.2, FS4 secrets/10, FS5 licensing/10). No vetoes triggered. Unblocks Story 4.2 (gateway `/v1/generate` + RunPod text endpoint). Story 4.2 first task mandatory: SSE pass-through spike before any other implementation. |
