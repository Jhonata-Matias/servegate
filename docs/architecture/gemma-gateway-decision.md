---
title: Gemma Gateway Decision — Reuse Worker + SSE Streaming Contract
date: 2026-04-24
author: "@architect (Aria)"
status: Draft
epic: Epic 4 — Gemma text generation
phase: Phase 0.3 — Gateway reuse decision
workflow: wf-gated-model-serve
depends_on: gemma-provider-assessment.md
constitution_trace: "FR-gateway, FR-streaming, FR-auth, FR-rate-limit; Article IV — No Invention"
---

## Executive Summary

**Reuse the existing Cloudflare Worker at `gateway/`** and add a **NEW text-gen route namespace `/v1/generate`** alongside the existing `/jobs` (image) routes. Adopt **SSE streaming as the primary response mode** with non-streaming fallback on `?stream=false`. The request/response contract is a thin pass-through of OpenAI's chat completions format, so the gateway's job is: **auth → rate-limit → proxy SSE from RunPod → client**. Cloudflare Workers fully support this (no wall-clock limit on streaming, 10k subrequests/invocation, native `TransformStream`/`ReadableStream`). Rate-limiting switches from per-call to **per-key-per-day token budget** for text-gen (tokens are the real cost driver, not call count). Image routes (`POST /jobs`, `GET /jobs/{id}`) remain 100% unchanged — zero regression risk. Worker code gains ~200 lines; no new deploy surface.

---

## 1. Reuse vs New Worker — Decision: REUSE

### Tradeoff

| Factor | Reuse existing `gateway/` | New `gateway-text/` worker |
|---|---|---|
| Auth KV binding reuse | Yes, same `GATEWAY_API_KEY` & `RATE_LIMIT_KV` | Requires duplicating bindings |
| Rate-limit counter coherence across text + image | **Shared budget** possible if desired | Impossible without cross-worker KV sharing |
| Deploy complexity | One `wrangler deploy` | Two wranglers, two domains, two cert chains |
| Blast radius of bug | Text bug could theoretically affect image path | Isolated |
| Routing namespace clarity | `/jobs` vs `/v1/generate` — clear | Different hostnames — also clear |
| SDK consumer experience | One base URL | Two base URLs to configure |
| Cold-start & bundle size | Adds ~200 LOC (~5KB) — negligible | Net new worker |
| Observability | One log stream | Two log streams |

### Decision: **Reuse** — the isolation benefit of a separate worker doesn't justify duplicating deploy infra when the new code path is fully decoupled at the route level. The "could affect image path" risk is addressed by keeping the existing `/jobs` handlers literally untouched and adding the text path as a new routing branch.

### Constraint (CON — added for Story 4.2)
> **CON-text-routing:** Implementing `/v1/generate` MUST NOT modify any line of code inside `handleSubmit`, `handleStatus`, or the RunPod image-gen client. Text-gen code lives in new modules (`runpod-text.ts`, `sse.ts`, `generate.ts`). Verified by QA gate via `git diff` scope check.

---

## 2. Streaming Decision — SSE Primary, Non-Streaming Fallback

### Recommendation: **Support both, default to SSE.**

| Mode | Endpoint | DX | When to use |
|---|---|---|---|
| **SSE streaming (default)** | `POST /v1/generate` with `Accept: text/event-stream` or `stream: true` in body | Tokens appear as they're generated — ChatGPT-like UX. TTFT visible ~1s, not blocked on full completion. | Any interactive client (web UI, CLI REPL) |
| Non-streaming | `POST /v1/generate` with `stream: false` | Simpler — single JSON response. Easier for scripts, batch jobs, tests. | Scripts, evals, non-UI consumers |

### Why SSE beats polling for text-gen
- Text generations are **tens of seconds long** (Gemma 3 4B on L4 at ~40 tok/s → 500 tokens in 12s) — polling is wasteful and glitchy.
- SSE is the de-facto industry standard (OpenAI, Anthropic, Google AI Studio all use it).
- RunPod's vLLM worker already produces SSE natively via `/openai/v1/chat/completions` with `stream: true` — our job is literally just pass-through.

### Why NOT copy the image-gen async-polling pattern
- Async-polling exists for image-gen because a single image takes 30–90s and can't fit in a sync HTTP response budget reliably. Text-gen's first token is ≤2s — the problem doesn't apply.
- Consumer ergonomics dramatically worse (SDK would need async iteration on polled chunks — uncanny).

---

## 3. Cloudflare Worker SSE Feasibility

### Verified against Apr 2026 CF limits

| Constraint | Limit (Paid plan) | Fit for our use case |
|---|---|---|
| Wall-clock while client connected | **No limit** | Streams of 60–300s are trivial |
| CPU time per request | Default 30s, raise to 5min via `wrangler.toml` `cpu_ms = 300000` | Proxying an SSE stream is I/O-bound — CPU time stays low (<5s) even on long streams |
| Subrequest limit | 10,000/request (effectively lifted post Feb 2026) | We do 1 subrequest per call |
| Response body size | No enforced limit | N/A |
| Simultaneous waiting connections | 6 per invocation | We have 1 upstream call per request |

### Streaming implementation pattern (ready for Story 4.2)
```typescript
async function handleGenerate(req: Request, env: Env): Promise<Response> {
  // 1. auth + rate-limit (shared helpers from existing worker)
  // 2. Parse body, force stream:true if client Accept header is text/event-stream
  const upstream = await fetch(
    `https://api.runpod.ai/v2/${env.RUNPOD_TEXT_ENDPOINT_ID}/openai/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
    },
  );

  // 3. If streaming: return upstream body DIRECTLY — CF streams it through.
  if (upstream.headers.get('content-type')?.includes('text/event-stream')) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-RateLimit-Limit': '...',
        'X-RateLimit-Remaining': '...',
      },
    });
  }

  // 4. Non-streaming: await JSON, reshape minimally, return 200.
  const json = await upstream.json();
  return Response.json(json, { status: 200, headers: {...} });
}
```
Critically: **`new Response(upstream.body, ...)` passes the `ReadableStream` through unchanged.** CF Workers' runtime preserves streaming without buffering. No `TransformStream` plumbing needed unless we want to **observe** the stream (e.g., count tokens for rate-limit post-accounting). For Story 4.2 alpha, pure pass-through is sufficient.

### Token counting for rate-limit (optional, Story 4.3+)
If we later enforce per-token budgets in real time, we'd interpose a `TransformStream` that parses each SSE `data: {...}` frame, extracts `choices[0].delta.content` length, and decrements the budget mid-stream. Complexity trade-off: adds CPU cost + latency. Defer until Story 4.3 unless cost runaway forces it earlier.

---

## 4. Contract Draft — `POST /v1/generate`

### Request
```http
POST /v1/generate HTTP/1.1
Authorization: Bearer <api-key>        # same X-API-Key / Bearer auth scheme as existing
Content-Type: application/json
Accept: text/event-stream               # or application/json for non-streaming

{
  "model": "google/gemma-3-4b-it",      # optional; defaults to alpha model
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Write a haiku about clouds."}
  ],
  "max_tokens": 512,                    # optional, capped at 2048 alpha
  "temperature": 0.7,                   # optional, 0.0–2.0
  "top_p": 0.95,                        # optional
  "stream": true                        # optional; inferred from Accept header if absent
}
```

### Response — streaming (200 OK, `text/event-stream`)
Standard OpenAI SSE frames passed through unchanged:
```
data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":""},"index":0}]}

data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"Clouds"},"index":0}]}

data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":" drift"},"index":0}]}

...

data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}

data: [DONE]
```

### Response — non-streaming (200 OK, `application/json`)
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1714003200,
  "model": "google/gemma-3-4b-it",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "Clouds drift silent white / ..."},
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 42, "completion_tokens": 17, "total_tokens": 59}
}
```

### Error shape (4xx/5xx, `application/json`)
Consistent with existing image-gen gateway error shape:
```json
{"error": "rate_limit_exceeded", "limit": 50000, "reset_at": "2026-04-25T00:00:00.000Z"}
```

### Error code table
| HTTP | `error` code | Cause |
|---|---|---|
| 400 | `invalid_json`, `invalid_request`, `missing_messages` | Malformed body |
| 401 | `unauthorized` | Bad/missing API key |
| 403 | `model_not_allowed` | User requested a model not enabled for their key |
| 413 | `request_too_large` | Total token count exceeds `MAX_MODEL_LEN` |
| 429 | `rate_limit_exceeded` | Daily token budget exhausted |
| 502 | `upstream_error` | RunPod returned 5xx |
| 503 | `upstream_unavailable` | Connection/timeout to RunPod |
| 504 | `generation_timeout` | Stream exceeded 300s wall clock |

### Headers (all responses)
```
X-RateLimit-Limit: 50000          # daily token budget
X-RateLimit-Remaining: 48230      # tokens left today
X-RateLimit-Reset: 2026-04-25T00:00:00.000Z
X-Gateway-Model: google/gemma-3-4b-it
```

---

## 5. Rate-Limit Strategy — Per-Day Token Budget

### Current state (image-gen)
`gateway/src/rate-limit.ts`: **daily limit of 100 requests** per global counter (not per-key — single shared key today). Simple, stateful, KV-backed, UTC-midnight reset.

### Problem for text-gen
A text request can cost anywhere from 10 tokens (trivial) to 8000 tokens (max-context generation). Per-call counting massively over- or under-charges.

### Recommendation: **Per-day token budget, post-accounting**

| Parameter | Alpha value | Rationale |
|---|---|---|
| Budget | **50,000 tokens/day** global | At ~$0.10/M tokens pass-through cost on L4 → ~$0.005/day ceiling. Generous for alpha without burning money. |
| Reset | UTC midnight | Match existing image-gen pattern |
| Enforcement point | **Pre-flight (approximate) + post-flight (accurate)** | See below |
| KV key | `tokens:YYYY-MM-DD` | Parallel namespace to existing `count:YYYY-MM-DD` |

### Enforcement mechanism

1. **Pre-flight check (fast):**
   Estimate `max_possible_tokens = prompt_token_count + max_tokens`. If `current_budget_used + max_possible_tokens > 50000` → 429 immediately. This prevents one request from blowing the budget.
   *Prompt token count is approximated as `len(body_json) / 4` — cheap and good-enough for gating.*

2. **Post-flight accounting (accurate):**
   After the stream closes (or on non-streaming response), read `usage.total_tokens` from the final frame/JSON → increment `tokens:{date}` by that amount. Done via `event.waitUntil(...)` so the client response isn't blocked.

3. **Fallback on missing usage data:**
   If upstream didn't include `usage` (some streaming responses don't), fall back to `max_possible_tokens` as the accounted cost (pessimistic — encourages upstream to report accurately).

### Alternative considered: per-call counter
Rejected. 100 req/day is insufficient for text (scripts, chatbots do 10s of calls/session) AND over-generous for max-context calls. Token budget is the industry standard for LLM rate-limiting.

### Future (Story 4.3+): Per-key, multi-tier budgets
When we have multiple API keys issued, extend KV key format to `tokens:{api-key-hash}:{date}` with per-key limits. Out of scope for Story 4.2.

---

## 6. CORS & Auth Reuse

### Auth — no changes needed
Existing `validateAuth` in `gateway/src/auth.ts` accepts `Authorization: Bearer <key>` or `X-API-Key: <key>` against `env.GATEWAY_API_KEY`. Text-gen route reuses the identical helper. One shared API key for alpha; multi-key comes later.

### CORS — audit & extend
Check existing CORS config (not visible in the current index.ts — likely none or minimal). For the landing page's web UI to call `/v1/generate` from the browser, we'll need:
```
Access-Control-Allow-Origin: <landing-origin>  # specific, not *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key
Access-Control-Max-Age: 86400
```
Add a global `OPTIONS` preflight handler at the Worker entry point (before route matching). Covers both `/jobs` and `/v1/generate` uniformly — likely a small win for the image path too.

---

## 7. Backwards Compatibility with Image-Gen Routes

### Guarantee: **zero changes to existing behavior**

| Route | Before | After |
|---|---|---|
| `POST /jobs` | Image submit | Unchanged |
| `GET /jobs/{id}` | Image status | Unchanged |
| `POST /` | 404 endpoint_removed | Unchanged |
| `POST /v1/generate` | 405 method_not_allowed | **NEW — text-gen SSE proxy** |
| `POST /v1/generate` with `stream:false` | 405 | **NEW — text-gen non-streaming** |
| `OPTIONS /*` | 405 | **NEW — CORS preflight (global)** |

### Regression prevention
- Existing `gateway/tests/` suite runs unchanged — must continue to pass.
- New tests (Story 4.2) cover `/v1/generate` independently.
- Scope guard in CodeRabbit config: warn on changes to `handleSubmit`, `handleStatus`, `submitJob`, `getStatus` during Story 4.2.

---

## 8. Namespacing Decision — `/v1/generate` vs `/generate`

### Recommendation: `/v1/generate`

- Explicit API versioning from day 1 — we'll have v2 eventually.
- Matches OpenAI's `/v1/chat/completions` mental model — SDK consumers find it familiar.
- Leaves `/v2/generate` room without breaking changes.
- `/jobs` stays unversioned for now (image path predates this discipline; version on next image-path breaking change).

**Alternative `/v1/chat/completions`:** rejected — too literally cloning OpenAI's URL might invite confusion about whether we're a drop-in replacement (we're not — rate limits, auth, model list all differ). `/v1/generate` is clearly ours.

---

## 9. Open Risks for Story 4.2 (Gateway Implementation)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | SSE pass-through via `new Response(upstream.body)` fails in Workers runtime (some runtimes buffer) | High | Spike this FIRST in Story 4.2 Day 1 — live test against a real RunPod vLLM endpoint, write a streaming integration test |
| R2 | Upstream SSE connection drops mid-stream → client sees truncated output with no error | Medium | Detect `upstream.body` close before `[DONE]`; emit synthetic `data: {"error":"upstream_disconnected"}` + close |
| R3 | Token-count accounting races between concurrent requests (KV eventual consistency) | Medium | Accept same eventual-consistency tradeoff as existing image rate-limit (Story 2.5 Risk R7); monitor for budget overshoot |
| R4 | Client disconnects mid-stream — upstream keeps generating, burns tokens we paid for | Medium | Wire `request.signal` abort → upstream `AbortController.abort()`. Ensures we stop the upstream when client goes away. |
| R5 | `Accept` header parsing ambiguity (client sends `*/*`, we need to decide stream vs json) | Low | Precedence: explicit body `stream` field > `Accept: text/event-stream` > default streaming |
| R6 | CORS misconfigured → landing page can't call it | Low | Test from actual landing origin in Story 4.2 QA |
| R7 | Request body exceeds Cloudflare Worker 100MB limit (unlikely but possible with huge conversation history) | Low | Reject at gateway with 413 if `Content-Length > 2MB` (generous for chat) |
| R8 | Rate-limit KV `tokens:` key doesn't exist on first call of day → race between concurrent writes setting initial value | Low | Same pattern as existing `count:` — first reader treats missing as 0, writes new count with TTL. Accept tiny overshoot. |

---

## 10. Sources

- [Cloudflare Workers Limits (2026)](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers Streams Runtime API](https://developers.cloudflare.com/workers/runtime-apis/streams/)
- [Cloudflare Agents HTTP & SSE](https://developers.cloudflare.com/agents/api-reference/http-sse/)
- [Cloudflare Changelog — subrequest limit lifted Feb 2026](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/)
- [RunPod OpenAI Compatibility](https://docs.runpod.io/serverless/vllm/openai-compatibility)
- [runpod-workers/worker-vllm README](https://github.com/runpod-workers/worker-vllm/blob/main/README.md)
- Internal: `gateway/src/index.ts`, `gateway/src/auth.ts`, `gateway/src/rate-limit.ts`, `gateway/src/runpod.ts` (existing patterns to reuse)
- Internal: `docs/architecture/gemma-provider-assessment.md` (Phase 0.2 — upstream contract)
