#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
[ -f "$ENV_FILE" ] || { echo "❌ .env não encontrado em $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${RUNPOD_API_KEY:?RUNPOD_API_KEY vazio em $ENV_FILE}"
: "${RUNPOD_POD_ID:?RUNPOD_POD_ID vazio em $ENV_FILE}"
: "${RUNPOD_SSH_HOST:?RUNPOD_SSH_HOST vazio em $ENV_FILE}"
: "${RUNPOD_SSH_PORT:?RUNPOD_SSH_PORT vazio em $ENV_FILE}"
: "${RUNPOD_SSH_USER:?RUNPOD_SSH_USER vazio em $ENV_FILE}"
: "${RUNPOD_SSH_KEY:?RUNPOD_SSH_KEY vazio em $ENV_FILE}"

API="https://rest.runpod.io/v1"
AUTH=(-H "Authorization: Bearer $RUNPOD_API_KEY")
KEY="${RUNPOD_SSH_KEY/#\~/$HOME}"

# Sempre pega a porta SSH atual da API (RunPod re-mapeia 22 a cada restart)
refresh_ssh_port() {
  local p
  p=$(curl -sS "${AUTH[@]}" "$API/pods/$RUNPOD_POD_ID" | jq -r '.portMappings."22" // empty')
  if [ -n "$p" ] && [ "$p" != "null" ]; then
    RUNPOD_SSH_PORT="$p"
    # Persiste no .env pra manter coerência local
    if grep -q '^RUNPOD_SSH_PORT=' "$ENV_FILE"; then
      sed -i "s/^RUNPOD_SSH_PORT=.*/RUNPOD_SSH_PORT=$p/" "$ENV_FILE"
    fi
  fi
}

cmd=${1:-help}
shift || true

do_ssh() {
  ssh -o StrictHostKeyChecking=accept-new -i "$KEY" \
      -p "$RUNPOD_SSH_PORT" "$RUNPOD_SSH_USER@$RUNPOD_SSH_HOST" "$@"
}

case "$cmd" in
  status)
    curl -sS "${AUTH[@]}" "$API/pods/$RUNPOD_POD_ID" \
      | jq "{id, name, desiredStatus, costPerHr, publicIp, portMappings}"
    ;;

  start)
    curl -sS -X POST "${AUTH[@]}" "$API/pods/$RUNPOD_POD_ID/start" | jq .
    ;;

  stop|down)
    curl -sS -X POST "${AUTH[@]}" "$API/pods/$RUNPOD_POD_ID/stop" | jq .
    ;;

  ssh)
    exec ssh -o StrictHostKeyChecking=accept-new -i "$KEY" \
             -p "$RUNPOD_SSH_PORT" "$RUNPOD_SSH_USER@$RUNPOD_SSH_HOST" "$@"
    ;;

  up)
    echo "▶  Solicitando start..."
    curl -sS -X POST "${AUTH[@]}" "$API/pods/$RUNPOD_POD_ID/start" >/dev/null || true
    sleep 8
    refresh_ssh_port
    echo "🔌 Porta SSH atual: $RUNPOD_SSH_PORT"
    echo "⏳ Aguardando SSH ficar disponível..."
    ok=0
    for i in $(seq 1 60); do
      if ssh -o BatchMode=yes -o ConnectTimeout=5 \
             -o StrictHostKeyChecking=accept-new \
             -i "$KEY" -p "$RUNPOD_SSH_PORT" \
             "$RUNPOD_SSH_USER@$RUNPOD_SSH_HOST" true 2>/dev/null; then
        echo "✅ SSH ok (tentativa $i)"
        ok=1
        break
      fi
      sleep 5
    done
    [ "$ok" = "1" ] || { echo "❌ SSH não ficou disponível em 5 min"; exit 1; }
    echo "🚀 Executando /workspace/start.sh..."
    do_ssh 'bash /workspace/start.sh' 2>&1 | tail -25
    ;;

  logs)
    do_ssh 'journalctl -n 100 --no-pager 2>/dev/null || tail -n 100 /var/log/syslog 2>/dev/null || echo "(sem logs padrão)"'
    ;;

  help|--help|-h|*)
    cat <<EOF
Uso: $(basename "$0") <comando> [args]

Controle do Pod RunPod ($RUNPOD_POD_ID):
  status         Mostra status atual (RUNNING/EXITED/etc)
  start          Liga o Pod (API only, não sobe Ollama)
  stop | down    Para o Pod (para cobrança de GPU)
  up             Liga + espera SSH + roda /workspace/start.sh (Ollama)
  ssh [cmd]      SSH interativo ou executa comando remoto
                   Ex: $(basename "$0") ssh 'nvidia-smi'
  logs           Últimas 100 linhas de log do sistema

Exemplos:
  $(basename "$0") status
  $(basename "$0") up
  $(basename "$0") ssh 'ollama list'
  $(basename "$0") stop
EOF
    ;;
esac
