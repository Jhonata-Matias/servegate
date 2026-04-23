# Async Migration Guide

This guide covers the migration from the removed synchronous gateway contract (`POST /`) to the async submit/poll contract introduced in `v0.2.0`.

## What changed

Old flow:

1. `POST /`
2. Client waited on the same HTTP request until generation finished or timed out

New flow:

1. `POST /jobs`
2. Client receives `202 Accepted` immediately with `job_id`
3. Client polls `GET /jobs/{job_id}` until `200`, `500`, `504`, or `404`

## Why this changed

Cold starts on the RunPod stack can take about two minutes. In the synchronous model, the Cloudflare Worker hit the timeout cliff and surfaced `504` to clients during legitimate cold starts. The async contract converts cold start into a pollable state instead of a failed request.

## Breaking change summary

| Before | After |
|---|---|
| `POST /` | `POST /jobs` |
| Single blocking request | Submit + poll |
| Success directly returns image | Submit returns `job_id`; result arrives on polling |
| Cold start often surfaced as `504` | Cold start surfaces as `202 queued/running` |

## curl Migration

### Before

```bash
curl -X POST https://gemma4-gateway.jhonata-matias.workers.dev \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "prompt": "cinematic mountain sunrise",
      "steps": 4,
      "width": 1024,
      "height": 1024
    }
  }'
```

### After

Submit:

```bash
curl -sS -X POST https://gemma4-gateway.jhonata-matias.workers.dev/jobs \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "cinematic mountain sunrise",
    "steps": 4,
    "width": 1024,
    "height": 1024
  }'
```

Poll:

```bash
curl -sS https://gemma4-gateway.jhonata-matias.workers.dev/jobs/$JOB_ID \
  -H "X-API-Key: $GATEWAY_API_KEY"
```

Decode after completion:

```bash
curl -sS https://gemma4-gateway.jhonata-matias.workers.dev/jobs/$JOB_ID \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  | jq -r '.output.image_b64' \
  | base64 -d > out.png
```

## Shell Example

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://gemma4-gateway.jhonata-matias.workers.dev"

submit_json=$(
  curl -sS -X POST "$BASE_URL/jobs" \
    -H "X-API-Key: $GATEWAY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "prompt": "studio portrait of a robot violinist",
      "steps": 4,
      "width": 1024,
      "height": 1024
    }'
)

job_id=$(printf '%s' "$submit_json" | jq -r '.job_id')

while true; do
  poll_json=$(curl -sS "$BASE_URL/jobs/$job_id" -H "X-API-Key: $GATEWAY_API_KEY")
  status=$(printf '%s' "$poll_json" | jq -r '.status // empty')

  if printf '%s' "$poll_json" | jq -e '.output.image_b64' >/dev/null 2>&1; then
    printf '%s' "$poll_json" | jq -r '.output.image_b64' | base64 -d > out.png
    echo "completed: out.png"
    break
  fi

  if printf '%s' "$poll_json" | jq -e '.error' >/dev/null 2>&1; then
    echo "$poll_json"
    exit 1
  fi

  echo "pending: ${status:-unknown}"
  sleep 5
done
```

## Postman Migration

1. Replace the old `POST /` request with `POST /jobs`
2. Save `job_id` from the `202` response into a Postman variable
3. Add a follow-up `GET /jobs/{{job_id}}`
4. Repeat polling until the response becomes `200`

Minimum variable extraction from submit response:

```javascript
const body = pm.response.json();
pm.collectionVariables.set("job_id", body.job_id);
```

## SDK Migration

If you use `@jhonata-matias/flux-client`:

- `generate()` keeps the same public shape
- `warmup()` still exists, but now waits for a real async completion
- `ColdStartError` was removed
- `TimeoutError` replaces cold-start-specific terminal handling

Migration shape:

```ts
// v0.1.x
// catch (e instanceof ColdStartError)

// v0.2.0
// catch (e instanceof TimeoutError)
```

## Legacy Endpoint Behavior

`POST /` now returns:

```json
{
  "error": "endpoint_removed",
  "migration_doc": "/docs/api/migration-async.md"
}
```

Clients should treat this as a mandatory migration signal, not a transient failure.
