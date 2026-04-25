# Text Generation API Quickstart

Base URL:

```text
https://gemma4-gateway.jhonata-matias.workers.dev
```

## Streaming

```bash
curl -N -sS https://gemma4-gateway.jhonata-matias.workers.dev/v1/generate \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Write one concise haiku about servers."}],
    "max_tokens": 256,
    "temperature": 0.7,
    "stream": true
  }'
```

The response is `text/event-stream` with OpenAI-compatible `chat.completion.chunk` frames.

## Non-Streaming

```bash
curl -sS https://gemma4-gateway.jhonata-matias.workers.dev/v1/generate \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Say OK"}],
    "max_tokens": 64,
    "stream": false
  }' | jq
```

## Request Fields

| Field | Type | Default | Notes |
|---|---:|---|---|
| `messages` | array | required | Roles: `system`, `user`, `assistant` |
| `model` | string | `gemma4:e4b` | Gemma 4 Ollama tag currently deployed |
| `max_tokens` | integer | `512` | Alpha cap: `2048` |
| `temperature` | number | provider default | Range `0.0-2.0` |
| `top_p` | number | provider default | Range `0.0-1.0` |
| `stream` | boolean | `true` | `false` returns JSON |

## Headers

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Daily text token budget (`50000`) |
| `X-RateLimit-Remaining` | Remaining token budget estimate |
| `X-RateLimit-Reset` | UTC reset timestamp |
| `X-Gateway-Model` | Model selected by the gateway |

## Error Codes

| HTTP | `error` | Meaning |
|---:|---|---|
| 400 | `invalid_json` | Body is not valid JSON |
| 400 | `missing_messages` | `messages[]` is absent or empty |
| 400 | `invalid_request` | Field type/range/role validation failed |
| 401 | `invalid_api_key` | Missing or invalid gateway key |
| 413 | `request_too_large` | Body exceeds 2 MB |
| 429 | `rate_limit_exceeded` | Token budget exceeded |
| 502 | `upstream_error` | Provider returned an error |
| 503 | `upstream_unavailable` | Provider/network unavailable |
