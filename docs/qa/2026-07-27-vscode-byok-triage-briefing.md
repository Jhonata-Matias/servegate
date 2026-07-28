# Triage Briefing — VS Code BYOK / Qwen3-Coder crash persistente

**Autor:** @pm Morgan
**Data:** 2026-07-27 19:15 GMT-3
**Status:** ACTIVE — bloqueia fechamento da Story 7.1
**Motivo do briefing:** 3 ciclos consecutivos de debug single-layer não convergiram. Necessário observabilidade simultânea nas 3 camadas antes de próxima hipótese.

---

## 1. O que já sabemos (fatos, não hipóteses)

### Camada 1 — Gateway (Cloudflare Worker)

| Evidência | Fonte | Interpretação |
|---|---|---|
| Deploy `a0d8dacd-...` em prod desde 17:44 GMT-3 | `wrangler deploy` output | Fix de Story 7.1.1 está live |
| curl 401 sem auth → HTTP 401 + `x-request-id` presente | smoke direto | Contrato de header funciona no path 401 |
| curl 502 forçado (upstream 5xx) → HTTP 502 + `x-request-id` presente | smoke com POD down | Contrato de header funciona no path 502 |
| curl qwen3-coder stream:false → HTTP 200 em 2.0-2.5s | smoke direto | Path completo gemma4→ollama→translate→envelope funciona |
| curl qwen3-coder stream:true+tools → HTTP 200 em 2s, SSE 618 bytes | smoke com tools | Path streaming também funciona; emite tool_calls |
| Request VS Code capturada em tail (IPv6 `2804:14d:...`) | wrangler tail texto | VS Code **chega** ao gateway após ajuste de URL |
| 6 submits VS Code, 0 completions, 0 upstream_errors | wrangler tail texto | Padrão consistente com streaming (não loga terminal) OU cancelamento client-side antes de terminar |

### Camada 2 — POD Qwen (RunPod)

| Evidência | Fonte | Interpretação |
|---|---|---|
| POD `i79btb31827rxl` "qwen3-coder-pod-bandwidth-test" RUNNING desde 21:21 UTC | `/v1/pods` REST | POD startado pelo owner |
| Ollama `/api/tags` responde 200 com `qwen3-coder:30b` (18.55GB, 30.5B, tools capability) | proxy direto | Modelo pulled e disponível |
| Ollama `/` responde 200 "Ollama is running" | proxy direto | Service saudável |
| Latência curl direto ao gateway 2-2.5s | smoke | Ollama serve rápido quando warm |

### Camada 3 — VS Code Copilot BYOK (cliente)

| Evidência | Fonte | Interpretação |
|---|---|---|
| Config inicial tinha `qwen3-coder.url` com path completo `.../v1/chat/completions` | user settings.json | Copilot BYOK concatena `/chat/completions` → path duplicado; request nem chegava |
| Config ajustada para `.../v1` | user reportou | Após ajuste, request chega ao gateway (IPv6 capturado) |
| Erro persiste **após** ajuste: `502 Please check your firewall rules... Cannot read properties of undefined (reading 'headerRequestId')` | user reportou | Sintoma idêntico mas mecanismo pode ser diferente do inicial |
| Frase "Please check your firewall rules and network connection" | user error | Não é string do meu gateway — é do SDK do cliente Copilot |

### O que ainda NÃO sabemos (unknowns)

1. **Response.status real que o gateway devolveu para VS Code** — só sabemos que submit=202 foi logado. Precisamos do JSON tail com `event.response.status` para requests do IPv6 do user.
2. **Se o Worker emitiu exception** — tail JSON mostra `exceptions: []` para minha marker, mas nunca capturamos uma request do VS Code em modo JSON.
3. **Se há intermediário Microsoft/GitHub entre VS Code e Cloudflare** — request veio direto IPv6 do user, mas Copilot BYOK pode ter camada de validation/enrichment.
4. **Se o SSE de resposta é interpretável pelo parser do BYOK** — nosso curl aceita, mas parser do Copilot pode ter expectativa diferente (Content-Length, chunking, etc).
5. **O que o Ollama recebe de fato** quando a request chega — sem SSH ao POD, cego para Ollama-side.

---

## 2. Por que os ciclos anteriores não convergiram

### Padrão de falha observado

```
Ciclo 1 (@qa): diagnostiquei "header missing em error paths" → fix + deploy + smoke curl OK → erro persiste
Ciclo 2 (@qa+@devops): descobri URL BYOK malformada → user ajustou → erro persiste
Ciclo 3 (@qa): tail texto mostrou request chegando mas sem terminal event → hipótese streaming path OK → user reproduz outra vez → tail JSON vazio
```

**Erro estrutural comum aos 3 ciclos:**
- Instrumentação **sequencial** (gateway primeiro, POD depois, VS Code por último)
- Reprodução do usuário desconectada da janela de captura → tail expira sem pegar nada
- Nenhuma camada tem timestamp correlacionado com as outras
- Hipóteses testadas 1-por-1, cada uma "explicaria" o erro mas nenhuma foi VALIDADA

**Custo até agora:** ~4h de sessão, 4 commits pushados, 2 deploys em prod, 1 pull de modelo 18GB, sem entregar valor real ao user.

---

## 3. Plano de trabalho — instrumentação simultânea das 3 camadas

### Princípio

**Uma única reprodução do usuário deve gerar dados alinhados nas 3 camadas dentro da mesma janela de tempo.** Depois correlacionamos por timestamp para identificar em qual hop o erro nasce.

### Setup pré-reprodução (executar ANTES de pedir user pra tentar)

#### Camada 1 — Gateway (Cloudflare Worker)

```bash
# Terminal A — JSON tail persistente
cd gateway && nohup npx wrangler tail --format=json > /tmp/L1-gw.jsonl 2>&1 &
disown
```

**Captura:** `event.request.headers`, `event.response.status`, `logs[]`, `exceptions[]`, `wallTime`, `cpuTime`, `outcome`.

#### Camada 2 — POD Qwen (Ollama)

**Opção A (preferida):** SSH ao POD e tail dos logs do Ollama.
```bash
# Terminal B — via RunPod SSH (precisa configurar chave SSH no POD)
ssh -p <PORT> root@<POD_HOST> "journalctl -fu ollama.service --output=json" > /tmp/L2-ollama.jsonl
```

**Opção B (fallback se sem SSH):** Poll `/api/ps` (running models) e `/api/tags` a cada 500ms para detectar variação de VRAM/model-loaded durante a request.
```bash
# Terminal B — proxy poll (menos detalhado mas não requer SSH)
while true; do
  ts=$(date +%s%3N)
  curl -sS --max-time 2 "https://i79btb31827rxl-11434.proxy.runpod.net/api/ps" | \
    jq --arg t "$ts" '{ts: $t, ps: .}' >> /tmp/L2-ollama-poll.jsonl
  sleep 0.5
done &
```

**Captura:** timing de request enter/exit no Ollama, model load/unload events, memory pressure, upstream response body.

**AÇÃO REQUERIDA:** Owner precisa configurar SSH no POD OU aceitar fallback poll. Pergunta em §5.

#### Camada 3 — VS Code Copilot BYOK

**Opção A (preferida):** VS Code DevTools + Copilot output channel.

1. `View → Output` → dropdown "GitHub Copilot" (ou "Copilot Chat" ou "AI Model Access")
2. Ativar `Developer: Toggle Developer Tools` → Network tab habilitar HAR export
3. `Developer: Show Logs → Extension Host`

**Opção B (fallback):** mitmproxy local interceptando o request do VS Code.
```bash
# Setup mitmproxy no host WSL
mitmproxy --mode reverse:https://gemma4-gateway.jhonata-matias.workers.dev --listen-port 8888
# Configura BYOK url para http://localhost:8888/v1
# Captura request + response byte-a-byte
```

**Captura:** exata request bytes que sai do VS Code, exata response bytes/erro que ele recebe, timing de cada retry, stack trace do crash `headerRequestId`.

### Protocolo de reprodução

1. **Confirmar 3 instrumentações ativas** (checklist visual antes de continuar)
2. **Sincronizar clock** — todos os terminais mostram `date -u +%s%3N` como marcador T0
3. **Owner reproduz UMA vez** e reporta timestamp exato do erro no chat
4. **Congelar captura** — parar todos os tails/polls simultaneamente
5. **Análise correlacionada** (§4)

---

## 4. Matriz de diagnóstico — hipótese × evidência esperada

| Hipótese | Camada L1 Gateway | Camada L2 Ollama | Camada L3 VS Code |
|---|---|---|---|
| **H1: Response SSE tem shape que Copilot BYOK não parseia** | 200 OK, request no log, sem exception | Request completa normal, response normal | HAR mostra 200 recebido, mas SDK erra ao parsear body |
| **H2: Worker timeout / CPU limit no path streaming** | `exceptions: [...]` OU `outcome: exception`, wallTime ~30s | Request chega, resposta forma, mas conexão dropa mid-stream | HAR mostra connection reset ou timeout |
| **H3: Proxy Microsoft/GitHub sobrepondo o BYOK** | Request no gateway com headers Microsoft (via, x-ms-*) | N/A | HAR mostra request vai para Microsoft first, não direto pro gateway |
| **H4: Copilot envia payload malformado que gateway responde 400** | `generate_invalid_input` log, response 400, com x-request-id | Nada — nunca alcança Ollama | HAR mostra 400 recebido, SDK crash no error object |
| **H5: TLS/HTTP2 handshake falha intermitente** | Request pode nem aparecer | Nada | HAR mostra "network error" antes de qualquer status |
| **H6: `stream: true` + max_tokens grande + Ollama lento causa client-side abort** | 202 submit sem terminal event; wallTime longo | Request entra, model gera devagar, Ollama demora >X segundos | HAR mostra request abortada pelo cliente após timeout curto |
| **H7: Tool schema no request faz Ollama travar** | 202 submit, wallTime longo, sem terminal | Ollama loga erro parsing tools | HAR mostra request enviada com tools, response nunca chega |

### Regras de eliminação

- Se **L1 mostra 200 e exceptions=[]** → H2/H4/H5 eliminadas → foco em H1/H3/H6/H7
- Se **L2 mostra request nunca chega** → H1/H4 eliminadas → foco em H2/H3/H5
- Se **L3 HAR mostra request nem sai** → H1/H2/H4 eliminadas → foco em H3/H5

---

## 5. Perguntas para owner (bloqueiam avanço)

Não avançar sem estas respostas.

1. **Acesso SSH ao POD Qwen?** — Habilitado? Chave configurada? Se não, aceita fallback de poll ao Ollama `/api/ps`?

2. **VS Code DevTools funciona no seu setup?** — `Help → Toggle Developer Tools` abre? Network tab acessível? Ou preferimos mitmproxy?

3. **Copilot Chat output channel** — Alguma pista lá quando o erro acontece? (Copilot loga bastante em output channel próprio, pode ter stack trace do crash)

4. **Você aceita adicionar debug logging TEMPORÁRIO no gateway** — 1 commit que loga request body + response body inteira do path streaming, deploy, reproduz, revert? Aumenta observabilidade sem esperar por SSH.

5. **Tempo disponível pra continuar hoje** — Se >1h, executamos protocolo completo agora. Se <30min, priorizamos setup pra retomar amanhã.

---

## 6. Exit criteria — quando esta triagem termina

Encerramos com **um** dos três outcomes:

- **A) Root cause identificado + fix aplicado + smoke real VS Code green** → Story 7.1.1 e 7.1 fechadas
- **B) Root cause identificado mas fix requer trabalho >2h** → Nova story criada pelo @sm, 7.1 mantém aberta com dependency
- **C) Root cause é external (proxy Microsoft, bug do Copilot, etc)** → Documentar workaround (ex: usar Continue.dev em vez de Copilot BYOK), fechar 7.1.1 como Done + WAIVED, escalar para issue upstream

---

## 7. Assignments por agent

| Agent | Responsabilidade | Deliverable |
|---|---|---|
| @pm Morgan | Orchestrar protocolo, correlacionar dados 3-camadas, decidir A/B/C do §6 | Este briefing + relatório final |
| @devops Gage | Setup L1 gateway tail JSON + eventual debug logging deploy | Log files L1 + deploy hash se aplicável |
| @architect Aria | Interpretar shapes SSE/HTTP se hipótese H1 confirmar | Arquitetural review + adjust plan |
| @dev Dex | Implementar fix quando root cause identificado | PR de correção |
| Owner (você) | Setup L2 (SSH POD) + L3 (VS Code DevTools) + reprodução coordenada | HAR file + Copilot output log |

---

## 8. Reconhecimento explícito

Os ciclos anteriores foram executados de boa-fé mas com metodologia errada — cada fix era plausível ao ver evidência parcial, mas nenhum foi VALIDADO end-to-end antes de declarar sucesso. Este briefing corrige o padrão. O custo (4h + prod deploys) não foi desperdiçado (fix real de header regression foi entregue e é útil), mas não resolveu o problema do owner que motivou toda a sessão.

**Compromisso @pm:** Nenhum novo fix vai a prod nesta sessão até termos evidência correlacionada das 3 camadas. Se owner autorizar reprodução, executamos. Se não, paramos e retomamos com plano.
