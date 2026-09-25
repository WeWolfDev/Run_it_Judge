#!/usr/bin/env bash
set -Eeuo pipefail

# Bootstrap de Run It para Ubuntu con systemd.
# Ejecutar como root desde el repositorio:
#   sudo bash deploy/bootstrap-ubuntu.sh
#
# Variables opcionales:
#   RUN_IT_USER=serverwewolf
#   RUN_IT_ORIGIN=https://runit.gelatina.lat
#   RUN_IT_REPLACE_NGINX=0|1
#   RUN_IT_ENABLE_UFW=0|1

if [[ ${EUID} -ne 0 ]]; then
  echo "Este script debe ejecutarse con sudo." >&2
  exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  echo "Se requiere flock (util-linux) para_serializing el bootstrap." >&2
  exit 1
fi
exec 9>/run/lock/run-it-bootstrap.lock
if ! flock -n 9; then
  echo "Ya hay otro bootstrap de Run It en ejecucion." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
APP_USER="${RUN_IT_USER:-${SUDO_USER:-}}"
APP_ORIGIN="${RUN_IT_ORIGIN:-https://runit.gelatina.lat}"
REPLACE_NGINX="${RUN_IT_REPLACE_NGINX:-0}"
LOG_FILE="/var/log/run-it-bootstrap.log"
BACKUP_DIR="/var/backups/run-it"
NGINX_SITE="/etc/nginx/sites-available/run-it"
NGINX_LINK="/etc/nginx/sites-enabled/run-it"
TRANSIENT_SECRET_FILE=""
BACKUP_PARTIAL=""
RESTORE_DATABASE=""
CERT_TMP_DIR=""
DB_CONTAINER=""
REDIS_CONTAINER=""
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-run-it-judge}"

if [[ -z "${APP_USER}" || "${APP_USER}" == "root" ]]; then
  echo "No se pudo determinar un usuario de servicio no root. Usa RUN_IT_USER=<usuario>." >&2
  exit 1
fi
if ! id "${APP_USER}" >/dev/null 2>&1; then
  echo "El usuario de servicio ${APP_USER} no existe." >&2
  exit 1
fi
if [[ "$(id -u "${APP_USER}")" != "1000" ]]; then
  echo "El host objetivo requiere que ${APP_USER} use UID 1000 para Judge0." >&2
  exit 1
fi
if [[ ! -f "${REPO_DIR}/docker-compose.yml" || ! -f "${REPO_DIR}/run-it-backend/package.json" || ! -f "${REPO_DIR}/frontend/package.json" ]]; then
  echo "El directorio ${REPO_DIR} no parece contener el repositorio de Run It." >&2
  exit 1
fi

mapfile -t ORIGIN_PARTS < <(python3 - "${APP_ORIGIN}" <<'PY'
import re
import sys
from urllib.parse import urlsplit

raw = sys.argv[1]
try:
    parsed = urlsplit(raw)
    port = parsed.port
except ValueError as exc:
    raise SystemExit(f"RUN_IT_ORIGIN no es valida: {exc}")

if parsed.scheme not in {"http", "https"}:
    raise SystemExit("RUN_IT_ORIGIN solo admite http:// o https://")
if parsed.username is not None or parsed.password is not None:
    raise SystemExit("RUN_IT_ORIGIN no admite usuario ni contrasena.")
if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
    raise SystemExit("RUN_IT_ORIGIN no admite ruta, query ni fragmento.")
if port is not None:
    raise SystemExit("RUN_IT_ORIGIN no admite un puerto no estandar.")

host = (parsed.hostname or "").lower()
pattern = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"
)
if not pattern.fullmatch(host):
    raise SystemExit("RUN_IT_ORIGIN debe contener un FQDN valido, no una IP.")

print(f"{parsed.scheme}://{host}")
print(host)
PY
)
if [[ "${#ORIGIN_PARTS[@]}" -ne 2 ]]; then
  echo "No se pudo normalizar RUN_IT_ORIGIN=${APP_ORIGIN}." >&2
  exit 1
fi
APP_ORIGIN="${ORIGIN_PARTS[0]}"
ORIGIN_HOST="${ORIGIN_PARTS[1]}"

if [[ -L "${NGINX_SITE}" || ( -e "${NGINX_SITE}" && ! -f "${NGINX_SITE}" ) ]]; then
  echo "${NGINX_SITE} existe y no es un archivo regular." >&2
  exit 1
fi
if [[ -e "${NGINX_SITE}" ]] && ! grep -q 'Managed by Run It bootstrap' "${NGINX_SITE}" && [[ "${REPLACE_NGINX}" != "1" ]]; then
  echo "Ya existe ${NGINX_SITE} y no fue creado por este bootstrap." >&2
  echo "Reviselo o vuelva a ejecutar con RUN_IT_REPLACE_NGINX=1." >&2
  exit 1
fi
if [[ -e "${NGINX_LINK}" && ! -L "${NGINX_LINK}" ]]; then
  echo "${NGINX_LINK} existe y no es un symlink administrable." >&2
  exit 1
fi
if [[ -L "${NGINX_LINK}" && "$(readlink -f "${NGINX_LINK}" 2>/dev/null || true)" != "${NGINX_SITE}" && "${REPLACE_NGINX}" != "1" ]]; then
  echo "${NGINX_LINK} apunta a una configuracion externa." >&2
  exit 1
fi
shopt -s nullglob
for enabled_site in /etc/nginx/sites-enabled/*; do
  if [[ "${enabled_site}" == "${NGINX_LINK}" ]]; then continue; fi
  if grep -Fq "${ORIGIN_HOST}" "${enabled_site}" 2>/dev/null; then
    echo "Conflicto: ${enabled_site} ya contiene ${ORIGIN_HOST}." >&2
    exit 1
  fi
done
shopt -u nullglob

APP_GROUP="$(id -gn "${APP_USER}")"
APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"

umask 077
[[ -d /var/log ]] || install -d -m 755 /var/log
[[ -d /var/backups ]] || install -d -m 755 /var/backups
install -d -m 700 "${BACKUP_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

random_hex() {
  openssl rand -hex "${1:-32}"
}

set_judge0_flag() {
  local key="$1"
  local file="$2"
  if grep -qE "^${key}=" "${file}"; then
    sed -i -E "s|^${key}=.*$|${key}=true|" "${file}"
  else
    if [[ -s "${file}" ]] && [[ "$(tail -c 1 "${file}" | wc -l)" -eq 0 ]]; then
      printf '\n' >> "${file}"
    fi
    printf '%s=true\n' "${key}" >> "${file}"
  fi
}

read_env_value() {
  local file="$1"
  local key="$2"
  local line
  line="$(grep -E "^${key}=" "${file}" | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

compose() {
  (
    cd "${REPO_DIR}"
    docker compose "$@"
  )
}

docker_exec() {
  timeout --kill-after=2s 5s docker exec "$@"
}

run_as_app() {
  runuser -u "${APP_USER}" -- env "HOME=${APP_HOME}" "$@"
}

on_error() {
  local exit_code=$?
  if [[ -n "${TRANSIENT_SECRET_FILE}" ]]; then rm -f -- "${TRANSIENT_SECRET_FILE}"; fi
  if [[ -n "${BACKUP_PARTIAL}" ]]; then rm -f -- "${BACKUP_PARTIAL}"; fi
  if [[ -n "${CERT_TMP_DIR}" ]]; then rm -rf -- "${CERT_TMP_DIR}"; fi
  if [[ -n "${RESTORE_DATABASE}" && -n "${DB_CONTAINER}" ]] && command -v docker >/dev/null 2>&1; then
    docker_exec "${DB_CONTAINER}" dropdb -U judge0 --if-exists --force "${RESTORE_DATABASE}" >/dev/null 2>&1 || true
  fi
  echo "El bootstrap falló en la linea ${BASH_LINENO[0]} (codigo ${exit_code})." >&2
  echo "Revise ${LOG_FILE}. Los secretos no se imprimen en este registro." >&2
  systemctl --no-pager --full status run-it-backend.service run-it-frontend.service 2>/dev/null || true
  if command -v docker >/dev/null 2>&1; then
    compose ps 2>/dev/null || true
  fi
  exit "${exit_code}"
}
trap on_error ERR

log() {
  printf '\n[%s] %s\n' "$(date -Is)" "$*"
}

wait_for_command() {
  local description="$1"
  local attempts="$2"
  shift 2
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if "$@" >/dev/null 2>&1; then
      log "Listo: ${description}"
      return 0
    fi
    sleep 2
  done
  echo "Tiempo agotado esperando: ${description}" >&2
  return 1
}

postgres_ready() {
  docker_exec "${DB_CONTAINER}" pg_isready -U "${JUDGE0_POSTGRES_USER}" -d "${JUDGE0_POSTGRES_DB}"
}

redis_ready() {
  docker_exec "${REDIS_CONTAINER}" sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'
}

backend_healthy() {
  curl -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:3001/health
}

backend_ready() {
  curl -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:3001/ready
}

frontend_ready() {
  curl -fsS --connect-timeout 2 --max-time 10 -o /dev/null http://127.0.0.1:3002/login
}

judge0_ready() {
  curl -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:2358/about
}

# 1. Paquetes base. Cockpit se instala despues de aplicar su override.
log "Instalando paquetes base del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  certbot \
  curl \
  docker-compose-v2 \
  docker.io \
  git \
  nginx \
  nodejs \
  npm \
  openssh-server \
  openssl \
  python3-certbot-nginx \
  ufw

log "Preparando Cockpit restringido a loopback antes de instalarlo"
systemctl stop cockpit.socket 2>/dev/null || true
install -d -m 755 /etc/systemd/system/cockpit.socket.d
cat > /etc/systemd/system/cockpit.socket.d/run-it-tunnel-only.conf <<'EOF'
# Managed by Run It bootstrap: Cockpit is reachable only through an SSH tunnel.
[Socket]
ListenStream=
ListenStream=127.0.0.1:9090
EOF
systemctl daemon-reload
apt-get install -y --no-install-recommends cockpit cockpit-storaged
# Ubuntu 26.04 retiró cockpit-docker del repositorio oficial. No es un
# requisito para administrar el host; si una distribución lo ofrece, se
# instala de forma opcional y nunca se sustituye por paquetes de terceros.
if apt-cache show cockpit-docker >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends cockpit-docker
else
  log "cockpit-docker no está disponible en este repositorio; se instala Cockpit core"
fi
[[ -d /var/www/html ]] || install -d -m 755 /var/www/html

log "Habilitando Docker, SSH, nginx y Cockpit"
systemctl enable --now docker.service
systemctl enable --now ssh.service
systemctl enable --now nginx.service
systemctl enable --now cockpit.socket
systemctl restart cockpit.socket

if [[ "${RUN_IT_ENABLE_UFW:-0}" == "1" ]]; then
  log "Agregando reglas UFW para SSH, HTTP y HTTPS"
  ssh_port="$(/usr/sbin/sshd -T | awk '$1 == "port" { print $2; exit }')"
  ssh_port="${ssh_port:-22}"
  ufw allow "${ssh_port}/tcp"
  ufw allow 80/tcp
  ufw allow 443/tcp
  log "Reglas agregadas sin cambiar la politica UFW existente (SSH ${ssh_port}/tcp)."
fi

if [[ ! -f "${REPO_DIR}/judge0.conf" ]]; then
  log "Generando secretos de Judge0, PostgreSQL y Redis"
  cat > "${REPO_DIR}/judge0.conf" <<EOF
REDIS_HOST=redis
REDIS_PASSWORD=$(random_hex 32)
POSTGRES_HOST=db
POSTGRES_DB=judge0
POSTGRES_USER=judge0
POSTGRES_PASSWORD=$(random_hex 32)
COUNT=8
MAX_QUEUE_SIZE=100
EOF
else
  log "Conservando el judge0.conf existente"
fi

if [[ "$(stat -fc %T /sys/fs/cgroup)" == "cgroup2fs" ]]; then
  log "Configurando limites Judge0 para cgroup v2"
  set_judge0_flag ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT "${REPO_DIR}/judge0.conf"
  set_judge0_flag ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT "${REPO_DIR}/judge0.conf"
fi

JUDGE0_POSTGRES_USER="$(read_env_value "${REPO_DIR}/judge0.conf" POSTGRES_USER)"
JUDGE0_POSTGRES_DB="$(read_env_value "${REPO_DIR}/judge0.conf" POSTGRES_DB)"
JUDGE0_REDIS_PASSWORD="$(read_env_value "${REPO_DIR}/judge0.conf" REDIS_PASSWORD)"
JUDGE0_POSTGRES_PASSWORD="$(read_env_value "${REPO_DIR}/judge0.conf" POSTGRES_PASSWORD)"
if [[ "${JUDGE0_POSTGRES_USER}" != "judge0" || "${JUDGE0_POSTGRES_DB}" != "judge0" ]]; then
  echo "judge0.conf debe usar POSTGRES_USER=judge0 y POSTGRES_DB=judge0." >&2
  exit 1
fi
if [[ ! "${JUDGE0_REDIS_PASSWORD}" =~ ^[A-Za-z0-9._~-]{32,}$ || "${JUDGE0_REDIS_PASSWORD}" == change-this-* ]]; then
  echo "REDIS_PASSWORD de Judge0 es debil, tiene formato inseguro o es un ejemplo." >&2
  exit 1
fi
if [[ ! "${JUDGE0_POSTGRES_PASSWORD}" =~ ^[A-Za-z0-9._~-]{32,}$ || "${JUDGE0_POSTGRES_PASSWORD}" == change-this-* ]]; then
  echo "POSTGRES_PASSWORD de Judge0 es debil, tiene formato inseguro o es un ejemplo." >&2
  exit 1
fi
# El usuario UID 1000 y GID 999 son los ids documentados del proceso Judge0.
chown 1000:999 "${REPO_DIR}/judge0.conf"
chmod 440 "${REPO_DIR}/judge0.conf"

if [[ ! -f "${REPO_DIR}/run-it-backend/secrets" ]]; then
  log "Generando secretos de Run It"
  RUN_IT_DB_PASSWORD="$(random_hex 32)"
  cat > "${REPO_DIR}/run-it-backend/secrets" <<EOF
NODE_ENV=production
PORT=3001
DATABASE_URL=postgres://run_it:${RUN_IT_DB_PASSWORD}@127.0.0.1:5433/run_it
REDIS_HOST=127.0.0.1
REDIS_PORT=6380
REDIS_PASSWORD=${JUDGE0_REDIS_PASSWORD}
JUDGE0_URL=http://127.0.0.1:2358
ALLOWED_ORIGINS=${APP_ORIGIN}
SESSION_STORE=redis
SESSION_TTL_SECONDS=28800
ADMIN_USERNAME=admin
ADMIN_ACCESS_CODE=RUNIT-$(random_hex 12)
RUN_IT_SEED_DEMO=false
SUBMISSION_CONCURRENCY=4
EOF
else
  log "Conservando run-it-backend/secrets existente"
  DATABASE_URL_VALUE="$(read_env_value "${REPO_DIR}/run-it-backend/secrets" DATABASE_URL)"
  case "${DATABASE_URL_VALUE}" in
    postgres://run_it:*@127.0.0.1:5433/run_it)
      RUN_IT_DB_PASSWORD="${DATABASE_URL_VALUE#postgres://run_it:}"
      RUN_IT_DB_PASSWORD="${RUN_IT_DB_PASSWORD%@127.0.0.1:5433/run_it}"
      ;;
    *)
      echo "El DATABASE_URL existente no usa el formato local esperado de run_it." >&2
      exit 1
      ;;
  esac
fi
# PID 1 lee EnvironmentFile antes de drop privileges; el servicio no necesita
# ser propietario del archivo que contiene todos sus secretos.
chown root:root "${REPO_DIR}/run-it-backend/secrets"
chmod 600 "${REPO_DIR}/run-it-backend/secrets"

CONFIGURED_REDIS_PASSWORD="$(read_env_value "${REPO_DIR}/run-it-backend/secrets" REDIS_PASSWORD)"
CONFIGURED_ORIGIN="$(read_env_value "${REPO_DIR}/run-it-backend/secrets" ALLOWED_ORIGINS)"
CONFIGURED_ADMIN="$(read_env_value "${REPO_DIR}/run-it-backend/secrets" ADMIN_ACCESS_CODE)"
CONFIGURED_SEED="$(read_env_value "${REPO_DIR}/run-it-backend/secrets" RUN_IT_SEED_DEMO)"
CONFIGURED_SESSION_STORE="$(read_env_value "${REPO_DIR}/run-it-backend/secrets" SESSION_STORE)"
CONFIGURED_JUDGE0_URL="$(read_env_value "${REPO_DIR}/run-it-backend/secrets" JUDGE0_URL)"
if [[ ! "${RUN_IT_DB_PASSWORD}" =~ ^[A-Za-z0-9._~-]{16,}$ ]]; then
  echo "La contrasena de run_it debe ser URL-safe y tener al menos 16 caracteres." >&2
  exit 1
fi
if [[ "${CONFIGURED_REDIS_PASSWORD}" != "${JUDGE0_REDIS_PASSWORD}" ]]; then
  echo "REDIS_PASSWORD del backend no coincide con judge0.conf." >&2
  exit 1
fi
if [[ "${CONFIGURED_ORIGIN}" != "${APP_ORIGIN}" || "${CONFIGURED_SEED}" != "false" ]]; then
  echo "ALLOWED_ORIGIN o RUN_IT_SEED_DEMO no son seguros para este despliegue." >&2
  exit 1
fi
if [[ "${CONFIGURED_SESSION_STORE}" != "redis" || "${CONFIGURED_JUDGE0_URL}" != "http://127.0.0.1:2358" ]]; then
  echo "SESSION_STORE o JUDGE0_URL no coinciden con el despliegue loopback esperado." >&2
  exit 1
fi
if [[ ${#CONFIGURED_ADMIN} -lt 16 || "${CONFIGURED_ADMIN}" == change-this-* ]]; then
  echo "ADMIN_ACCESS_CODE es debil o sigue siendo un valor de ejemplo." >&2
  exit 1
fi

log "Validando e iniciando PostgreSQL y Redis"
compose config -q
compose up -d db redis
DB_CONTAINER="$(compose ps -q db)"
REDIS_CONTAINER="$(compose ps -q redis)"
if [[ -z "${DB_CONTAINER}" || -z "${REDIS_CONTAINER}" ]]; then
  echo "No se pudieron identificar los contenedores db/redis." >&2
  exit 1
fi
wait_for_command "PostgreSQL" 60 postgres_ready
wait_for_command "Redis" 60 redis_ready
wait_for_command "autenticacion TCP de PostgreSQL" 10 \
  docker_exec "${DB_CONTAINER}" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1"'

log "Creando la base y el usuario run_it"
TRANSIENT_SECRET_FILE="$(mktemp /var/tmp/run-it-role.XXXXXX)"
chmod 600 "${TRANSIENT_SECRET_FILE}"
printf "\\set run_it_password '%s'\n" "${RUN_IT_DB_PASSWORD}" > "${TRANSIENT_SECRET_FILE}"
cat >> "${TRANSIENT_SECRET_FILE}" <<'SQL'
SELECT format('CREATE ROLE run_it LOGIN PASSWORD %L', :'run_it_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'run_it') \gexec
SELECT format('ALTER ROLE run_it PASSWORD %L', :'run_it_password') \gexec
SQL
docker_exec -i "${DB_CONTAINER}" psql -v ON_ERROR_STOP=1 -U "${JUDGE0_POSTGRES_USER}" -d postgres \
  < "${TRANSIENT_SECRET_FILE}"
rm -f -- "${TRANSIENT_SECRET_FILE}"
TRANSIENT_SECRET_FILE=""

if ! docker_exec "${DB_CONTAINER}" psql -U "${JUDGE0_POSTGRES_USER}" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = 'run_it'" | grep -q 1; then
  docker_exec "${DB_CONTAINER}" createdb -U "${JUDGE0_POSTGRES_USER}" -O run_it run_it
fi
docker_exec "${DB_CONTAINER}" psql -v ON_ERROR_STOP=1 -U "${JUDGE0_POSTGRES_USER}" -d postgres \
  -c 'ALTER DATABASE run_it OWNER TO run_it;'

log "Arrancando Judge0 API y worker"
compose up -d
server_container="$(compose ps -q server)"
worker_container="$(compose ps -q worker)"
if [[ -z "${server_container}" || -z "${worker_container}" ]]; then
  echo "No se pudieron crear los contenedores server/worker de Judge0." >&2
  exit 1
fi
wait_for_command "Judge0 API" 120 judge0_ready
if [[ "$(docker inspect --format '{{.State.Status}}' "${worker_container}")" != "running" ]]; then
  echo "El worker de Judge0 no esta ejecutandose." >&2
  compose logs --tail=100 worker >&2
  exit 1
fi

NODE_VERSION="$(node --version)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
NODE_MINOR="$(printf '%s' "${NODE_VERSION#v}" | cut -d. -f2)"
if (( NODE_MAJOR < 22 || (NODE_MAJOR == 22 && NODE_MINOR < 12) )); then
  echo "Se requiere Node.js >=22.12.0; Ubuntu instalo ${NODE_VERSION}." >&2
  exit 1
fi

log "Instalando y probando dependencias del backend"
(
  cd "${REPO_DIR}/run-it-backend"
  run_as_app npm ci --omit=dev
  run_as_app npm test
  run_as_app env JUDGE0_URL=http://127.0.0.1:2358 timeout 90s npm run judge0
)

log "Instalando, verificando y compilando el frontend"
(
  cd "${REPO_DIR}/frontend"
  run_as_app npm ci
  run_as_app npm run typecheck
  run_as_app env VITE_API_URL='' VITE_SOCKET_URL='/' npm run build
)
if [[ ! -f "${REPO_DIR}/frontend/.output/server/index.mjs" ]]; then
  echo "El build no genero frontend/.output/server/index.mjs" >&2
  exit 1
fi

log "Instalando servicios systemd de Run It"
unit_backup="${BACKUP_DIR}/systemd-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "${unit_backup}"
for service in backend frontend; do
  template="${SCRIPT_DIR}/systemd/run-it-${service}.service"
  destination="/etc/systemd/system/run-it-${service}.service"
  candidate_dir="$(mktemp -d /tmp/opencode-systemd.XXXXXX)"
  candidate="${candidate_dir}/run-it-${service}.service"
  sed \
    -e "s|@@APP_DIR@@|${REPO_DIR}|g" \
    -e "s|@@APP_USER@@|${APP_USER}|g" \
    -e "s|@@APP_GROUP@@|${APP_GROUP}|g" \
    "${template}" > "${candidate}"
  chmod 644 "${candidate}"
  if ! systemd-analyze verify "${candidate}"; then
    rm -rf -- "${candidate_dir}"
    echo "systemd-analyze verify fallo para ${destination}." >&2
    exit 1
  fi
  if [[ -e "${destination}" || -L "${destination}" ]]; then
    cp -a -- "${destination}" "${unit_backup}/"
  fi
  mv -f -- "${candidate}" "${destination}"
  rm -rf -- "${candidate_dir}"
done
systemctl daemon-reload
systemctl enable run-it-backend.service run-it-frontend.service
systemctl restart run-it-backend.service run-it-frontend.service
wait_for_command "backend /health" 60 backend_healthy
wait_for_command "backend /ready" 60 backend_ready
wait_for_command "frontend /login" 60 frontend_ready

log "Creando el backup inicial de run_it"
initial_backup="${BACKUP_DIR}/run_it-initial-$(date -u +%Y%m%dT%H%M%SZ).dump"
BACKUP_PARTIAL="$(mktemp "${BACKUP_DIR}/.run_it-initial.XXXXXX.partial")"
docker_exec "${DB_CONTAINER}" pg_dump -U "${JUDGE0_POSTGRES_USER}" -d run_it --format=custom > "${BACKUP_PARTIAL}"
[[ -s "${BACKUP_PARTIAL}" ]]
sync -f "${BACKUP_PARTIAL}"
mv -f -- "${BACKUP_PARTIAL}" "${initial_backup}"
BACKUP_PARTIAL=""
chmod 600 "${initial_backup}"
checksum_partial="${initial_backup}.sha256.partial"
sha256sum "${initial_backup}" > "${checksum_partial}"
mv -f -- "${checksum_partial}" "${initial_backup}.sha256"
chmod 600 "${initial_backup}.sha256"

log "Probando la restauracion del backup en una base temporal"
RESTORE_DATABASE="run_it_restore_check_$(date -u +%Y%m%d%H%M%S)_$$"
docker_exec "${DB_CONTAINER}" createdb -U "${JUDGE0_POSTGRES_USER}" -O run_it "${RESTORE_DATABASE}"
docker_exec -i "${DB_CONTAINER}" pg_restore \
  -U "${JUDGE0_POSTGRES_USER}" \
  --role=run_it \
  --no-owner \
  --exit-on-error \
  -d "${RESTORE_DATABASE}" < "${initial_backup}"
restore_table_count="$(docker_exec "${DB_CONTAINER}" psql -U run_it -d "${RESTORE_DATABASE}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [[ "${restore_table_count//[[:space:]]/}" -lt 1 ]]; then
  echo "La restauracion no contiene tablas publicas." >&2
  exit 1
fi
docker_exec "${DB_CONTAINER}" dropdb -U "${JUDGE0_POSTGRES_USER}" --if-exists "${RESTORE_DATABASE}"
RESTORE_DATABASE=""

log "Validando certificado e instalando nginx"
TLS_AVAILABLE=0
certificate="/etc/letsencrypt/live/${ORIGIN_HOST}/fullchain.pem"
certificate_key="/etc/letsencrypt/live/${ORIGIN_HOST}/privkey.pem"
if [[ -f "${certificate}" && -f "${certificate_key}" ]]; then
  openssl x509 -checkend 604800 -noout -in "${certificate}" >/dev/null
  CERT_TMP_DIR="$(mktemp -d /tmp/run-it-cert.XXXXXX)"
  openssl x509 -in "${certificate}" -out "${CERT_TMP_DIR}/leaf.pem"
  awk 'BEGIN { first = 1 } first && /END CERTIFICATE/ { first = 0; next } !first { print }' \
    "${certificate}" > "${CERT_TMP_DIR}/chain.pem"
  if [[ -s "${CERT_TMP_DIR}/chain.pem" ]]; then
    openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt \
      -untrusted "${CERT_TMP_DIR}/chain.pem" \
      -verify_hostname "${ORIGIN_HOST}" "${CERT_TMP_DIR}/leaf.pem" >/dev/null
  else
    openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt \
      -verify_hostname "${ORIGIN_HOST}" "${CERT_TMP_DIR}/leaf.pem" >/dev/null
  fi
  certificate_pubkey="$(openssl x509 -in "${certificate}" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)"
  private_pubkey="$(openssl pkey -in "${certificate_key}" -pubout -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)"
  [[ "${certificate_pubkey}" == "${private_pubkey}" ]]
  cp "${SCRIPT_DIR}/nginx/runit-https.conf" "${NGINX_SITE}.candidate.$$"
  TLS_AVAILABLE=1
else
  # HTTP solo responde el desafio ACME; nunca sirve API, login o cookies.
  cp "${SCRIPT_DIR}/nginx/runit-http.conf" "${NGINX_SITE}.candidate.$$"
fi
sed -i "s/@@ORIGIN_HOST@@/${ORIGIN_HOST}/g" "${NGINX_SITE}.candidate.$$"
chmod 644 "${NGINX_SITE}.candidate.$$"

nginx_backup="${BACKUP_DIR}/nginx-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "${nginx_backup}"
site_existed=0
link_existed=0
link_was_symlink=0
if [[ -f "${NGINX_SITE}" ]]; then
  cp -a -- "${NGINX_SITE}" "${nginx_backup}/site"
  site_existed=1
fi
if [[ -L "${NGINX_LINK}" ]]; then
  readlink "${NGINX_LINK}" > "${nginx_backup}/link-target"
  link_existed=1
  link_was_symlink=1
elif [[ -f "${NGINX_LINK}" ]]; then
  cp -a -- "${NGINX_LINK}" "${nginx_backup}/enabled-link"
  link_existed=1
fi

restore_nginx() {
  if (( site_existed )); then
    cp -a -- "${nginx_backup}/site" "${NGINX_SITE}"
  else
    rm -f -- "${NGINX_SITE}"
  fi
  rm -f -- "${NGINX_LINK}"
  if (( link_was_symlink )); then
    ln -s "$(cat "${nginx_backup}/link-target")" "${NGINX_LINK}"
  elif (( link_existed )); then
    cp -a -- "${nginx_backup}/enabled-link" "${NGINX_LINK}"
  fi
}
mv -f -- "${NGINX_SITE}.candidate.$$" "${NGINX_SITE}"
ln -s "${NGINX_SITE}" "${NGINX_LINK}.new.$$"
mv -Tf -- "${NGINX_LINK}.new.$$" "${NGINX_LINK}"
if ! nginx -t; then
  restore_nginx
  rm -f -- "${NGINX_SITE}.candidate.$$" "${NGINX_LINK}.new.$$"
  echo "nginx -t fallo; se restauró la configuracion anterior." >&2
  exit 1
fi
if ! systemctl reload nginx.service; then
  restore_nginx
  nginx -t
  systemctl reload nginx.service
  echo "No se pudo recargar nginx; se restauró la configuracion anterior." >&2
  exit 1
fi
rm -f -- "${NGINX_SITE}.candidate.$$" "${NGINX_LINK}.new.$$"

if (( TLS_AVAILABLE )); then
  wait_for_command "nginx HTTPS -> backend" 30 \
    curl --noproxy '*' -fsS --connect-timeout 2 --max-time 10 --resolve "${ORIGIN_HOST}:443:127.0.0.1" \
    "https://${ORIGIN_HOST}/health"
else
  http_status="$(curl -sS --connect-timeout 2 --max-time 5 -o /dev/null -w '%{http_code}' \
    -H "Host: ${ORIGIN_HOST}" http://127.0.0.1/)"
  [[ "${http_status}" == "503" ]]
fi
if [[ -n "${CERT_TMP_DIR}" ]]; then
  rm -rf -- "${CERT_TMP_DIR}"
  CERT_TMP_DIR=""
fi

log "Comprobando que Cockpit escucha solo en loopback"
wait_for_command "Cockpit loopback" 30 \
  curl -kfsS --connect-timeout 2 --max-time 5 -o /dev/null https://127.0.0.1:9090/
cockpit_listeners="$(ss -H -lnt 'sport = :9090' | awk '{print $4}')"
[[ -n "${cockpit_listeners}" ]]
if grep -Ev '^127\.0\.0\.1:9090$' <<<"${cockpit_listeners}"; then
  echo "Cockpit tiene un listener distinto de 127.0.0.1:9090." >&2
  exit 1
fi

log "Ejecutando smoke test local"
RUN_IT_ORIGIN_HOST="${ORIGIN_HOST}" RUN_IT_TLS_AVAILABLE="${TLS_AVAILABLE}" \
  "${SCRIPT_DIR}/smoke-test.sh"

log "Ejecutando prueba E2E completa"
# El E2E lee el EnvironmentFile root-only y limpia sus propias filas.
"${SCRIPT_DIR}/e2e-test.cjs"

cat <<EOF

Bootstrap completado.

- Aplicacion local: http://127.0.0.1:3002
- API local: http://127.0.0.1:3001/health
- Judge0 local: http://127.0.0.1:2358/about
- Cockpit local: https://127.0.0.1:9090/
- HTTPS nginx: $([[ ${TLS_AVAILABLE} -eq 1 ]] && printf 'activo' || printf 'pendiente')
- Commit: $(git -C "${REPO_DIR}" rev-parse --short HEAD)
- Backup inicial: ${initial_backup}
- Restauracion inicial: verificada
- Prueba E2E: correcta
- Log: ${LOG_FILE}

El dominio actual NO fue cambiado. Para publicar este host sin servir la
aplicacion en HTTP plano:

  1. Cambiar el origen DNS/Cloudflare a este servidor.
  2. sudo certbot certonly --webroot -w /var/www/html -d ${ORIGIN_HOST}
  3. sudo bash ${SCRIPT_DIR}/bootstrap-ubuntu.sh

nginx sirve 503 en HTTP hasta que exista un TLS valido; la API nunca se expone
sin HTTPS despues del cutover.

Para Cockpit remoto use un tunel SSH desde su computadora:

  ssh -N -L 9090:127.0.0.1:9090 ${APP_USER}@<IP-O-DIRECCION-DEL-SERVIDOR>

Luego abra https://localhost:9090 y autenticase con un usuario Linux local.
No publique directamente el puerto 9090.

Para consultar el codigo admin inicial sin incluirlo en el historial del
bootstrap, ejecute manualmente:

  sudo sed -n 's/^ADMIN_ACCESS_CODE=//p' ${REPO_DIR}/run-it-backend/secrets
EOF
