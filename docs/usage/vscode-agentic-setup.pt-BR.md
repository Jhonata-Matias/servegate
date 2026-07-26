# Guia — VS Code Copilot BYOK com servegate (gemma4:e4b + qwen3-coder:30b)

> **Story:** [`docs/stories/7.1.qwen3-coder-vscode-spike.story.md`](../stories/7.1.qwen3-coder-vscode-spike.story.md)
> **Público:** owner-operator do servegate + qualquer usuário BYOK com API key válida
> **Idioma:** português (pt-BR)

## O que este guia cobre

Como configurar o VS Code Copilot para usar os modelos do servegate como custom endpoint:

- `gemma4:e4b` — modelo pequeno pra Q&A leve (4B params)
- `qwen3-coder:30b` — modelo de coding agentic (30B params, tool-calling enabled) — **recomendado** pra tasks de dev

Requer:

- **VS Code** ≥ 1.95 com **GitHub Copilot Chat** ≥ 0.24 (BYOK support)
- **API key servegate** válida (`GATEWAY_API_KEY` ou uma das slots `_2..._4` provisionadas via `wrangler secret put`)
- Acesso à internet (calls vão pra `https://gemma4-gateway.jhonata-matias.workers.dev`)

## Setup

### 1. Config do `settings.json` VS Code

Abra `Ctrl+Shift+P` → `Preferences: Open User Settings (JSON)` e adicione o vendor `servegate`:

```jsonc
{
  "github.copilot.chat.byok.models": [
    {
      "name": "servegate",
      "vendor": "customendpoint",
      "apiKey": "${input:chat.lm.secret.servegate}",
      "apiType": "chat-completions",
      "models": [
        {
          "id": "qwen3-coder:30b",
          "name": "Qwen 3 Coder 30B (servegate)",
          "url": "https://gemma4-gateway.jhonata-matias.workers.dev/v1/chat/completions",
          "toolCalling": true,
          "vision": false,
          "maxInputTokens": 32000,
          "maxOutputTokens": 8192
        },
        {
          "id": "gemma4:e4b",
          "name": "Gemma 4 E4B (servegate)",
          "url": "https://gemma4-gateway.jhonata-matias.workers.dev/v1/chat/completions",
          "toolCalling": false,
          "vision": false,
          "maxInputTokens": 32000,
          "maxOutputTokens": 4096
        }
      ]
    }
  ]
}
```

**Notas críticas sobre a config:**

1. **`"url"` aponta pro endpoint COMPLETO** (`.../v1/chat/completions`), não pra base URL. Descoberta empírica 2026-07-25: o vendor `customendpoint` do VS Code trata `url` como full endpoint URL (não appenda `/chat/completions`). Se você configurou como base URL antes, resultou em 405.

2. **`"toolCalling": true` só no Qwen** — habilita agentic loop (function calling, exec tools). Gemma4:e4b fica `false` porque o modelo é pequeno demais pra tool-use decente (vira narração vazia).

3. **`apiKey` via input**: primeira vez que abrir chat com o modelo `servegate`, VS Code pergunta a API key e armazena no keystore (`${input:chat.lm.secret.servegate}` é o placeholder). Se você prefere hardcode temporário: `"apiKey": "sua-chave-aqui"` — mas NÃO commit isso.

### 2. Selecionar o modelo no chat

- Abra o painel de chat: `Ctrl+Alt+I`
- Clique no seletor de modelo (topo direito do painel)
- Escolha `Qwen 3 Coder 30B (servegate)` pra tasks agentic
- Ou `Gemma 4 E4B (servegate)` pra Q&A leve

### 3. Validar end-to-end

Envie um prompt simples pra confirmar:

```
Prompt: Escreva uma função JS que retorne a soma dos números pares de 1 a N.
```

Se veio resposta com código → ✅ funcionando.

Se veio erro → ver **Troubleshooting** abaixo.

## Validação ao vivo via `wrangler tail`

Pra ver request/response REAL chegando no gateway (útil pra debug), rode em outro terminal:

```bash
cd gateway
export CLOUDFLARE_API_TOKEN="$(grep -oP '(?<=^CLOUDFLARE_API_TOKEN=).*' ../.env)"
npx wrangler tail --format=json | grep -E "generate_|invalid_"
```

Filtre pelo modelo:

```bash
npx wrangler tail --format=json | jq 'select(.event.request.url | test("chat/completions"))'
```

Cada request VS Code aparece como evento `POST https://.../v1/chat/completions` seguido de `generate_submitted`.

## Troubleshooting — 3 erros mais comuns

### Erro 1: **405 method_not_allowed** com `allowed: ["POST /jobs", "GET /jobs/{id}"]`

- **Causa:** URL configurada incorretamente. Provavelmente aponta pra base URL (`.../v1`) ou pra endpoint que não existe (`.../v1/generate/chat/completions`).
- **Fix:** Confira que `"url"` é exatamente `https://gemma4-gateway.jhonata-matias.workers.dev/v1/chat/completions`.

### Erro 2: **401 authentication_error**

- **Causa:** API key errada, expirada, ou não presente.
- **Fix:** No painel de chat, comando `Copilot: Clear BYOK Secrets`, depois reabra o chat — VS Code vai pedir a API key de novo. Cole a chave certa (formato hex 64 chars).

### Erro 3: **Output vazio ou texto tipo "I am an AI assistant..."**

- **Causa:** Modelo escolhido é pequeno demais pra task, ou tool-calling não habilitado.
- **Fix:**
  - Confirme que está usando `qwen3-coder:30b` (não `gemma4:e4b`) pra tasks de dev
  - Confirme `"toolCalling": true` no config
  - Se estiver rodando task muito complexa (T4/T5 — refactor grande, fiscal brasileiro, WebSocket presence), lembre que modelo 30B tem teto — **NÃO É Claude Sonnet**. Use pra T1-T2 preferencialmente

## Harness anti-alucinação (política Story 7.1 AC5)

**REGRA:** Nenhum PR gerado pelo Qwen entra no repo sem:

1. `npm test` verde (gate obrigatório — self-serve se pass)
2. `npm run lint` sem erros críticos
3. Owner revisa o diff no VS Code antes de commit

**REGRA ADICIONAL (recomendação, não obrigação) para T4/T5:**

- Refactors amplos (>500 LOC): pedir segunda passada em Claude Code Sonnet pra sanity-check
- Código fiscal brasileiro (NFS-e, PGDAS, LC 116/214, PlugNotas): **SEMPRE** revisar linha a linha — nem GPT-5 acerta esse domínio sem RAG
- Auth / security-sensitive: **SEMPRE** revisar linha a linha
- Migrations DB: **NUNCA** aceitar sem testar em ambiente de staging

Owner tem discrição pra decidir caso a caso, mas essas 4 áreas o modelo 30B falha com frequência preocupante (base empírica: análise PM 2026-07-25 sobre 98 PRs do repo Onety).

## Kill switch

Se após 30 dias de uso (memo em `docs/research/agentic-coding-outcome-2026-08-24.md`) < 20% dos seus PRs estão sendo drafted pelo Qwen → teardown via `spike/qwen3-coder-vscode/teardown.sh`. Instruções detalhadas no script.

## Custos

- **Cobrado só quando ativo**: RunPod Serverless bilhet por segundo ($0.00034/s = $1.22/hr para GPU 48GB)
- **Estimativa mensal**: 25 hrs/mês (light user) ≈ $30 · 100 hrs/mês (heavy) ≈ $122
- **Soft cap**: $60/mo (Story 7.1 AC6) — se passar, owner avalia
- **Idle**: **$0** — sem custo quando você não está usando

Cost tracking manual via `wrangler tail` — não há dashboard automático nesta MVP.

## Cross-refs

- Story: [`docs/stories/7.1.qwen3-coder-vscode-spike.story.md`](../stories/7.1.qwen3-coder-vscode-spike.story.md)
- Brief: [`docs/brief-agentic-coding.md`](../brief-agentic-coding.md)
- Deploy gateway: [`docs/usage/gateway-deploy.md`](gateway-deploy.md)
- Runpod serverless deploy: [`docs/usage/runpod-serverless-deploy.md`](runpod-serverless-deploy.md)
- Text gen API quickstart: [`docs/usage/text-gen-api-quickstart.md`](text-gen-api-quickstart.md)
