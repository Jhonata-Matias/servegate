# Spike: Qwen3-Coder-30B servido via gateway pro VS Code BYOK

> **Story:** [`docs/stories/7.1.qwen3-coder-vscode-spike.story.md`](../../docs/stories/7.1.qwen3-coder-vscode-spike.story.md)
> **Brief:** [`docs/brief-agentic-coding.md`](../../docs/brief-agentic-coding.md) (scope amended 2026-07-25)
> **Status:** InProgress (@dev YOLO 2026-07-25)
> **Budget hard cap (setup):** $5 · **Soft cap (steady state):** $60/mo

## O que é

Segundo modelo servido via gateway (`gemma4-gateway.jhonata-matias.workers.dev/v1/chat/completions`) selecionável por `model: "qwen3-coder:30b"`. Endpoint RunPod Serverless dedicado (48GB A6000/L40S tier), vLLM 0.6+ com tool-calling nativo, acessível via VS Code Copilot BYOK.

Additive-only ao gateway atual: rota `qwen3-coder:30b` coexiste com `gemma4:e4b` (rota existente Story 4.2). Rollback trivial via `wrangler versions rollback`.

## Estrutura

```
spike/qwen3-coder-vscode/
├── README.md              ← este arquivo
├── license-audit.md       ← License Stack Audit (Apache-2.0 verification)
├── download-model.sh      ← comandos RunPod pra baixar weights ao volume
├── smoke-test.sh          ← curl end-to-end contra o endpoint pós-deploy
└── teardown.sh            ← desligar endpoint + revert gateway routing
```

## Run procedure (@dev)

Executado em ordem — cada passo é um Task da story 7.1.

1. **Task 1** (offline, YOLO 2026-07-25): scaffolding + license audit — feito
2. **Task 2** (owner-gated — requer $ de setup ~$5, GPU capacity RunPod): provisionar serverless endpoint
   - Confirmar quota A6000/L40S 48GB
   - Rodar `download-model.sh` (dentro do endpoint via RunPod dashboard/API)
   - Capturar endpoint ID em `.aiox/notes/story-7.1/endpoint-info.json`
3. **Task 3** (offline, YOLO 2026-07-25): gateway routing code — feito
4. **Task 4** (offline, YOLO 2026-07-25): test coverage — feito
5. **Task 5** (depende de 2): tool-calling end-to-end validation em preview env
6. **Task 6** (parcial offline, YOLO 2026-07-25): git diff verification — feito. Regressão smoke depende de deploy.
7. **Task 7** (@devops-gated — Article Agent Authority): `wrangler secret put RUNPOD_CODER_ENDPOINT_ID` + `wrangler deploy` prod
8. **Task 8 doc** (offline, YOLO 2026-07-25): VS Code BYOK guide em `docs/guides/vscode-agentic-setup.pt-BR.md` — feito
9. **Task 9** (offline, YOLO 2026-07-25): memo skeleton D+30 + teardown script — feito
10. **Task 10** (@devops-gated): PR + handoff pro @qa

## Budget circuit breaker

Se durante Tasks 2-5 o gasto acumulado passar **$5**, ABORT imediato:
- Rodar `bash teardown.sh --emergency`
- Escalar `@architect` pra decidir se continua com A100 80GB (~$2.74/hr, mais caro) ou aborta o spike

Cost ledger em `.aiox/notes/story-7.1/cost-ledger.json`.

## Steady state monitoring

Após deploy prod, owner acompanha via `wrangler tail --format=json`:
```
wrangler tail --format=json | grep "qwen3-coder"
```

Se ritmo >2h ativo/dia sustentado por semana → projeção >$60/mo → owner avalia (rate-limit adicional? kill switch antecipado?).

## Kill switch

D+30 dias após deploy, owner escreve memo em `docs/research/agentic-coding-outcome-2026-08-24.md` (skeleton já criado).

- **Se ≥ 20% PRs migrados** → GO, mantém, ADR-0007 formaliza go
- **Se < 20% E sem path pra melhorar** → KILL, roda `bash teardown.sh`, ADR-0007 formaliza kill

## Cross-refs

- Padrão gateway routing: [`gateway/src/generate.ts`](../../gateway/src/generate.ts) (helper `resolveModelEndpoint`)
- Padrão spike (estrutura): [`spike/hidream-poc/`](../hidream-poc/) (HiDream 6.1 — cancelada mas padrão é sólido)
- Padrão VS Code BYOK: [`docs/usage/vscode-agentic-setup.pt-BR.md`](../../docs/usage/vscode-agentic-setup.pt-BR.md)
- Precedente License Stack Audit: [`docs/research/hidream-i1-dev-model-card-audit.md`](../../docs/research/hidream-i1-dev-model-card-audit.md)
