# Privacy Statement — gemma4 FLUX API (Alpha)

**Effective date:** 2026-04-21
**Version:** 0.1.0-alpha

Summary for developers in a hurry: **we don't store your prompts or generated images.** Logs contain only request metadata (timestamp, IP, status, timing). API keys are encrypted at rest.

---

## What we collect

### 1. API request metadata (always logged)

For each request to the Service, the gateway (Cloudflare Worker) logs:

| Field | Example | Purpose |
|---|---|---|
| `timestamp` | `1745186400000` | Request correlation |
| `event` | `proxy_success`, `auth_failed`, `rate_limited` | Debugging + abuse detection |
| `ip` | `203.0.113.42` (Cloudflare `CF-Connecting-IP` header) | Abuse tracking + rate-limit |
| `status` | `200`, `401`, `429`, `504` | Performance monitoring |
| `elapsed_ms` | `7234` | Latency SLA tracking |
| `day_count` | `42` | Rate-limit state |

**Visibility:** accessible via `wrangler tail` (owner only). Not exposed to public dashboards.

**Retention:** Cloudflare Worker logs retained per Cloudflare's standard retention (~7 days on free tier).

### 2. API keys (encrypted at rest)

- Your personal API key is stored as a Cloudflare Worker secret (encrypted with Cloudflare's KMS)
- Keys are **never logged**, **never returned in responses**, and **never visible** via any API
- Rotation: owner can rotate via `wrangler secret put` (invalidates old key)

### 3. Billing data (RunPod)

RunPod maintains independent billing records per endpoint invocation. Those records include:
- Invocation timestamp
- GPU time consumed
- Success/failure status

Owner accesses this via RunPod's billing API for monthly cost review. No per-user attribution.

## What we DO NOT collect

The following are **NEVER logged, stored, or persisted** by the gateway:

- ❌ **Prompt content** — your prompt strings are forwarded to RunPod and discarded immediately after response
- ❌ **Generated image bytes** — `image_b64` payload passes through the gateway without logging; discarded after response
- ❌ **Request bodies** in any form (prompt + params)
- ❌ **Response bodies** beyond HTTP status codes
- ❌ **User identifiers** beyond IP address (no email, no name, no account system)
- ❌ **Cookies or tracking pixels** (gateway is pure HTTP API, no browser-facing surface)

**Verification:** the gateway source code is in `gateway/src/` of this repo. Search for `log(` calls to audit what is emitted. Any future change that logs prompt/image content would require code review.

## Data flow

```
┌────────────┐    POST /       ┌──────────┐   POST      ┌─────────────┐
│  Your app  │ ──────────────► │ Gateway  │ ──────────► │ RunPod      │
│  (client)  │   X-API-Key     │ (CF)     │  Bearer     │ Serverless  │
└────────────┘                 └──────────┘             └─────────────┘
                                     │                         │
                                     ▼                         ▼
                              ┌─────────────┐           ┌──────────────┐
                              │ KV counter  │           │ FLUX model   │
                              │ (date→N)    │           │ (in-memory)  │
                              └─────────────┘           └──────────────┘

In-flight: prompt + image_b64
Logged:    metadata only (no body content)
Stored:    nothing (neither prompt nor image persisted server-side)
```

## Third-party processors

The Service uses these third parties. By using the Service, you accept their processing as part of the pipeline:

| Provider | Purpose | What they see | Privacy policy |
|---|---|---|---|
| **Cloudflare** | Gateway hosting (Workers + KV) | IP, request metadata, rate-limit counter | https://www.cloudflare.com/privacypolicy/ |
| **RunPod** | GPU inference (FLUX model) | Prompt content (in-flight), generated image (in-flight) | https://www.runpod.io/legal/privacy-policy |
| **Hugging Face** | Model weights download (during worker cold init) | N/A at runtime | https://huggingface.co/privacy |

**Note on RunPod:** the Service proxies your prompt to RunPod for inference. RunPod processes prompts in-flight per their privacy policy. Owner does not configure any RunPod-side logging of prompt content.

## Your rights (LGPD Brazil + GDPR EU)

Even though we collect minimal data, you have rights:

- **Access:** request copy of logs related to your IP within a time window (email owner via GitHub issue)
- **Deletion:** request log deletion (limited — Cloudflare retention ~7d auto-deletes)
- **Rectification:** not applicable (we don't store personal data)
- **Objection:** stop using the Service = stop data collection
- **Data portability:** not applicable (no user account data to export)

Response time: 30 days (LGPD standard).

## Cookies

The Service is a pure HTTP API. No cookies are set by the gateway. If you use the SDK from a browser context, the SDK itself doesn't set cookies.

## Analytics

The Service does not use web analytics (Google Analytics, Mixpanel, etc.) on its API endpoints. If a future web demo (Story 2.3) is deployed with Vercel Analytics, its scope will be documented separately.

## Children

The Service is not directed at children under 13 (COPPA) or 18 (LGPD for minors). Owner does not knowingly collect data from minors.

## Changes

Privacy Statement may be updated. Material changes will be announced via:

- Commit to `docs/legal/PRIVACY.md` in the repo
- Update to version number at top of this file

## Contact

- Privacy questions: GitHub issue tagged `privacy`
- Security incidents: GitHub issue tagged `security-incident`
- Key rotation: see `docs/usage/dev-onboarding.md`

---

**Version history:**

| Version | Date | Notes |
|---|---|---|
| 0.1.0-alpha | 2026-04-21 | Initial alpha Privacy Statement — logs metadata only, no prompt/image retention |
