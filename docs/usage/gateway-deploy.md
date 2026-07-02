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

# Cole RUNPOD_ENDPOINT_ID (output do deploy Story 2.1, e.g. <RUNPOD_ENDPOINT_ID>)
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

## Multi-tenant API keys (Story 2.10 — interim allowlist)

O gateway aceita até **4 keys simultaneamente** via slots enumerados: `GATEWAY_API_KEY` (tenant 1, obrigatório) + `GATEWAY_API_KEY_2..4` (opcionais). Todas passam pelo mesmo `validateAuth` com comparação constant-time; cada key gera um `api_key_hash` distinto em logs e no bucket de quota de vídeo (`VIDEOS_KV`), preservando atribuição por-tenant.

> **Teto de 4:** decisão pragmática de alpha (Story 2.10 Dev Notes). Ao atingir ≥3 tenants ativos, escalar para Story 2.11 (KV allowlist com tenant_id lookup) — não estender adicionando slots `_5`, `_6`, etc.

> **⚠️ Deploy obrigatório na primeira publicação em um Worker desatualizado.** Se o Worker em produção ainda está numa versão de código **anterior** ao merge da Story 2.10, publicar `GATEWAY_API_KEY_2..4` via `wrangler secret put` **não** faz o slot funcionar — o código antigo só lê `env.GATEWAY_API_KEY`. Sintoma: novo slot retorna `401 mismatch`. Fix: `npm run deploy` (ou `npx wrangler deploy`) uma vez para subir o código da Story 2.10, depois o slot ativa imediatamente. **Descoberto em 2026-07-02** ao publicar o primeiro slot secundário. Rotações e revokes subsequentes NÃO precisam de deploy — secrets aplicam em segundos. Regra: `deploy` só quando o **código** muda; `secret put/delete` sozinhos apenas trocam valores.

### Adicionar tenant novo

```bash
# 1. Gerar key nova (offline, no host do owner)
NEW_KEY=$(openssl rand -hex 32)
echo "$NEW_KEY"   # salvar em password manager + preparar entrega criptografada

# 2. Escolher próximo slot livre (2, 3 ou 4). Verificar quais estão em uso:
npx wrangler secret list | grep GATEWAY_API_KEY

# 3. Publicar no slot livre (exemplo: slot 2)
npx wrangler secret put GATEWAY_API_KEY_2
#    (prompt interativo — colar o NEW_KEY)

# 4. Deploy do Worker.
#    - Se código da Story 2.10 já está em prod: passo puramente defensivo (secrets aplicam imediato).
#    - Se é a PRIMEIRA vez publicando um slot _2..4 num Worker que ainda roda código antigo: OBRIGATÓRIO
#      (código antigo só lê env.GATEWAY_API_KEY; sem deploy, novo slot retorna 401 mismatch).
npm run deploy

# 5. Smoke test:
curl -sS -H "X-API-Key: $NEW_KEY" \
     -H "Content-Type: application/json" \
     -X POST https://gemma4-gateway.jhonata-matias.workers.dev/jobs \
     -d '{"input":{"prompt":"smoke","steps":4}}' | jq -r '.job_id'
# Expect: UUID retornado (200 OK). 401 = key não bateu (revisar slot escolhido).
```

### Rotate per-tenant

Substitua a key **daquele slot** sem afetar os outros:

```bash
# Ex: rotate tenant no slot 3
NEW_KEY=$(openssl rand -hex 32)
npx wrangler secret put GATEWAY_API_KEY_3   # cola NEW_KEY
npm run deploy

# Após tenant confirmar recepção da NEW_KEY, o slot já está atualizado.
# Nenhuma ação em GATEWAY_API_KEY, _2, ou _4.
```

### Revoke per-tenant

Remove o secret do slot — o próximo request daquele tenant recebe 401 imediatamente:

```bash
npx wrangler secret delete GATEWAY_API_KEY_3
npm run deploy   # opcional; delete propaga em segundos
```

> **Nota — quota residual em `VIDEOS_KV`:** o bucket `videos:YYYY-MM-DD:{api_key_hash}` do tenant revogado permanece até seu TTL de 48h. **Isto é normal e não requer cleanup manual** — o hash não é mais aceito, então não pode ser reincrementado. Se quiser zerar por motivo de audit, `npx wrangler kv key delete "videos:$(date -u +%Y-%m-%d):{hash}" --binding=VIDEOS_KV`.

### Non-goal (Story 2.10 AC10)

Rate-limit de **imagem** (`RATE_LIMIT_KV` chave `count:YYYY-MM-DD`) permanece **global** — não é per-tenant. Story 2.11 (KV allowlist futura) endereça isso via `count:date:tenant_id`. Ver backlog FU-4.3.1.

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
| **`curl (35) SSL handshake failure` após deploy** | **Cert propagation delay — subdomain recém-criado leva 1-5min para cert wildcard propagar globalmente no Cloudflare edge** | **Aguardar 2-5min e retry. Verificar via `curl -sS -o /dev/null -w "%{http_code}" https://<your-url>` — se retornar 405, TLS propagou. Se persistir >10min, checar Cloudflare dashboard → Workers → seu worker → Settings → Triggers** |
| 401 every request | Key não bate nenhum slot ativo (`GATEWAY_API_KEY` ou `_2..4`) | `npx wrangler secret list \| grep GATEWAY_API_KEY` para conferir slots publicados; se tenant revogado, reemitir via seção Multi-tenant acima |
| 429 imediato após deploy | KV não resetou após day boundary OU smoke anterior consumiu quota | `npx wrangler kv key delete "count:$(date -u +%Y-%m-%d)" --binding=RATE_LIMIT_KV` |
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
