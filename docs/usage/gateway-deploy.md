# Gateway Deploy Guide — Cloudflare Worker (Story 2.5)

Single public entry point para o endpoint FLUX Serverless. Adds auth (X-API-Key) + rate-limit (100/day UTC) + RunPod proxy. Free tier (workers.dev subdomain).

## Pre-requisites

- Cloudflare account ativa (free tier OK — 100k requests/day, 10ms CPU/req)
- Node.js >= 18
- RunPod Serverless endpoint live (Story 2.1) — endpoint ID + RUNPOD_API_KEY disponíveis

## One-time setup

### 1. Install dependencies

```bash
cd gateway/
npm install
```

### 2. Authenticate Wrangler

```bash
npx wrangler login
```

Browser abre para OAuth Cloudflare. Após login, token salvo em `~/.wrangler/`.

### 3. Create KV namespace

```bash
npm run kv:create
```

Output similar:
```
🌀 Creating namespace with title "gemma4-gateway-RATE_LIMIT_KV"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "abc123def456..."
```

**Copie o `id`** retornado e substitua `KV_NAMESPACE_ID_PLACEHOLDER` em `gateway/wrangler.toml`.

### 4. Generate gateway API key

```bash
openssl rand -hex 32
```

**Salve este valor em local seguro** (password manager). Vai ser usado em (a) `wrangler secret put` e (b) configurar consumers (SDK Story 2.2 + demo Story 2.3).

### 5. Configure secrets

Execute os 3 comandos abaixo. Cada um abre prompt interativo para colar o valor:

```bash
# Cole o valor gerado em #4
npm run secret:gateway-key

# Cole RUNPOD_API_KEY (mesmo valor de serverless/.env, Story 2.1)
npm run secret:runpod-key

# Cole RUNPOD_ENDPOINT_ID (output do deploy Story 2.1, e.g. 80e45g6gct1opm)
npm run secret:runpod-endpoint
```

Verificar:

```bash
npm run secret:list
```

Deve listar 3 secrets sem expor valores.

### 6. Deploy

```bash
npm run deploy
```

Output similar:
```
✨ Success! Your worker is deployed at:
https://gemma4-gateway.<your-account>.workers.dev
```

**Copie a URL retornada** — vai ser o `GATEWAY_URL` para SDK e demo.

## Smoke test (Story 2.5 AC7)

Validate 100 success + 1 rate-limited:

```bash
export GATEWAY_URL="https://gemma4-gateway.<your-account>.workers.dev"
export GATEWAY_API_KEY="<value-from-step-4>"
./tests/smoke-101.sh
```

Expected:
```
==== SMOKE TEST RESULTS ====
200 (success):     100
429 (rate-limited): 1
Other:             0
Retry-After (429): <segundos até próxima 00:00 UTC>

✅ AC7 PASS — 100 success + 1 rate-limited as expected
```

**Custo estimado:** ~$0.06 em RunPod (100 cold/warm × $0.0006/img média) — alinhado com Story 2.1 AC6.

## Local development (`wrangler dev`)

```bash
npm run dev
```

Abre Worker em `http://localhost:8787`. Note: KV em local-dev usa stub (não persiste entre runs); secrets via `.dev.vars` (gitignored).

Para testar local com secrets reais, criar `.dev.vars`:

```
GATEWAY_API_KEY=your-key
RUNPOD_API_KEY=your-key
RUNPOD_ENDPOINT_ID=your-endpoint
```

## Reset KV counter (manual)

Para forçar reset (testes ou recovery):

```bash
# List keys
npx wrangler kv key list --binding=RATE_LIMIT_KV

# Delete today's counter
npx wrangler kv key delete --binding=RATE_LIMIT_KV "count:$(date -u +%Y-%m-%d)"
```

## Rotate GATEWAY_API_KEY

```bash
# Generate new key
NEW_KEY=$(openssl rand -hex 32)
echo "$NEW_KEY"

# Update secret (interactive prompt — cole o NEW_KEY)
npm run secret:gateway-key

# Deploy (secrets aplicam imediatamente após save, mas re-deploy garante hot reload)
npm run deploy

# Update consumers (SDK config + demo .env)
```

## Logs (`wrangler tail`)

```bash
npm run tail
```

Stream JSON logs em real-time. Format:

```json
{"timestamp":1745186400000,"event":"proxy_success","ip":"203.0.113.42","status":200,"elapsed_ms":7234,"day_count":42}
```

**Privacy:** logs NÃO contêm prompt content nem image bytes (LGPD compliance).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 401 every request | GATEWAY_API_KEY mismatch | Re-run `secret:list` + `secret:gateway-key` |
| 429 imediato após deploy | KV não resetou após day boundary | `kv key delete count:$(date -u +%Y-%m-%d)` |
| 504 upstream timeout | RunPod cold start (~150s) | Per ADR-0001 Path A, expected; SDK retry handles |
| 502 upstream_error | RunPod 5xx | Check RunPod dashboard `endpointId={your-id}` health |
| Counter overshoot 1-2/dia | KV eventual consistency (Risk R7) | Accepted per Epic 2 PRD; escalate to Durable Objects se sustained |

## Free tier limits (validated)

| Resource | Free limit | Our usage (100/day) | Margin |
|---|---|---|---|
| Workers requests | 100k/day | ≤101/day | 990× |
| Workers CPU time | 10ms-50ms/req | ~10ms (proxy) | OK |
| KV reads | 100k/day | 100/day | 1000× |
| KV writes | 1k/day | 100/day | 10× |

Confortável até ~10x do volume MVP.

## Related

- Worker source: `gateway/src/`
- Tests: `gateway/tests/` (vitest unit + smoke shell)
- Story: `docs/stories/2.5.gateway-rate-limit-cloudflare.story.md`
- Epic 2 PRD: `docs/prd/epic-2-consumer-integration.md`
- ADR-0001 (cold strategy): `docs/architecture/adr-0001-flux-cold-start.md`
