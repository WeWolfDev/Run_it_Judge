#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=${APP_DIR:-/home/serverwewolf/ServerRunIt/Run_it_Judge}
TARGET=${RUN_IT_TUNNEL_TARGET:-http://127.0.0.1:8080}

command -v tailscale >/dev/null || {
  echo 'Tailscale no está instalado.' >&2
  exit 1
}

curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3001/health >/dev/null
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3002/login >/dev/null
curl --fail --silent --show-error --max-time 5 "$TARGET/login" >/dev/null

echo "Habilitando Funnel hacia ${TARGET}..."
tailscale funnel --bg --yes "$TARGET"

echo
echo "Configuración actual:"
tailscale funnel status || true
