#!/usr/bin/env bash
set -euo pipefail

ORIGIN_HOST="${RUN_IT_ORIGIN_HOST:-runit.gelatina.lat}"
TLS_AVAILABLE="${RUN_IT_TLS_AVAILABLE:-0}"
REMOTE_URL="${RUN_IT_REMOTE_URL:-}"

check() {
  local description="$1"
  shift
  printf '%-46s' "${description}"
  if "$@" >/dev/null 2>&1; then
    echo 'OK'
  else
    echo 'FALLO'
    return 1
  fi
}

check_status() {
  local description="$1"
  local expected="$2"
  shift 2
  printf '%-46s' "${description}"
  local actual
  actual="$(curl -sS --connect-timeout 3 --max-time 20 -o /dev/null -w '%{http_code}' "$@")"
  if [[ "${actual}" == "${expected}" ]]; then
    echo "OK (${actual})"
  else
    echo "FALLO (${actual}, esperado ${expected})"
    return 1
  fi
}

check 'Judge0 /about' \
  curl -fsS --connect-timeout 2 --max-time 10 http://127.0.0.1:2358/about
check 'Backend /health' \
  curl -fsS --connect-timeout 2 --max-time 10 http://127.0.0.1:3001/health
check 'Backend /ready' \
  curl -fsS --connect-timeout 2 --max-time 10 http://127.0.0.1:3001/ready
check 'Frontend /login' \
  curl -fsS --connect-timeout 2 --max-time 20 -o /dev/null http://127.0.0.1:3002/login

if [[ "${TLS_AVAILABLE}" == "1" ]]; then
  check 'Nginx HTTPS /health' \
    curl --noproxy '*' -fsS --connect-timeout 2 --max-time 10 --resolve "${ORIGIN_HOST}:443:127.0.0.1" \
    "https://${ORIGIN_HOST}/health"
  check_status 'Nginx HTTPS /ready' 200 \
    --noproxy '*' --resolve "${ORIGIN_HOST}:443:127.0.0.1" "https://${ORIGIN_HOST}/ready"
  check_status 'Nginx HTTPS /login' 200 \
    --noproxy '*' --resolve "${ORIGIN_HOST}:443:127.0.0.1" "https://${ORIGIN_HOST}/login"
else
  check_status 'Nginx HTTP sin API (503)' 503 -H "Host: ${ORIGIN_HOST}" http://127.0.0.1/
fi

check 'Cockpit loopback' \
  curl -kfsS --connect-timeout 2 --max-time 10 -o /dev/null https://127.0.0.1:9090/
printf '%-46s' 'Cockpit limitado a 127.0.0.1:9090'
cockpit_listeners="$(ss -H -lnt 'sport = :9090' | awk '{print $4}')"
if [[ -n "${cockpit_listeners}" ]] && ! grep -Ev '^127\.0\.0\.1:9090$' <<<"${cockpit_listeners}"; then
  echo 'OK'
else
  echo 'FALLO'
  ss -lntp | grep ':9090' >&2 || true
  exit 1
fi

if [[ -n "${REMOTE_URL}" ]]; then
  if [[ "${REMOTE_URL}" != https://* ]]; then
    echo 'RUN_IT_REMOTE_URL debe usar https://' >&2
    exit 1
  fi
  check_status 'Remoto HTTPS /health' 200 "${REMOTE_URL%/}/health"
  check_status 'Remoto HTTPS /ready' 200 "${REMOTE_URL%/}/ready"
  check_status 'Remoto HTTPS /login' 200 "${REMOTE_URL%/}/login"
fi

echo 'Smoke test local completado.'
