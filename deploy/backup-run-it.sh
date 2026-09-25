#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo "Este script debe ejecutarse como root." >&2
  exit 1
fi

backup_dir=${RUN_IT_BACKUP_DIR:-/var/backups/run-it}
retention_days=${RUN_IT_BACKUP_RETENTION_DAYS:-14}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_name="run_it-${timestamp}-$$.dump"
backup_path="${backup_dir}/${backup_name}"
partial_path="${backup_path}.partial"
checksum_path="${backup_path}.sha256"

install -d -m 700 "$backup_dir"
trap 'rm -f "$partial_path"' EXIT

mapfile -t postgres_containers < <(
  docker ps --filter status=running --format '{{.Names}} {{.Image}}' \
    | awk '$2 ~ /^postgres:/ {print $1}'
)

db_container=""
for candidate in "${postgres_containers[@]}"; do
  if docker exec "$candidate" sh -c \
    'psql -U "$POSTGRES_USER" -d run_it -Atqc "SELECT 1"' 2>/dev/null | grep -qx '1'; then
    db_container="$candidate"
    break
  fi
done

if [[ -z "$db_container" ]]; then
  echo "No se encontró un contenedor PostgreSQL con la base run_it." >&2
  exit 1
fi

docker exec "$db_container" sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d run_it --format=custom --no-owner --no-privileges' \
  > "$partial_path"

if [[ ! -s "$partial_path" ]]; then
  echo "El respaldo de run_it quedó vacío." >&2
  exit 1
fi

docker exec -i "$db_container" pg_restore --list < "$partial_path" >/dev/null
mv "$partial_path" "$backup_path"
(
  cd "$backup_dir"
  sha256sum "$backup_name" > "${backup_name}.sha256"
)
chmod 600 "$backup_path" "$checksum_path"

find "$backup_dir" -maxdepth 1 -type f \
  \( -name 'run_it-*.dump' -o -name 'run_it-*.dump.sha256' \) \
  -mtime "+${retention_days}" -delete

printf 'Respaldo verificado: %s\n' "$backup_path"
