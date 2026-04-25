# servegate Image API Reference

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

### 1a. Submit a text-to-image job

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

### 1b. Submit an image-to-image edit job

For edits, send the source image as `input_image_b64` in the same `POST /jobs` endpoint. The presence of that field selects the Qwen-Image-Edit branch.

```bash
INPUT_IMAGE_B64="$(base64 -w 0 input.png)"

curl -i -X POST https://gemma4-gateway.jhonata-matias.workers.dev/jobs \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"prompt\": \"make the jacket green while keeping the background unchanged\",
    \"input_image_b64\": \"$INPUT_IMAGE_B64\",
    \"strength\": 0.85,
    \"steps\": 8,
    \"seed\": 42
  }"
```

The submit response is the same `202 Accepted` shape as text-to-image. Use the returned `job_id` with `GET /jobs/{job_id}`.

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
      "elapsed_ms": 3100,
      "output_width": 720,
      "output_height": 480,
      "qwen_generated_width": 736,
      "qwen_generated_height": 480
    }
  }
}
```

The dimension fields are present for edit jobs. Text-to-image jobs return the existing metadata fields only.

## Endpoints

### `POST /jobs`

Submits a generation or edit request to RunPod asynchronously. The route is selected by payload shape:

- no `input_image_b64` field -> FLUX.1-schnell text-to-image
- includes `input_image_b64` -> Qwen-Image-Edit image-to-image

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
- Output is always returned as inline base64 PNG through `GET /jobs/{job_id}`.

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

#### Edit validation error codes

All edit validation failures use a stable `error` code and include `code: 400` in the handler output. The SDK surfaces local equivalents as `ValidationError` before submit when possible.

| Error | Meaning |
|---|---|
| `invalid_image_base64` | `input_image_b64` is missing, empty, malformed, or a non-base64 data URI |
| `image_too_large` | Decoded image payload is larger than `8 MB` |
| `unsupported_mime_type` | Magic bytes are not PNG, JPEG, or WebP |
| `invalid_image` | Bytes passed signature checks but Pillow could not read the image |
| `invalid_aspect_ratio` | Source image is exactly square (`1:1`) |
| `invalid_i2i_parameters` | Edit request included `width` or `height`; source image dimensions are used instead |
| `invalid_steps` | Edit `steps` is outside `4-50` |
| `invalid_strength` | `strength` is outside `(0.0, 1.0]` |

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

For image-to-image, the SDK validates the image before any network call when possible. This catches unsupported MIME types, `1:1` aspect ratio, payloads over `8 MB`, and inputs above `1 MP` unless `autoDownsample: true` is used in Node.js with `sharp` available.

## Text Generation

### `POST /v1/generate`

Returns Gemma 4 text completions through the same gateway key. The default response is streaming SSE.

#### Headers

| Header | Required | Description |
|---|---|---|
| `X-API-Key` | Yes | Shared gateway credential |
| `Authorization: Bearer <key>` | Alternative | Accepted when `X-API-Key` is absent |
| `Content-Type: application/json` | Yes | Request body must be JSON |

#### Request

```json
{
  "messages": [
    { "role": "user", "content": "Say OK" }
  ],
  "model": "gemma4:e4b",
  "max_tokens": 512,
  "temperature": 0.7,
  "top_p": 1.0,
  "stream": true
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `messages` | array | Yes | Roles: `system`, `user`, `assistant`; `content` must be non-empty |
| `model` | string | No | Defaults to `gemma4:e4b` |
| `max_tokens` | integer | No | Defaults to `512`; alpha cap `2048` |
| `temperature` | number | No | Range `0.0-2.0` |
| `top_p` | number | No | Range `0.0-1.0` |
| `stream` | boolean | No | Defaults to `true` |

#### Streaming Response

Status: `200 OK`

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-RateLimit-Limit: 50000
X-RateLimit-Remaining: 49750
X-RateLimit-Reset: 2026-04-25T00:00:00.000Z
X-Gateway-Model: gemma4:e4b
```

Frame shape:

```text
data: {"object":"chat.completion.chunk","model":"gemma4:e4b","choices":[{"index":0,"delta":{"role":"assistant","content":"OK"},"finish_reason":null}]}
```

#### Non-Streaming Response

Set `"stream": false`.

```json
{
  "object": "chat.completion",
  "model": "gemma4:e4b",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "OK"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "total_tokens": 12
  }
}
```

Gemma 4 through Ollama can include `message.reasoning` in non-streaming responses and `delta.reasoning` in streaming chunks. Clients should ignore unknown fields unless they explicitly surface reasoning.

#### Text Error Codes

| HTTP | `error` | Meaning |
|---:|---|---|
| 400 | `invalid_json` | Body is not valid JSON |
| 400 | `missing_messages` | `messages[]` is missing or empty |
| 400 | `invalid_request` | Field type/range/role validation failed |
| 401 | `invalid_api_key` | Missing or invalid gateway key |
| 413 | `request_too_large` | Body exceeds `2 MB` |
| 429 | `rate_limit_exceeded` | Daily token budget exceeded |
| 502 | `upstream_error` | Text provider returned an error |
| 503 | `upstream_unavailable` | Text provider/network unavailable |

## Related

- Migration guide: [migration-async.md](./migration-async.md)
- ADR: [adr-0002-async-gateway-pattern.md](../architecture/adr-0002-async-gateway-pattern.md)
- Image-to-image ADR: [adr-0003-image-to-image-model-selection.md](../architecture/adr-0003-image-to-image-model-selection.md)
- Cold-start rationale: [adr-0001-flux-cold-start.md](../architecture/adr-0001-flux-cold-start.md)
