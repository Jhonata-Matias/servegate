# ADR-0002: Async Gateway Submit/Poll Pattern

## Status

Accepted

Date: 2026-04-23

## Context

The original gateway contract proxied image generation synchronously through `POST /`. That design failed during legitimate RunPod cold starts because the Cloudflare Worker connection budget was shorter than the real upstream cold-start path. The incident tracked in `INC-2026-04-23-gateway-504` showed that cold requests could degrade into client-facing `504` even when the upstream job would eventually complete.

ADR-0001 already established that the project would keep RunPod Path A for MVP economics, accepting cold starts instead of moving immediately to always-warm infrastructure. That made the synchronous gateway the remaining architectural bottleneck.

## Decision

The gateway adopts an async submit/poll contract:

- `POST /jobs` submits work and returns `202 Accepted`
- `GET /jobs/{job_id}` polls job state until completion or terminal failure
- `POST /` is removed and returns a migration pointer

The gateway persists `job_id -> runpod_request_id` in Cloudflare KV and maps RunPod async status into a stable public contract.

## Rationale

1. Cold start becomes an observable pending state instead of a failed HTTP transaction.
2. The contract is usable from raw HTTP clients such as curl and Postman, not only from the SDK.
3. RFC-aligned `202 + Location + Retry-After` semantics are widely interoperable.
4. The design stays within project constraints: Workers free-tier gateway, KV persistence, no Durable Objects, no paid queueing layer.

## Contract Summary

### Submit

`POST /jobs`

Returns:

```json
{
  "job_id": "uuid-v4",
  "status_url": "/jobs/{job_id}",
  "est_wait_seconds": "unknown"
}
```

Headers:

- `Location: /jobs/{job_id}`
- `Retry-After: 5`

### Poll

`GET /jobs/{job_id}`

Possible results:

- `200` completed
- `202` queued or running
- `404` unknown or expired
- `500` failed or cancelled
- `504` timed out in RunPod

## Consequences

### Positive

- Eliminates the specific cold-start `504` failure mode that triggered the incident.
- Keeps the public gateway usable without SDK-specific warmup logic.
- Preserves a simple operational model: Cloudflare Worker + KV + RunPod async APIs.

### Negative

- Clients now need polling orchestration.
- The gateway must manage persistent job mappings and TTL behavior.
- Legacy callers to `POST /` must migrate.

## Implementation Notes

- `crypto.randomUUID()` is used for public `job_id`
- Polling responses always expose `est_wait_seconds: "unknown"`
- `GET /jobs/{id}` does not consume submit quota
- The SDK in `v0.2.0` preserves `generate()` but internally adopts submit/poll
- `ColdStartError` is removed in favor of `TimeoutError`

## Alternatives Considered

### Keep synchronous `POST /`

Rejected because it cannot survive real cold-start latency under the Worker execution cliff.

### Add always-warm infrastructure

Rejected for MVP because ADR-0001 kept Path A economics and avoided permanent warm-worker cost.

### Introduce a heavier coordination layer

Rejected because project constraints explicitly prefer the simplest Workers + KV approach for MVP.

## References

- [ADR-0001](./adr-0001-flux-cold-start.md)
- [Incident story](../stories/INC-2026-04-23-gateway-504/INC-2026-04-23-gateway-504.story.md)
- [API reference](../api/reference.md)
