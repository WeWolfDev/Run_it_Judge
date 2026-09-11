#!/usr/bin/env bash
# Respaldo diario de la base de datos run_it (Judge0 corre en el contenedor judge-db-1).
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${RUN_IT_BACKUP_DIR:-/root/backups}"
OUT="$OUT_DIR/runit-db-$STAMP.sql.gz"
RETENTION_DAYS="${RUN_IT_BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$OUT_DIR"
umask 077
docker exec judge-db-1 pg_dump -U judge0 run_it | gzip > "$OUT"
find "$OUT_DIR" -name 'runit-db-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
printf '%s\n' "$OUT"