#!/usr/bin/env bash
# spike/qwen3-coder-vscode/smoke-test.sh
#
# Roda 3 curl end-to-end contra o gateway pós-deploy do Qwen:
#   1. POST /v1/chat/completions com qwen3-coder:30b (novo — deve responder 200)
#   2. POST /v1/chat/completions com gemma4:e4b (regressão — deve continuar 200)
#   3. GET /v1/models (catálogo — deve incluir ambos)
#
# Story: 7.1 · AC: 9

set -euo pipefail

BASE="${BASE:-https://gemma4-gateway.jhonata-matias.workers.dev}"
API_KEY="${GATEWAY_API_KEY:-}"

if [ -z "$API_KEY" ]; then
  echo "ERROR: exportar GATEWAY_API_KEY antes de rodar (mesma chave testada na sessão 2026-07-25)" >&2
  exit 1
fi

log_dir="${LOG_DIR:-/tmp/smoke-story-7.1}"
mkdir -p "$log_dir"
ts=$(date -u +%Y-%m-%dT%H-%M-%SZ)

log() {
  echo "[$(date -u +%H:%M:%S)] $*"
}

log "=== SMOKE TEST Story 7.1 ==="
log "Gateway: ${BASE}"
log "Log dir: ${log_dir}"
log ""

# ---------- Test 1: Qwen3-Coder novo ----------
log "Test 1 — POST /v1/chat/completions (qwen3-coder:30b)"
resp1=$(curl -sS -w "\nHTTP=%{http_code}\nELAPSED=%{time_total}\n" \
  -X POST "${BASE}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{
    "model": "qwen3-coder:30b",
    "messages": [
      {"role": "user", "content": "Write a Python function that returns the fibonacci sequence up to n. Just the code, no explanation."}
    ],
    "max_tokens": 200,
    "stream": false
  }')
echo "$resp1" | tee "${log_dir}/test1-qwen-${ts}.log"
code1=$(echo "$resp1" | grep "^HTTP=" | cut -d= -f2)
if [ "$code1" != "200" ]; then
  log "❌ Test 1 FAILED: HTTP $code1"
  exit_code=1
else
  log "✅ Test 1 PASS"
fi
log ""

# ---------- Test 2: gemma4:e4b regressão ----------
log "Test 2 — POST /v1/chat/completions (gemma4:e4b — regressão)"
resp2=$(curl -sS -w "\nHTTP=%{http_code}\nELAPSED=%{time_total}\n" \
  -X POST "${BASE}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{
    "model": "gemma4:e4b",
    "messages": [{"role": "user", "content": "Say hi in one word"}],
    "max_tokens": 10,
    "stream": false
  }')
echo "$resp2" | tee "${log_dir}/test2-gemma-${ts}.log"
code2=$(echo "$resp2" | grep "^HTTP=" | cut -d= -f2)
if [ "$code2" != "200" ]; then
  log "❌ Test 2 FAILED (REGRESSÃO): HTTP $code2 — rollback IMEDIATO"
  exit_code=1
else
  log "✅ Test 2 PASS (sem regressão em gemma4:e4b)"
fi
log ""

# ---------- Test 3: catálogo /v1/models ----------
log "Test 3 — GET /v1/models"
resp3=$(curl -sS -w "\nHTTP=%{http_code}\n" \
  "${BASE}/v1/models" \
  -H "X-API-Key: ${API_KEY}")
echo "$resp3" | tee "${log_dir}/test3-models-${ts}.log"
code3=$(echo "$resp3" | grep "^HTTP=" | cut -d= -f2)
has_qwen=$(echo "$resp3" | grep -c "qwen3-coder" || true)
has_gemma=$(echo "$resp3" | grep -c "gemma4" || true)
if [ "$code3" != "200" ] || [ "$has_qwen" = "0" ] || [ "$has_gemma" = "0" ]; then
  log "❌ Test 3 FAILED: HTTP $code3, qwen=$has_qwen, gemma=$has_gemma"
  exit_code=1
else
  log "✅ Test 3 PASS (catálogo com ambos modelos)"
fi
log ""

# ---------- Verdict ----------
if [ "${exit_code:-0}" != "0" ]; then
  log "=== SMOKE TEST FAILED — investigar ${log_dir}/ ==="
  exit 1
fi

log "=== SMOKE TEST PASS — deploy validado ==="
log "Owner pode agora testar VS Code end-to-end (ver docs/guides/vscode-agentic-setup.pt-BR.md)"
