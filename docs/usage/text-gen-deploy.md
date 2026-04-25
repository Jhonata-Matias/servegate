# Text Generation Deploy Runbook

Story 4.2 deploys text generation as a second RunPod endpoint behind the existing Cloudflare gateway.

## Current Runtime

The accepted implementation pivot is:

| Component | Value |
|---|---|
| RunPod endpoint name | `endpoint-text-gen-alpha` |
| Worker image | `svenbrnn/runpod-ollama:0.21.2` |
| Model | `gemma4:e4b` |
| Gateway route | `POST /v1/generate` |

The original vLLM/Gemma 3 path failed during provisioning. See `.aiox/notes/story-4.2/deploy-record-2026-04-24.md` for private evidence and endpoint IDs.

## Pre-Flight

1. Confirm the RunPod text endpoint is healthy in the dashboard.
2. Confirm the existing image endpoint remains untouched.
3. Confirm `RUNPOD_API_KEY` is already configured as a Cloudflare Worker secret.
4. Configure the text endpoint ID as a Cloudflare Worker secret:

```bash
cd gateway
npm run secret:runpod-text-endpoint
```

5. Confirm `CORS_ALLOWED_ORIGIN` in `gateway/wrangler.toml` points at the alpha landing/app origin.

## Deploy

```bash
cd gateway
npm run typecheck
npm test
npm run deploy
```

## Smoke Tests

Streaming:

```bash
curl -N -sS "$GATEWAY_URL/v1/generate" \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say OK"}],"max_tokens":64,"stream":true}'
```

Non-streaming:

```bash
curl -sS "$GATEWAY_URL/v1/generate" \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say OK"}],"max_tokens":64,"stream":false}' | jq
```

Rate-limit simulation:

```bash
TODAY="$(date -u +%Y-%m-%d)"
npx wrangler kv key put --binding=RATE_LIMIT_KV "tokens:$TODAY" "49999"
curl -i "$GATEWAY_URL/v1/generate" \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}],"max_tokens":2000}'
```

Expected: `429` with `error: "rate_limit_exceeded"`.

## Rollback

1. Redeploy the previous gateway version or remove the `/v1/generate` route.
2. Delete/reset `tokens:YYYY-MM-DD` only if a test polluted the alpha budget.
3. Keep the image endpoint secrets and KV namespaces unchanged.
4. Stop the RunPod text endpoint workers from the RunPod dashboard if spend must stop immediately.

## Privacy

Do not commit endpoint IDs, RunPod API keys, gateway API keys, or HuggingFace tokens. Runtime evidence with IDs belongs under `.aiox/notes/story-4.2/` and must stay gitignored.
