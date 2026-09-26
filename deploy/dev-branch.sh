#!/usr/bin/env bash
#
# dev-branch.sh — entorno de desarrollo aislado por rama.
#
# Levanta el frontend y el backend en puertos distintos de producción y
# ambos escuchando solo en loopback. main usa systemd; este script se niega a
# arrancar en main para que nadie lo confunda con el stack real.
#
#   deploy/dev-branch.sh up          # backend en background + frontend en primer plano
#   deploy/dev-branch.sh status      # estado y URLs
#   deploy/dev-branch.sh logs        # log del backend
#   deploy/dev-branch.sh down        # detener el backend de desarrollo
#   deploy/dev-branch.sh reset-db    # borrar la base de desarrollo y su rol
#
# Documentación: LOCAL_CHANGES_CONFIG.md en la raíz del repositorio.
#
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

# --- Puertos de desarrollo -------------------------------------------------
# Los de producción son 3002 (frontend, systemd) y 3001 (backend, systemd).
# Estos se pueden sobrescribir por entorno si 4000/5000 están ocupados:
#   RUN_IT_DEV_FRONTEND_PORT=4100 RUN_IT_DEV_BACKEND_PORT=5100 deploy/dev-branch.sh up
DEV_FRONTEND_PORT=${RUN_IT_DEV_FRONTEND_PORT:-4000}
DEV_BACKEND_PORT=${RUN_IT_DEV_BACKEND_PORT:-5000}
DEV_BIND=127.0.0.1

# --- Puertos de producción que NO se deben tocar ---------------------------
# Leídos de docker-compose.yml: Redis de prod 127.0.0.1:6380, Postgres 5433.
PROD_REDIS_PORT=6380
PROD_DB_NAME=run_it

# --- Recursos compartidos con producción -----------------------------------
# Judge0 es un servicio de ejecución sin estado para Run It (solo devuelve
# resultados por token), así que compartirlo es correcto. El único coste es
# que las submissions de desarrollo compiten por los slots del worker.
JUDGE0_URL=${RUN_IT_DEV_JUDGE0_URL:-http://127.0.0.1:2358}

# --- Estado ----------------------------------------------------------------
# En /tmp a propósito: así el script no escribe nada dentro del repositorio y
# no hace falta tocar .gitignore. Nota: si /tmp se limpia, la contraseña del rol
# de desarrollo se pierde y hay que ejecutar "dev-branch.sh reset-db".
STATE_DIR=${RUN_IT_DEV_STATE_DIR:-/tmp/run-it-dev}
BACKEND_PID_FILE="$STATE_DIR/backend.pid"
BACKEND_LOG="$STATE_DIR/backend.log"
DEV_ENV_FILE="$STATE_DIR/dev.env"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mAVISO:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# Lee KEY=valor de un archivo sin hacer source, para no interpretar comillas
# ni metacarácteres de una contraseña.
conf_value() {
  sed -nE "s/^[[:space:]]*$1=(.*)$/\1/p" "$2" | head -n1
}

require_file() { [ -f "$1" ] || die "No se encontró $1"; }

# ---------------------------------------------------------------------------
# Contexto de rama
# ---------------------------------------------------------------------------
current_branch() {
  git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || true
}

require_dev_branch() {
  local branch
  branch=$(current_branch)
  [ -n "$branch" ] || die "HEAD está desligado (detached). Haz 'git switch <rama>' antes de levantar el entorno de desarrollo."
  if [ "$branch" = "main" ]; then
    die "La rama activa es 'main'.
  main es el entorno de producción y lo sirve systemd, no este script:
    frontend  -> 127.0.0.1:3002
    backend   -> 127.0.0.1:3001
  Crea o cambia a una rama de desarrollo y vuelve a ejecutar este script."
  fi
  printf '%s' "$branch"
}

# ---------------------------------------------------------------------------
# Verificaciones
# ---------------------------------------------------------------------------
port_is_free() {
  ! ss -lntH "sport = :$1" 2>/dev/null | grep -q .
}

require_free_ports() {
  local port what
  for pair in "$DEV_FRONTEND_PORT:frontend" "$DEV_BACKEND_PORT:backend"; do
    port=${pair%%:*}
    what=${pair##*:}
    port_is_free "$port" || die "El puerto $port (dev $what) ya está ocupado.
  Comprueba con:  ss -lntp 'sport = :$port'
  Si es otro trabajo de desarrollo, define otro puerto:
    RUN_IT_DEV_FRONTEND_PORT=... RUN_IT_DEV_BACKEND_PORT=... $0 up"
  done
}

# Guardas de aislamiento. Sin esto, un despiste destructive en silencio.
assert_isolated() {
  local redis_port db_name
  redis_port=${REDIS_PORT:-}
  db_name=${DEV_DB_NAME:-$PROD_DB_NAME}

  if [ "$redis_port" = "$PROD_REDIS_PORT" ]; then
    die "REDIS_PORT=$PROD_REDIS_PORT es el Redis de PRODUCCIÓN.
  El backend de desarrollo arrancaría un worker de BullMQ sobre la cola
  compartida 'run-it-submissions' y robaría las submissions en vuelo de
  producción. Levanta el Redis de desarrollo:
    sudo docker compose -p runit-dev -f docker-compose.dev.yml up -d"
  fi

  if [ "$db_name" = "$PROD_DB_NAME" ]; then
    die "La base de desarrollo no puede llamarse '$PROD_DB_NAME' (esa es la de producción).
  Define otra con:  DEV_DB_NAME=run_it_dev $0 up"
  fi
}

# ---------------------------------------------------------------------------
# Entorno del backend de desarrollo
# ---------------------------------------------------------------------------
DEV_DB_NAME=${RUN_IT_DEV_DB_NAME:-run_it_dev}
DEV_DB_USER=${RUN_IT_DEV_DB_USER:-run_it_dev}
DEV_FRONTEND_ORIGIN="http://localhost:$DEV_FRONTEND_PORT"

# Contraseña estable del rol de desarrollo. Se genera una vez y se guarda en
# el state dir. Tiene que ser estable entre ejecuciones: db.js:28-31 solo crea
# el rol si no existe y nunca actualiza su contraseña, así que una contraseña
# nueva en cada arranque dejaría al segundo arranque sin poder autenticarse.
dev_db_password() {
  if [ -f "$DEV_ENV_FILE" ]; then
    conf_value RUN_IT_DEV_DB_PASSWORD "$DEV_ENV_FILE"
    return
  fi
  local generated
  generated=$(openssl rand -hex 16)
  printf 'RUN_IT_DEV_DB_PASSWORD=%s\n' "$generated" >"$DEV_ENV_FILE"
  chmod 600 "$DEV_ENV_FILE"
  printf '%s' "$generated"
}

# El backend crea su propia base y su propio rol al arrancar: db.js:13-45 usa
# DATABASE_ADMIN_URL para hacer el bootstrap del usuario y de la base, y
# db.js:66-70 aplica schema.sql. La contraseña de la admin sale de judge0.conf,
# que el usuario de servicio puede leer (modo 440, owner serverwewolf). Así no
# hay que escribir ningún secreto a mano ni pedir el de producción.
load_backend_env() {
  local conf="$REPO_ROOT/judge0.conf"
  require_file "$conf"
  local admin_user admin_pass admin_db
  admin_user=$(conf_value POSTGRES_USER "$conf")
  admin_pass=$(conf_value POSTGRES_PASSWORD "$conf")
  admin_db=$(conf_value POSTGRES_DB "$conf")
  [ -n "$admin_user" ] && [ -n "$admin_pass" ] || die "judge0.conf no tiene POSTGRES_USER/POSTGRES_PASSWORD"

  local db_pass
  db_pass=$(dev_db_password)

  export NODE_ENV=development
  export PORT="$DEV_BACKEND_PORT"
  export DATABASE_URL="postgres://$DEV_DB_USER:$db_pass@127.0.0.1:5433/$DEV_DB_NAME"
  export DATABASE_ADMIN_URL="postgres://$admin_user:$admin_pass@127.0.0.1:5433/postgres"
  export POSTGRES_USER="$DEV_DB_USER"
  export POSTGRES_PASSWORD="$db_pass"
  export POSTGRES_DB="$DEV_DB_NAME"
  export REDIS_HOST=127.0.0.1
  export REDIS_PORT=${RUN_IT_DEV_REDIS_PORT:-6381}
  export JUDGE0_URL
  # Solo el origen del frontend de desarrollo. Nunca añadir aquí los dominios
  # públicos: los leería el backend de producción si se compartiera el archivo.
  export ALLOWED_ORIGINS="$DEV_FRONTEND_ORIGIN,http://127.0.0.1:$DEV_FRONTEND_PORT"
  export SESSION_STORE=redis
  export SESSION_TTL_SECONDS=28800
  export ADMIN_USERNAME=devadmin
  export ADMIN_ACCESS_CODE=dev-codigo-no-usar-en-produccion
  export RUN_IT_SEED_DEMO=true
  # Bajo a propósito: las submissions de desarrollo compiten por los slots del
  # worker de Judge0 compartido con producción.
  export SUBMISSION_CONCURRENCY=1
}

# ---------------------------------------------------------------------------
# Subcomandos
# ---------------------------------------------------------------------------
backend_running() {
  [ -f "$BACKEND_PID_FILE" ] || return 1
  local pid
  pid=$(cat "$BACKEND_PID_FILE" 2>/dev/null) || return 1
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

stop_backend() {
  if backend_running; then
    local pid
    pid=$(cat "$BACKEND_PID_FILE")
    info "Deteniendo el backend de desarrollo (pid $pid)..."
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$BACKEND_PID_FILE"
}

wait_for_backend() {
  local url="http://$DEV_BIND:$DEV_BACKEND_PORT/health"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    if ! backend_running; then
      warn "El backend terminó durante el arranque. Últimas líneas:"
      tail -n 30 "$BACKEND_LOG" >&2 || true
      return 1
    fi
    sleep 0.5
  done
  warn "El backend no respondió /health a tiempo. Log:"
  tail -n 30 "$BACKEND_LOG" >&2 || true
  return 1
}

cmd_up() {
  local branch
  branch=$(require_dev_branch)
  assert_isolated
  require_free_ports

  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"

  info "Rama: $branch"
  info "Frontend  http://$DEV_BIND:$DEV_FRONTEND_PORT   (solo loopback)"
  info "Backend   http://$DEV_BIND:$DEV_BACKEND_PORT   (solo loopback)"
  info "Base      $DEV_DB_NAME          Redis  127.0.0.1:${RUN_IT_DEV_REDIS_PORT:-6381} (dev)"
  info "Judge0    $JUDGE0_URL   (compartido con producción)"

  if ! curl -fsS --max-time 3 "http://127.0.0.1:${RUN_IT_DEV_REDIS_PORT:-6381}" >/dev/null 2>&1; then
    if ! port_is_free "${RUN_IT_DEV_REDIS_PORT:-6381}"; then
      warn "Hay algo escuchando en ${RUN_IT_DEV_REDIS_PORT:-6381}; se asumirá que es el Redis de desarrollo."
    else
      die "El Redis de desarrollo no está levantado. Ejecuta esto una vez:
  sudo docker compose -p runit-dev -f docker-compose.dev.yml up -d"
    fi
  fi

  ( load_backend_env
    cd -- "$REPO_ROOT/run-it-backend"
    # node --watch y no "npm run dev": el script de package.json es
    # "node index.js" a secas y no recarga al cambiar el código.
    exec node --watch index.js
  ) >"$BACKEND_LOG" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" >"$BACKEND_PID_FILE"

  if ! wait_for_backend; then
    stop_backend
    exit 1
  fi
  info "Backend listo. Log: $BACKEND_LOG"

  info "Levantando el frontend (HMR). Ctrl-C para detener ambos."
  # Los flags CLI pisan el host y el puerto que @lovable.dev/vite-tanstack-config
  # fuerza a "::" y 8080 (dist/index.js:1245-1248). El --host 127.0.0.1 es lo
  # que evita que el dev server quede escuchando en la IP de Tailscale.
  # VITE_* se pasan por process.env, no por .env.local: en Vite, process.env
  # sobrescribe a los archivos .env (node.js:5697) y .env.local se carga
  # también en modo production (node.js:5661-5666), así que un archivo sí
  # podría contaminar el build de producción.
  trap stop_backend EXIT INT TERM
  (
    cd -- "$REPO_ROOT/frontend"
    VITE_API_URL="http://localhost:$DEV_BACKEND_PORT" \
      VITE_SOCKET_URL="http://localhost:$DEV_BACKEND_PORT" \
      exec npm run dev -- --port "$DEV_FRONTEND_PORT" --host "$DEV_BIND"
  )
}

cmd_down() {
  stop_backend
  info "Backend de desarrollo detenido."
  info "El Redis efímero sigue arriba (requiere sudo para pararlo):"
  info "  sudo docker compose -p runit-dev -f docker-compose.dev.yml down"
}

cmd_status() {
  local branch
  branch=$(current_branch)
  info "Rama: ${branch:-<detached HEAD>}"
  if port_is_free "$DEV_FRONTEND_PORT"; then
    warn "Frontend dev :$DEV_FRONTEND_PORT libre"
  else
    info "Frontend dev :$DEV_FRONTEND_PORT escuchando"
  fi
  if port_is_free "$DEV_BACKEND_PORT"; then
    warn "Backend dev  :$DEV_BACKEND_PORT libre"
  else
    info "Backend dev  :$DEV_BACKEND_PORT escuchando"
  fi
  if backend_running; then
    info "Proceso backend dev: pid $(cat "$BACKEND_PID_FILE")"
  else
    warn "Proceso backend dev: no corre"
  fi
}

cmd_logs() {
  [ -f "$BACKEND_LOG" ] || die "Todavía no hay log en $BACKEND_LOG"
  tail -n "${1:-50}" -f "$BACKEND_LOG"
}

# Dropea la base y el rol de desarrollo. Úsalo si /tmp se limpió y se perdió la
# contraseña del rol, o si quieres empezar de cero.
cmd_reset_db() {
  local conf="$REPO_ROOT/judge0.conf"
  require_file "$conf"
  local admin_user admin_pass db_pass
  admin_user=$(conf_value POSTGRES_USER "$conf")
  admin_pass=$(conf_value POSTGRES_PASSWORD "$conf")
  db_pass=$(conf_value RUN_IT_DEV_DB_PASSWORD "$DEV_ENV_FILE" 2>/dev/null || true)
  [ -n "$admin_user" ] && [ -n "$admin_pass" ] || die "judge0.conf no tiene POSTGRES_USER/POSTGRES_PASSWORD"

  command -v docker >/dev/null || die "docker no está instalado"
  docker info >/dev/null 2>&1 || die "Necesitas sudo para hablar con Docker:
  reejecuta con sudo, o hazlo a mano:
  sudo docker compose exec -T db psql -U $admin_user -d postgres -c 'DROP DATABASE IF EXISTS \"$DEV_DB_NAME\"'
  sudo docker compose exec -T db psql -U $admin_user -d postgres -c 'DROP ROLE IF EXISTS \"$DEV_DB_USER\"'"

  info "Dropeando base y rol de desarrollo ($DEV_DB_NAME, $DEV_DB_USER)..."
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$admin_user" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$DEV_DB_NAME\";" \
    -c "DROP ROLE IF EXISTS \"$DEV_DB_USER\";"
  rm -f "$DEV_ENV_FILE"
  info "Hecho. El próximo 'up' los recrea con una contraseña nueva."
}

case "${1:-up}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "${1:-50}" ;;
  reset-db) cmd_reset_db ;;
  -h | --help | help)
    awk 'NR > 1 { if ($0 ~ /^#/) { sub(/^#[[:space:]]?/, ""); print } else exit }' "$0"
    ;;
  *)
    die "Subcomando desconocido: $1 (usa up, down, status, logs o reset-db)"
    ;;
esac
