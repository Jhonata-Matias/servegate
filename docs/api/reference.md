# servegate FLUX API Reference

**Status:** Alpha  
**Base URL:** `https://gemma4-gateway.jhonata-matias.workers.dev`

This is the canonical HTTP contract for the async gateway introduced in `v0.2.0`. For TypeScript consumers, prefer the SDK in [`sdk/`](../../sdk/README.md).

## Overview

The gateway no longer blocks on image generation. The contract is now:

1. `POST /jobs` submits a generation request and returns `202`
2. `GET /jobs/{job_id}` polls until the job completes or reaches a terminal state
3. `POST /` is removed and returns a migration pointer

All requests require `X-API-Key`.

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

Submits a generation request to RunPod asynchronously.

#### Headers

| Header | Required | Description |
|---|---|---|
| `X-API-Key` | Yes | Shared gateway credential |
| `Content-Type: application/json` | Yes | Request body must be JSON |

#### Request body

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

`@jhonata-matias/flux-client@0.2.0` preserves `generate()` but now uses this submit/poll contract internally.

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
