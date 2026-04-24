# servegate FLUX API Reference

**Status:** Alpha  
**Base URL:** `https://gemma4-gateway.jhonata-matias.workers.dev`

This is the canonical HTTP contract for the async gateway introduced in `v0.2.0` and extended with image-to-image edit in `v0.3.0`. For TypeScript consumers, prefer the SDK in [`sdk/`](../../sdk/README.md).

## Overview

The gateway no longer blocks on image generation. The contract is now:

1. `POST /jobs` submits a generation request and returns `202`
2. `GET /jobs/{job_id}` polls until the job completes or reaches a terminal state
3. `POST /` is removed and returns a migration pointer

All requests require `X-API-Key`. `POST /jobs` supports two request variants:

- Text-to-image: no `input_image_b64` field; routes to the existing FLUX.1-schnell workflow.
- Image-to-image edit: includes `input_image_b64`; routes to Qwen-Image-Edit.

## Quickstart

### 1. Submit a job

```bash
curl -i -X POST https://gemma4-gateway.jhonata-matias.workers.dev/jobs \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a peaceful zen garden with cherry blossoms, photorealistic",
    "steps": 4,
    "width": 1024,
    "height": 1024,
    "seed": 42
  }'
```

Expected response:

```http
HTTP/1.1 202 Accepted
Location: /jobs/2f3f0f1f-2a6f-4d8b-b6f3-0df9d9f36e9e
Retry-After: 5
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 2026-04-24T00:00:00.000Z
```

```json
{
  "job_id": "2f3f0f1f-2a6f-4d8b-b6f3-0df9d9f36e9e",
  "status_url": "/jobs/2f3f0f1f-2a6f-4d8b-b6f3-0df9d9f36e9e",
  "est_wait_seconds": "unknown"
}
```

### 2. Poll for completion

```bash
curl -i https://gemma4-gateway.jhonata-matias.workers.dev/jobs/$JOB_ID \
  -H "X-API-Key: $GATEWAY_API_KEY"
```

Pending response:

```http
HTTP/1.1 202 Accepted
Retry-After: 5
```

```json
{
  "status": "running",
  "est_wait_seconds": "unknown"
}
```

Completed response:

```json
{
  "output": {
    "image_b64": "<base64 PNG>",
    "metadata": {
      "seed": 42,
      "elapsed_ms": 3100
    }
  }
}
```

## Endpoints

### `POST /jobs`

Submits a generation or edit request to RunPod asynchronously.

#### Headers

| Header | Required | Description |
|---|---|---|
| `X-API-Key` | Yes | Shared gateway credential |
| `Content-Type: application/json` | Yes | Request body must be JSON |

#### Text-to-image request body

```json
{
  "prompt": "string",
  "steps": 4,
  "width": 1024,
  "height": 1024,
  "seed": 42
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | Yes | Non-empty prompt text |
| `steps` | integer | Yes | Positive integer. Recommended: `4` |
| `width` | integer | Yes | Positive integer |
| `height` | integer | Yes | Positive integer |
| `seed` | integer | No | Optional deterministic seed |

#### Image-to-image edit request body

```json
{
  "prompt": "make the jacket green while keeping the background unchanged",
  "input_image_b64": "<base64 PNG/JPEG/WebP>",
  "strength": 0.85,
  "steps": 8,
  "seed": 42
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | Yes | Non-empty edit instruction. Be explicit about regions that should stay unchanged. |
| `input_image_b64` | string | Yes | Base64-encoded PNG, JPEG, or WebP. Data URIs are accepted by the handler, but raw base64 is preferred. |
| `strength` | number | No | Denoise strength in `(0.0, 1.0]`; default `0.85`. Lower values preserve more of the source image. |
| `steps` | integer | No | Default `8` for the Lightning LoRA path; accepted range `4-50`. |
| `seed` | integer | No | Optional deterministic seed. |

Validation rules:

- Exact `1:1` input images are rejected with `400` and `error: "invalid_aspect_ratio"`. Use a non-square crop.
- Decoded image payload must be `<= 8 MB`.
- Inputs above `1,048,576` pixels are defensively downsampled server-side while preserving aspect ratio.
- MIME type is verified from image magic bytes; only PNG, JPEG, and WebP are accepted.
- `width` and `height` are not accepted for edit jobs; source image dimensions drive the workflow.

Known gotchas:

- Qwen-Image-Edit can drift aspect ratio internally. The handler resizes the final PNG back to the effective input dimensions with Pillow `LANCZOS`.
- Backgrounds can be rewritten if the prompt is vague. Use instructions such as "keep the background unchanged".
- Sequential edits can degrade quality. Prefer one comprehensive edit prompt over many chained edits.
- HEIC/HEIF is not accepted in `v0.3.0`; convert to PNG/JPEG/WebP before submit.

SDK example:

```typescript
import { FluxClient } from '@jhonata-matias/flux-client';

const client = new FluxClient({ apiKey, gatewayUrl });
const result = await client.edit({
  prompt: 'make the jacket green while keeping the background unchanged',
  image: inputBuffer,
  strength: 0.85,
  steps: 8,
});

console.log(result.output.metadata.output_width, result.output.metadata.output_height);
```

cURL example:

```bash
INPUT_IMAGE_B64="$(base64 -w 0 input.png)"

curl -i -X POST https://gemma4-gateway.jhonata-matias.workers.dev/jobs \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"prompt\": \"make the jacket green while keeping the background unchanged\",
    \"input_image_b64\": \"$INPUT_IMAGE_B64\",
    \"strength\": 0.85,
    \"steps\": 8
  }"
```

#### Success response

Status: `202 Accepted`

```json
{
  "job_id": "uuid-v4",
  "status_url": "/jobs/{job_id}",
  "est_wait_seconds": "unknown"
}
```

Headers:

| Header | Value |
|---|---|
| `Location` | `/jobs/{job_id}` |
| `Retry-After` | `5` |
| `X-RateLimit-Limit` | `100` |
| `X-RateLimit-Remaining` | Remaining submit quota |
| `X-RateLimit-Reset` | UTC reset timestamp |

### `GET /jobs/{job_id}`

Polls the current state of a submitted job. This endpoint does **not** consume daily submit quota.

#### Success and terminal responses

| Status | Body | Meaning |
|---|---|---|
| `200` | `{output: {image_b64, metadata}}` | Job completed successfully |
| `202` | `{status: "queued"|"running", est_wait_seconds: "unknown"}` | Job still in progress |
| `404` | `{error: "job_not_found_or_expired"}` | Unknown or expired job ID |
| `500` | `{error: "runpod_failed"|"runpod_cancelled", status: "failed"|"cancelled"}` | RunPod reached a terminal failure state |
| `504` | `{error: "generation_timeout", timeout_s: 280}` | RunPod timed out generation |

Pending and not-found responses include `Retry-After: 5`.

### `POST /`

Legacy synchronous root submission is removed.

Status: `404`

```json
{
  "error": "endpoint_removed",
  "message": "POST / was removed in v0.2.0. Use POST /jobs + GET /jobs/{id} instead.",
  "migration_doc": "/docs/api/migration-async.md"
}
```

## Error Responses

### `400 invalid_json`

```json
{
  "error": "invalid_json",
  "message": "Request body must be valid JSON"
}
```

### `401 invalid_api_key`

Authentication fails before any submit quota is consumed.

### `400 invalid_aspect_ratio`

Returned by edit jobs when the source image is exactly square.

```json
{
  "error": "invalid_aspect_ratio",
  "message": "Qwen-Image-Edit rejects exact 1:1 input images; use a non-square crop",
  "code": 400
}
```

### `429 rate_limit_exceeded`

Submit quota is exhausted for the current UTC day.

```json
{
  "error": "rate_limit_exceeded",
  "limit": 100,
  "reset_at": "2026-04-24T00:00:00.000Z"
}
```

### `502 upstream_error`

RunPod returned a `5xx` during submit or polling.

```json
{
  "error": "upstream_error"
}
```

### `503 upstream_unavailable`

Network/timeout path to RunPod failed, or the gateway could not persist the job mapping.

Possible bodies:

```json
{"error": "upstream_unavailable"}
```

```json
{
  "error": "storage_unavailable",
  "message": "Job submitted to upstream but could not be tracked"
}
```

### `500 gateway_configuration_error`

Masked upstream `4xx` or gateway-side configuration issue when contacting RunPod.

```json
{
  "error": "gateway_configuration_error"
}
```

## Rate Limiting

| Property | Value |
|---|---|
| Submit cap | `100` jobs/day |
| Reset boundary | `00:00 UTC` |
| Counted endpoint | `POST /jobs` only |
| Non-counted endpoint | `GET /jobs/{id}` |

Headers returned on gateway responses:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Daily cap |
| `X-RateLimit-Remaining` | Remaining quota snapshot |
| `X-RateLimit-Reset` | UTC reset timestamp |

## SDK Notes

`@jhonata-matias/flux-client@0.3.0` exposes both `generate()` and additive `edit()`. Both use this submit/poll contract internally.

Typed terminal errors exposed by the SDK:

| Error | Meaning |
|---|---|
| `TimeoutError` | Poll budget exhausted, gateway `504`, or RunPod generation timeout |
| `RateLimitError` | Gateway quota exhausted |
| `AuthError` | Invalid API key |
| `NetworkError` | Client-to-gateway network/request failure |
| `ValidationError` | Invalid local input before submit |

## Related

- Migration guide: [migration-async.md](./migration-async.md)
- ADR: [adr-0002-async-gateway-pattern.md](../architecture/adr-0002-async-gateway-pattern.md)
- Cold-start rationale: [adr-0001-flux-cold-start.md](../architecture/adr-0001-flux-cold-start.md)
