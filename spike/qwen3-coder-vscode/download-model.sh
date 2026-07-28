#!/usr/bin/env bash
# spike/qwen3-coder-vscode/download-model.sh
#
# Baixa Qwen3-Coder-30B-A3B-Instruct-AWQ para o volume RunPod anexado
# ao endpoint serverless. Executar DENTRO do RunPod endpoint (via runner
# container ou pod persistente temporário compartilhando o volume) —
# NÃO na máquina do owner.
#
# Story: 7.1 · AC: 2 · Precedent: spike/hidream-poc/download.sh (spike anterior)
#
# ⚠️ EXECUTAR SÓ APÓS License Stack Audit COMPLETO (spike/qwen3-coder-vscode/license-audit.md).
# ⚠️ Task 2 gate — @dev pin exact HF revision hash antes de rodar.

set -euo pipefail

# ---------- Config ----------

# Repo HF Hub (⚠️ Task 2: confirmar revisão mais recente e pinar por commit hash)
MODEL_REPO="${MODEL_REPO:-Qwen/Qwen3-Coder-30B-A3B-Instruct-AWQ}"
MODEL_REVISION="${MODEL_REVISION:-main}"  # ⚠️ TROCAR por commit hash em Task 2

# Destino no volume anexado (ollama-models mqqgzwnfp1, 150GB, US-IL-1)
VOLUME_MOUNT="${VOLUME_MOUNT:-/workspace}"
MODEL_DIR="${VOLUME_MOUNT}/coding/models/qwen3-coder-30b"

# HF token (opcional se repo público)
HF_TOKEN="${HF_TOKEN:-}"

# ---------- Sanity checks ----------

if [ ! -d "$VOLUME_MOUNT" ]; then
  echo "ERROR: Volume mount ${VOLUME_MOUNT} não existe. Anexar volume mqqgzwnfp1 primeiro." >&2
  exit 1
fi

# Espaço livre — precisa de ≥ 25GB (17GB weights + overhead)
avail_gb=$(df -BG "$VOLUME_MOUNT" | awk 'NR==2 {gsub("G","",$4); print $4}')
if [ "$avail_gb" -lt 25 ]; then
  echo "ERROR: Espaço insuficiente em ${VOLUME_MOUNT}: ${avail_gb}GB (precisa ≥ 25GB)" >&2
  exit 1
fi

# Python + huggingface_hub CLI disponível
if ! command -v huggingface-cli >/dev/null; then
  echo "Installing huggingface_hub CLI…"
  pip install --quiet huggingface_hub
fi

# ---------- License Stack Audit gate ----------

echo ""
echo "=========================================="
echo "License Stack Audit gate — Story 7.1 AC1"
echo "=========================================="
echo ""
echo "Este script vai baixar ${MODEL_REPO}@${MODEL_REVISION}."
echo ""
echo "Você COMPLETOU a License Stack Audit em spike/qwen3-coder-vscode/license-audit.md?"
echo "  - Layer 1 (weights) LICENSE re-lida da revisão pinada?"
echo "  - Layer 2 (tokenizer_config) inspecionado?"
echo "  - Layer 6 (auxiliary models) scan feito?"
echo ""
read -r -p "Prosseguir com download? [y/N] " confirm
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo "ABORTED — complete a audit primeiro."
  exit 1
fi

# ---------- Download ----------

mkdir -p "$MODEL_DIR"

echo ""
echo "Downloading ${MODEL_REPO}@${MODEL_REVISION} para ${MODEL_DIR}…"
echo "(≈ 17GB, ~7-15 min dependendo de bandwidth)"

start_ts=$(date +%s)

huggingface-cli download \
  "${MODEL_REPO}" \
  --revision "${MODEL_REVISION}" \
  --local-dir "${MODEL_DIR}" \
  --local-dir-use-symlinks False \
  ${HF_TOKEN:+--token "${HF_TOKEN}"}

end_ts=$(date +%s)
elapsed=$((end_ts - start_ts))

# ---------- Sanity check pós-download ----------

echo ""
echo "Download concluído em ${elapsed}s."
echo ""
echo "Verificando arquivos…"

expected_files=("config.json" "tokenizer_config.json" "tokenizer.json")
for f in "${expected_files[@]}"; do
  if [ ! -f "${MODEL_DIR}/${f}" ]; then
    echo "WARN: ${f} não encontrado — verificar manualmente" >&2
  else
    echo "  ✓ ${f}"
  fi
done

# Copiar LICENSE para o modelo (compliance com Apache-2.0 NOTICE propagation)
if [ -f "${MODEL_DIR}/LICENSE" ] || [ -f "${MODEL_DIR}/LICENSE.txt" ]; then
  echo "  ✓ LICENSE presente"
else
  echo "WARN: LICENSE não encontrada no download — inspecionar HF Hub manualmente" >&2
fi

# ---------- Cost tracking ----------

cost_ledger="/tmp/cost-ledger-download.json"
runtime_cost=$(awk "BEGIN {printf \"%.4f\", ${elapsed} * (1.22 / 3600)}")

cat > "$cost_ledger" <<EOF
{
  "phase": "download",
  "model": "${MODEL_REPO}",
  "revision": "${MODEL_REVISION}",
  "elapsed_seconds": ${elapsed},
  "rate_usd_per_sec_48gb": 0.00034,
  "estimated_cost_usd": ${runtime_cost},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo ""
echo "Custo estimado do download: \$${runtime_cost} (assumindo endpoint ativo 48GB @ \$1.22/hr)"
echo "Ledger em ${cost_ledger} — copiar para .aiox/notes/story-7.1/cost-ledger.json"

echo ""
echo "✅ Download completo. Próximo passo: rodar smoke-test.sh contra o endpoint."
