#!/usr/bin/env bash
# spike/qwen3-coder-vscode/teardown.sh
#
# Desliga o spike Qwen3-Coder end-to-end. Roteiro reversível — pode ser
# rodado a qualquer momento (durante spike se circuit breaker $5, ou
# no D+30 se kill signal <20% PRs migrados).
#
# Story: 7.1 · AC: 10 · Ação: KILL SWITCH
#
# ⚠️ Este script REMOVE endpoint RunPod + secret Cloudflare + rota do gateway.
# ⚠️ Rodar SÓ com decisão formal de kill em ADR-0007.

set -euo pipefail

MODE="${1:-normal}"  # normal | --emergency

if [ "$MODE" = "--emergency" ]; then
  echo "🚨 EMERGENCY TEARDOWN — pulando confirmações"
  confirm=y
else
  echo "=============================================="
  echo "Teardown Story 7.1 — Qwen3-Coder-30B spike"
  echo "=============================================="
  echo ""
  echo "Vai executar (em ordem):"
  echo "  1. Deletar RunPod Serverless endpoint qwen3-coder-poc-*"
  echo "  2. Remover secret RUNPOD_CODER_ENDPOINT_ID do Cloudflare Worker"
  echo "  3. Rollback do gateway pra version pré-Qwen (via wrangler versions rollback)"
  echo "  4. Opcional: apagar weights do volume 150GB"
  echo ""
  read -r -p "Prosseguir? [y/N] " confirm
fi

if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo "ABORTED"
  exit 1
fi

# ---------- Step 1: Deletar RunPod endpoint ----------

echo ""
echo "Step 1 — Deletar RunPod Serverless endpoint"

if [ -f ".aiox/notes/story-7.1/endpoint-info.json" ]; then
  endpoint_id=$(jq -r '.endpoint_id' .aiox/notes/story-7.1/endpoint-info.json)
  echo "  Endpoint ID: ${endpoint_id}"
  echo ""
  echo "  Executar (manual — RunPod API requer request específico):"
  echo "    curl -X DELETE https://api.runpod.ai/v2/${endpoint_id} \\"
  echo "      -H \"Authorization: Bearer \$RUNPOD_API_KEY\""
  echo ""
  echo "  Ou via dashboard: https://www.runpod.io/console/serverless"
  echo ""
  read -r -p "  Endpoint deletado? [y/N] " step1_done
  if [[ "${step1_done}" != "y" && "${step1_done}" != "Y" ]]; then
    echo "  ⚠️ Endpoint NÃO deletado — spend continua acumulando"
  else
    echo "  ✅ Step 1 done"
  fi
else
  echo "  WARN: endpoint-info.json não existe — pular Step 1 manualmente"
fi

# ---------- Step 2: Remover secret Cloudflare ----------

echo ""
echo "Step 2 — Remover secret RUNPOD_CODER_ENDPOINT_ID do Worker"
echo ""
echo "  Executar (com CLOUDFLARE_API_TOKEN exportado):"
echo "    cd gateway && npx wrangler secret delete RUNPOD_CODER_ENDPOINT_ID --env=\"\""
echo ""
read -r -p "  Secret removido? [y/N] " step2_done
if [[ "${step2_done}" == "y" || "${step2_done}" == "Y" ]]; then
  echo "  ✅ Step 2 done"
else
  echo "  ⚠️ Secret ainda presente — worker vai retornar erro se qualquer client bater qwen3-coder:30b"
fi

# ---------- Step 3: Rollback do gateway ----------

echo ""
echo "Step 3 — Rollback do gateway pra version pré-Qwen"
echo ""
echo "  Ver versions ativas:"
echo "    cd gateway && npx wrangler versions list --env=\"\""
echo ""
echo "  Rollback pra version c737cd5c (pré-Qwen, deploy 2026-07-25):"
echo "    npx wrangler versions rollback --env=\"\" <VERSION_ID>"
echo ""
echo "  OU (alternativa): manter o código com routing branch (é additive) —"
echo "  sem secret RUNPOD_CODER_ENDPOINT_ID, a rota qwen3-coder:30b retorna"
echo "  automaticamente 400 model_not_found. Rollback só necessário se quiser"
echo "  remover o código também."
echo ""
read -r -p "  Rollback feito (ou decidiu manter routing sem secret)? [y/N] " step3_done
if [[ "${step3_done}" == "y" || "${step3_done}" == "Y" ]]; then
  echo "  ✅ Step 3 done"
else
  echo "  ⚠️ Gateway em estado ambíguo — resolver antes de fechar teardown"
fi

# ---------- Step 4 (opcional): Apagar weights ----------

echo ""
echo "Step 4 (OPCIONAL) — Apagar weights do volume 150GB"
echo ""
echo "  Weights ocupam ~17GB em /workspace/coding/models/qwen3-coder-30b/"
echo "  Volume mqqgzwnfp1 continua provisionado (~\$10.50/mo já pago)."
echo "  Apagar libera espaço mas não muda custo."
echo ""
read -r -p "  Apagar weights? (y para apagar, n para preservar reuso futuro) [y/N] " step4_done
if [[ "${step4_done}" == "y" || "${step4_done}" == "Y" ]]; then
  echo "  Executar dentro do pod com volume anexado:"
  echo "    rm -rf /workspace/coding/models/qwen3-coder-30b/"
  echo "  ✅ Instrução emitida"
else
  echo "  ⏸  Weights preservados — reuso futuro possível"
fi

# ---------- Wrap up ----------

echo ""
echo "=============================================="
echo "Teardown Story 7.1 — CONCLUÍDO"
echo "=============================================="
echo ""
echo "Próximos passos:"
echo "  1. Atualizar Story 7.1 Change Log — teardown executado + data"
echo "  2. ADR-0007 formaliza kill (ou go se você refez o teardown por engano)"
echo "  3. Owner atualiza .env local: remover referência RUNPOD_CODER_ENDPOINT_ID se existir"
echo "  4. VS Code settings.json: remover entry 'qwen3-coder:30b' do vendor customendpoint"
echo ""
echo "Cost ledger final em .aiox/notes/story-7.1/cost-ledger.json"
