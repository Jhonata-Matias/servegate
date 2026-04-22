# servegate FLUX API — Reference  *(formerly gemma4)*

**Status:** Alpha (invite-only) • **Gateway:** live at `gemma4-gateway.jhonata-matias.workers.dev` • **Model:** FLUX.1-schnell (Apache 2.0)

This is the single source of truth for the gateway HTTP contract. For TypeScript, prefer the [SDK](../../sdk/README.md) which wraps this contract with typed errors + retry.

---

## Quickstart (curl)

```bash
# Minimum viable call — generates a 1024×1024 image in ~7s (warm) or ~130s (cold).
curl -X POST https://gemma4-gateway.jhonata-matias.workers.dev \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "prompt": "a peaceful zen garden with cherry blossoms, photorealistic",
      "steps": 4,
      "width": 1024,
      "height": 1024,
      "seed": 42
    }
  }' \
  | jq -r '.output.image_b64' \
  | base64 -d > out.png
```

On success: `out.png` contains the generated image. On failure: jq returns an error string; inspect the raw response with `-i` to see status code + headers.

---

## Endpoint

| | |
|---|---|
| **Base URL** | `https://gemma4-gateway.jhonata-matias.workers.dev` |
| **Path** | `/` (root — any path routes to the generation handler) |
| **Method** | `POST` only (other methods return 405) |
| **Content-Type** | `application/json` (required for body) |

---

## Request

### Headers

| Header | Required | Description |
|---|---|---|
| `X-API-Key` | Yes | Your `GATEWAY_API_KEY` issued during alpha onboarding. Missing or wrong = 401. |
| `Content-Type` | Yes | Must be `application/json`. |

### Body schema

```json
{
  "input": {
    "prompt": "string — required, non-empty",
    "steps": 4,
    "width": 1024,
    "height": 1024,
    "seed": 42
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `input.prompt` | string | Yes | Non-empty. FLUX.1-schnell is tuned for short, descriptive prompts. |
| `input.steps` | integer | Yes | Must be `> 0`. **Recommended: `4`** (FLUX.1-schnell optimum). Higher values don't improve quality meaningfully and increase cost/latency. |
| `input.width` | integer | Yes | Must be `> 0`. Recommended: multiples of 64, max ~1536. Typical: 1024. |
| `input.height` | integer | Yes | Same constraints as `width`. |
| `input.seed` | integer | No | Omit for random; set for reproducibility. |

Invalid types (e.g., `"steps": "4"`) are rejected by the upstream serverless handler with a 400-class error — the gateway does not coerce.

---

## Response — 200 OK (success)

```json
{
  "output": {
    "image_b64": "<base64-encoded PNG bytes>",
    "metadata": {
      "seed": 42,
      "elapsed_ms": 3100
    }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `output.image_b64` | string | Base64-encoded PNG. Decode with `base64 -d` or `Buffer.from(x, 'base64')`. |
| `output.metadata.seed` | integer | Echoes the seed used (request seed or auto-generated). |
| `output.metadata.elapsed_ms` | integer | Upstream RunPod elapsed time — excludes gateway overhead (~5–15 ms typical). |

### Rate-limit headers (on every 200 response)

| Header | Example | Description |
|---|---|---|
| `X-RateLimit-Limit` | `100` | Daily cap (global, all users). |
| `X-RateLimit-Remaining` | `42` | Remaining calls today (pre-response snapshot). |
| `X-RateLimit-Reset` | `2026-04-23T00:00:00.000Z` | ISO-8601 UTC timestamp when the counter resets. |

---

## Error responses

All error responses are JSON with a stable `error` code. Production clients should dispatch on `error` string (not on error message copy).

### 401 Unauthorized

Auth failure. Thrown **before** rate-limit counter increments (no quota consumed).

```json
{"error": "invalid_api_key", "reason": "missing_header"}
```

```json
{"error": "invalid_api_key", "reason": "mismatch"}
```

| `reason` | Meaning | Fix |
|---|---|---|
| `missing_header` | `X-API-Key` header absent. | Send the header. |
| `mismatch` | `X-API-Key` value doesn't match. | Verify key (case-sensitive, no whitespace). |

### 405 Method Not Allowed

Non-POST requests (GET, PUT, DELETE, HEAD, OPTIONS).

```json
{"error": "method_not_allowed", "allowed": "POST"}
```

Response header: `Allow: POST`.

### 429 Too Many Requests

Global daily rate limit (100/day, resets 00:00 UTC) exhausted.

```json
{
  "error": "rate_limit_exceeded",
  "limit": 100,
  "reset_at": "2026-04-23T00:00:00.000Z"
}
```

Response headers:

| Header | Example |
|---|---|
| `Retry-After` | `12345` (seconds until `reset_at`) |
| `X-RateLimit-Limit` | `100` |
| `X-RateLimit-Remaining` | `0` |
| `X-RateLimit-Reset` | `2026-04-23T00:00:00.000Z` |

**Note:** KV eventual consistency can produce ±1–2 overshoot (e.g., request 101–102 may succeed in edge cases). Documented trade-off; acceptable during alpha.

### 502 Bad Gateway

Upstream RunPod returned 5xx. Gateway shields details.

```json
{"error": "upstream_error", "upstream_status": 500}
```

**Retry guidance:** yes, with backoff. Usually transient.

### 503 Service Unavailable

Network-level failure reaching upstream.

```json
{"error": "network_error"}
```

**Retry guidance:** yes, with backoff.

### 504 Gateway Timeout

Upstream call exceeded the gateway timeout.

```json
{"error": "upstream_timeout", "timeout_ms": 180000}
```

**Retry guidance:** yes. First call after long idle often hits this (cold start ~130s is within budget; >180s means something degraded upstream).

---

## Rate limiting model

| | |
|---|---|
| **Cap** | 100 images / day, **global across all users** (alpha). |
| **Reset** | 00:00 UTC (daily). |
| **Counter** | Cloudflare KV, key `count:YYYY-MM-DD` (UTC), TTL 48h. |
| **Auth order** | Auth runs **before** rate-limit increment → invalid keys don't consume quota. |
| **Per-user quotas** | Not available in alpha. Fair-use guidance during onboarding. |
| **Overshoot tolerance** | ±1–2 requests (KV eventual consistency). Acceptable trade-off. |

---

## Cold start behavior

The first request after ~5 minutes of idle triggers a RunPod cold start (~130s expected, 180s gateway timeout). Subsequent calls stay warm for ~5 minutes.

**Recommended patterns:**

- **TypeScript:** Use the [SDK](../../sdk/README.md) — `client.warmup()` on app init, `generate()` with built-in retry-with-backoff (1s → 2s → 4s, max 3).
- **Python / other:** Send a pre-warm request (small `steps=4` generation) ~10s before you need the real call.
- **Batch / script:** Accept the cold penalty on the first call; subsequent calls are fast.

See [ADR-0001](../architecture/adr-0001-flux-cold-start.md) for the cold-start architectural decision.

---

## SDK vs raw HTTP

| If you're using... | Use |
|---|---|
| TypeScript / Node.js | [`@jhonata-matias/flux-client`](../../sdk/README.md) — typed errors (`ColdStartError`, `RateLimitError`, `AuthError`, `ValidationError`, `NetworkError`), automatic retry with cold-start-aware timeouts, `warmup()` helper. |
| Python / Colab | Raw HTTP with `requests`. See [examples/colab/README.md](../../examples/colab/README.md) for a runnable quickstart. |
| Any other language | Raw HTTP via curl/equivalent, following the schemas above. |

---

## Security notes

- **Server-side only:** Never embed `GATEWAY_API_KEY` in client-side JS bundles, mobile apps, or anywhere a browser can read it. Proxy through your own backend.
- **Key rotation:** If compromised, request a new key via the [access request](https://github.com/Jhonata-Matias/servegate/issues/new/choose) template with a `[Rotation]` prefix.
- **Reporting vulnerabilities:** Use [private security advisories](https://github.com/Jhonata-Matias/servegate/security/advisories/new), not public issues.

---

## See also

- [Developer Onboarding](../usage/dev-onboarding.md) — 5-step quickstart
- [TypeScript SDK](../../sdk/README.md) — typed client
- [Python / Colab example](../../examples/colab/README.md) — standalone requests-based
- [Terms of Use](../legal/TERMS.md) + [Privacy Statement](../legal/PRIVACY.md)
- [Architecture ADR-0001](../architecture/adr-0001-flux-cold-start.md) — cold-start decision
