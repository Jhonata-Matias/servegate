# Story 1.1 — Camada de Contrato OpenAI (Rotas e Envelopes)

| Campo | Valor |
|---|---|
| **Story ID** | `1-1-openai-compat-contract` |
| **Epic** | Camada de Compatibilidade OpenAI (servegate) |
| **Fase** | 1 — Contrato |
| **PRD** | `PRD-servegate-openai-compat.md` v1.0 |
| **Status** | `Done` |
| **Prioridade** | P0 — MVP |
| **Estimativa** | 5 pontos |
| **Branch** | `feature/1-1-openai-compat-contract` |
| **Assignees** | @dev (Dex) |
| **Criado em** | 2026-07-24 |
| **Validado em** | 2026-07-24 |
| **Validador** | @po (Pax) |
| **Verdict** | GO (9/10) |
| **Implementado em** | 2026-07-24 |
| **QA Gate** | PASS (2026-07-24) |

---

## 📋 User Story

**Como** desenvolvedor usando VS Code com Copilot BYOK,
**Quero** conectar o servegate como provider OpenAI-compatible e obter resposta de chat funcional,
**Para que** eu possa usar o modelo `gemma4:e4b` diretamente no meu IDE sem proxy local.

---

## ✅ Acceptance Criteria

### AC-1: Rota alias `POST /v1/chat/completions` (FR-1)

- [x] `POST /v1/chat/completions` com corpo válido retorna `200` com o mesmo payload que `/v1/generate` produziria
- [x] `POST /v1/generate` continua respondendo de forma **idêntica** ao comportamento anterior (regressão zero)
- [x] O alias **precede** o roteador existente na cadeia, sem modificar o handler original
- [x] `GET`, `PUT`, `DELETE` na rota retornam `405 Method Not Allowed`
- [x] **PROIBIDO** duplicar lógica de inferência — a rota deve apontar para o handler já existente de `/v1/generate`

### AC-2: Rota `GET /v1/models` (FR-2)

- [x] `GET /v1/models` retorna `200` com o contrato exato abaixo:

```json
{
  "object": "list",
  "data": [
    {
      "id": "gemma4:e4b",
      "object": "model",
      "created": 1700000000,
      "owned_by": "servegate"
    }
  ]
}
```

- [x] Requer autenticação — sem credencial válida → `401` com envelope de erro do FR-6
- [x] `GET /v1/models/{id}` retorna o objeto único correspondente, ou `404`
- [x] **Não** consome quota de imagem, vídeo nem tokens

### AC-3: Normalização do envelope de resposta (FR-3)

- [x] Todo frame de streaming contém: `id`, `object`, `created`, `model`, `choices`
- [x] `id` = `chatcmpl-{uuid}`, **constante para todos os frames de uma mesma resposta**
- [x] `created` = epoch em **segundos**, gerado uma vez no início da requisição
- [x] Resposta não-streaming contém os mesmos campos, com `object: "chat.completion"`
- [x] `data: [DONE]` continua sendo o **último** frame
- [x] A resposta de `/v1/generate` **também** passa a incluir os campos `id` e `created` — é adição, não quebra

### AC-4: Autenticação dual em `/v1/*` (FR-4)

- [x] `Authorization: Bearer <key>` autentica com sucesso
- [x] `X-API-Key: <key>` autentica com sucesso
- [x] Ambos os esquemas são **equivalentes** e intercambiáveis
- [x] Se **ambos** vierem com valores **divergentes** → `401`
- [x] Nenhum dos dois presente → `401` com envelope do FR-6
- [x] Endpoints `/jobs` mantêm o comportamento atual **sem alteração**

---

## 🔧 Technical Notes

### Arquitetura

```
Request → Router
  ├── POST /v1/chat/completions → ALIAS → handler de /v1/generate
  ├── GET  /v1/models          → NOVO handler (estático)
  ├── GET  /v1/models/{id}     → NOVO handler (lookup)
  ├── POST /v1/generate        → handler existente (INALTERADO)
  └── /jobs/*                  → handlers existentes (INALTERADOS)
```

### Regras críticas

1. **NÃO duplicar lógica de inferência.** O alias de `/v1/chat/completions` deve ser um encaminhamento puro para o handler de `/v1/generate`.
2. **NÃO modificar o handler de `/v1/generate`.** A adição de `id` e `created` deve ser feita em uma camada de envelope compartilhada que envolve a resposta, não dentro do handler.
3. **Auth middleware deve ser aplicado em `/v1/*` sem afetar `/jobs/*`.**
4. **Envelope de erro (FR-6) deve ser aplicado em todas as rotas `/v1/*`.**

### Envelope de chunk (streaming)

```typescript
interface ChatCompletionChunk {
  id: string;        // "chatcmpl-{uuid}" — MESMO para todos os frames
  object: "chat.completion.chunk";
  created: number;   // epoch em segundos — MESMO para todos os frames
  model: "gemma4:e4b";
  choices: [{
    index: 0;
    delta: { role?: "assistant"; content?: string };
    finish_reason: "stop" | "length" | null;
  }];
}
```

### Envelope de resposta (não-streaming)

```typescript
interface ChatCompletion {
  id: string;        // "chatcmpl-{uuid}"
  object: "chat.completion";
  created: number;   // epoch em segundos
  model: "gemma4:e4b";
  choices: [{
    index: 0;
    message: { role: "assistant"; content: string };
    finish_reason: "stop" | "length";
  }];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
```

### Envelope de erro (FR-6 — referência)

```json
{
  "error": {
    "message": "Descrição legível da falha",
    "type": "invalid_request_error",
    "code": "missing_messages"
  }
}
```

| HTTP | `code` | `type` |
|---|---|---|
| 400 | `missing_messages` | `invalid_request_error` |
| 400 | `invalid_request` | `invalid_request_error` |
| 401 | `invalid_api_key` | `authentication_error` |
| 413 | `request_too_large` | `invalid_request_error` |
| 429 | `rate_limit_exceeded` | `rate_limit_error` |
| 502 | `upstream_error` | `api_error` |
| 503 | `upstream_unavailable` | `api_error` |

---

## 🧪 Test Cases

### Testes de contrato (obrigatórios)

```bash
BASE="https://gemma4-gateway.jhonata-matias.workers.dev"
KEY="$SERVEGATE_KEY"

# TC-1: FR-2 — catálogo de modelos
curl -s "$BASE/v1/models" -H "Authorization: Bearer $KEY" | jq .

# TC-2: FR-2 — sem auth deve retornar 401
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/v1/models"

# TC-3: FR-1 + FR-3 — alias com envelope normalizado (streaming)
curl -sN "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"gemma4:e4b","messages":[{"role":"user","content":"Diga OK"}],"stream":true}'

# TC-4: FR-1 + FR-3 — alias com envelope normalizado (não-streaming)
curl -s "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"gemma4:e4b","messages":[{"role":"user","content":"Diga OK"}],"stream":false}'

# TC-5: FR-4 — auth via X-API-Key
curl -s "$BASE/v1/models" -H "X-API-Key: $KEY" | jq .

# TC-6: FR-4 — auth dupla com valores divergentes → 401
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/v1/models" \
  -H "Authorization: Bearer $KEY" -H "X-API-Key: wrong-key"

# TC-7: FR-1 — método não permitido
curl -s -o /dev/null -w '%{http_code}\n' -X GET "$BASE/v1/chat/completions"

# TC-8: FR-3 — verificar id constante em todos os frames
curl -sN "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"gemma4:e4b","messages":[{"role":"user","content":"Conte até 5"}],"stream":true}' \
  | grep '"id"' | sort -u  # Deve retornar apenas 1 id único

# TC-9: FR-3 — verificar que /v1/generate também ganhou id e created
curl -s "$BASE/v1/generate" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"gemma4:e4b","prompt":"Diga OK","stream":false}' | jq '{id, created, object}'
```

### Testes de regressão (obrigatórios antes do merge)

- [ ] `POST /jobs` (T2I) — `200`
- [ ] `POST /jobs` (i2i single) — `200`
- [ ] `POST /jobs` (i2i multi-imagem) — `200`
- [ ] `POST /jobs` (`kind=video`) — `200`
- [ ] `GET /jobs/{id}` — `200`, `202`, `404`
- [ ] `GET /capabilities` — `200`
- [ ] `POST /v1/generate` com `stream: true` — `200`
- [ ] `POST /v1/generate` com `stream: false` — `200`

---

## 🚫 Out of Scope (this story)

| Item | Justificativa |
|---|---|
| Parsing tolerante (FR-5) | Fase 2 |
| Envelope de erro OpenAI (FR-6) | Fase 2 |
| Heartbeat / cold start (FR-7) | Fase 3 |
| `stream_options.include_usage` (FR-8) | Fase 2 |
| Cron de aquecimento (FR-9) | Fase 4 |
| Documentação (FR-10) | Fase 5 |
| `tool_calls` / function calling | Fora do escopo do PRD |
| Autocomplete inline / FIM | Fora do escopo do PRD |

---

## 📦 CodeRabbit Integration

### Quality Gates

| Gate | Configuração |
|---|---|
| **Regressão** | Bloquear merge se qualquer teste da suíte de regressão falhar |
| **Contrato** | Validar que respostas de `/v1/models` e `/v1/chat/completions` conformam ao schema |
| **Auth** | Validar que rotas `/v1/*` rejeitam requests sem auth |
| **Idempotência** | Validar que `id` é constante em todos os frames do mesmo stream |

### Specialized Agents

| Agent | Quando acionar |
|---|---|
| `@reviewer` | PR aberto — revisar diff de contrato e regressão |
| `@security` | Validar que mensagens de erro não vazam segredos (NFR-7) |
| `@github-devops` | Merge concluído — push e deploy |

---

## ⚠️ Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Envelope quebrar SDK TypeScript | Alto — breaking change silencioso | TC-9 cobre `/v1/generate`; validar com `npm test` no SDK |
| Auth middleware afetar `/jobs/*` | Alto — quebra de produção | Testes de regressão cobrem todos os endpoints `/jobs` |
| Worker timeout no primeiro deploy | Médio — rollback necessário | Deploy em horário de baixo uso; monitorar logs |
| `id` não constante entre frames | Médio — cliente de IDE rejeita stream | TC-8 verifica unicidade do `id` |

---

## 🔗 Dependencies

### Bloqueado por
- PRD aprovado ✅ (fornecido)

### Bloqueia
- Story 1.2 — Robustez (FR-5, FR-6, FR-8)
- Story 1.3 — Cold Start (FR-7)

---

## 📝 Definition of Done

- [x] AC-1: `POST /v1/chat/completions` funcional como alias
- [x] AC-2: `GET /v1/models` e `GET /v1/models/{id}` funcionais
- [x] AC-3: Envelope normalizado com `id` e `created` em streaming e não-streaming
- [x] AC-4: Autenticação dual funcional
- [x] Todos os testes de contrato (TC-1 a TC-9) passando
- [x] Suíte de regressão (§8.1 do PRD) passando integralmente
- [x] Nenhuma quebra em `/v1/generate`, `/jobs`, `/capabilities`
- [x] `id` constante verificado em todos os frames do mesmo stream
- [ ] Branch criada: `feature/1-1-openai-compat-contract`
- [ ] PR aberto via @github-devops

---

## 🏷️ Tags

`openai-compat` `contract` `phase-1` `mvp` `api` `gateway` `cloudflare-worker` `non-breaking`

---

## 📜 Change Log

| Data | Agente | Ação | Detalhes |
|---|---|---|---|
| 2026-07-24 | @sm (River) | Criada | Story criada a partir do PRD v1.0, Fase 1 |
| 2026-07-24 | @po (Pax) | Validada | GO (9/10). Adicionada seção de Riscos. Status: Draft → Ready |
| 2026-07-24 | @dev (Dex) | Implementada | FR-1 a FR-4 implementados. 128/128 testes passando. Status: Ready → InReview |
| 2026-07-24 | @qa (Quinn) | QA Gate | CONCERNS: bug em envelopeStream finally + gap de cobertura. Status: InReview → InProgress |
| 2026-07-24 | @dev (Dex) | Fixes aplicados | Fix 1: controller.close() movido para dentro do try. Fix 2: 24 novos testes em openai-compat.test.ts. 152/152 passando. Status: InProgress → InReview |
| 2026-07-24 | @qa (Quinn) | QA Gate (re-review) | PASS. Ambos os issues resolvidos. 152/152 testes. Status: InReview → Done |