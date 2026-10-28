#!/usr/bin/env bash
# Saca de los torneos que todavía no se jugaron a quienes quedaron inscriptos
# en la ronda 1 de un torneo ajeno. Antes de fix/upcoming-round-membership la
# sala de espera inscribía ahí a cualquiera que recargara sin ronda activa,
# incluidos los eliminados de otro torneo.
#
# Uso:
#   sudo deploy/purge-foreign-enrollments.sh            # solo lista, no borra
#   sudo deploy/purge-foreign-enrollments.sh --apply    # borra, en una transacción
#   RUN_IT_DB=run_it_dev sudo -E deploy/purge-foreign-enrollments.sh
#
# Solo toca torneos cuyas rondas siguen todas pendientes y sin envíos: ahí no
# hay resultados que perder. El participante se borra y round_participants cae
# en cascada.
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Este script debe ejecutarse como root." >&2
  exit 1
fi

database=${RUN_IT_DB:-run_it}
apply=false
case "${1:-}" in
  "") ;;
  --apply) apply=true ;;
  *)
    echo "Uso: $0 [--apply]" >&2
    exit 1
    ;;
esac

if [[ ! "$database" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "Nombre de base no válido: $database" >&2
  exit 1
fi

mapfile -t postgres_containers < <(
  docker ps --filter status=running --format '{{.Names}} {{.Image}}' \
    | awk '$2 ~ /^postgres:/ {print $1}'
)

db_container=""
for candidate in "${postgres_containers[@]}"; do
  if docker exec "$candidate" sh -c \
    "psql -U \"\$POSTGRES_USER\" -d $database -Atqc 'SELECT 1'" 2>/dev/null | grep -qx '1'; then
    db_container="$candidate"
    break
  fi
done

if [[ -z "$db_container" ]]; then
  echo "No se encontró un contenedor PostgreSQL con la base $database." >&2
  exit 1
fi

# Mismo criterio que selfEnrollAllowedSql en index.js: el usuario está atado a
# otro torneo por su código, o por haber jugado otro torneo que ya arrancó.
foreign_sql="
  SELECT p.id, u.username, t.name AS torneo
  FROM participants p
  JOIN users u ON u.id = p.user_id
  JOIN tournaments t ON t.id = p.tournament_id
  WHERE NOT EXISTS (SELECT 1 FROM rounds r WHERE r.tournament_id = p.tournament_id AND r.status <> 'pending')
    AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.participant_id = p.id)
    AND (
      EXISTS (SELECT 1 FROM access_codes ac WHERE ac.claimed_by_user_id = p.user_id AND ac.tournament_id <> p.tournament_id)
      OR EXISTS (
        SELECT 1 FROM participants other JOIN rounds played ON played.tournament_id = other.tournament_id
        WHERE other.user_id = p.user_id AND other.tournament_id <> p.tournament_id AND played.status <> 'pending'
      )
    )"

if [[ "$apply" == false ]]; then
  sql="SELECT username, torneo FROM ($foreign_sql) f ORDER BY torneo, username;"
else
  sql="BEGIN;
  DELETE FROM participants WHERE id IN (SELECT id FROM ($foreign_sql) f) RETURNING display_name;
  COMMIT;"
fi

docker exec -i "$db_container" sh -c \
  "exec psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d $database" <<<"$sql"

if [[ "$apply" == false ]]; then
  echo "Nada se borró. Para borrar: $0 --apply"
fi
