# Rollback: casos de prueba en paralelo

Cómo volver atrás el cambio de la rama `perf/parallel-test-cases`, que ejecuta
los casos de un envío en paralelo contra Judge0 con un tope global de 8.

## Qué cambió

Solo código del backend:

| Archivo | Cambio |
| --- | --- |
| `run-it-backend/queue.js` | El `for` en serie pasa a `runTestCases()` con un tope compartido |
| `run-it-backend/case-runner.js` | Nuevo: tope de ejecuciones en vuelo y planificador de casos |
| `run-it-backend/test/case-runner.test.js` | Nuevo: tests de orden, tope y liberación de permisos |
| `run-it-backend/test/judge.e2e.test.js` | Nuevo test de orden de casos contra Judge0 real |
| `deploy/dev-branch.sh` | Desarrollo: `JUDGE0_MAX_IN_FLIGHT=2` |

**No** toca la base de datos, Redis, `judge0.conf`, `docker-compose.yml`,
`secrets` ni el frontend. Por eso el rollback no necesita migraciones, limpieza
de datos ni un build nuevo del frontend.

## Cuándo hacer rollback

Cualquiera de estas señales, después del deploy:

- Aparecen envíos con `verdict = 'judge_error'` o quedan en `queued` sin avanzar.
- `GET http://127.0.0.1:2358/about` deja de responder o responde lento.
- Un participante reporta que el detalle por caso ("3 de 5") no corresponde a
  su código.
- La memoria del host baja de forma sostenida durante una ronda.

Referencia medida antes del deploy: con 8 envíos de 5 casos a la vez, el
contenedor worker de Judge0 sube como máximo +605 MB (C++), y Judge0 nunca ve
más de 8 ejecuciones simultáneas del backend.

## Antes de empezar

- **Hacerlo entre rondas.** Reiniciar el backend corta los envíos que se están
  evaluando. No se pierden: BullMQ los retoma solo, pero tardan ~1 minuto en
  recibir veredicto.
- Tener a mano el hash del merge del PR:

```bash
cd /home/serverwewolf/ServerRunIt/Run_it_Judge
git log --oneline --merges -5    # buscar "Merge pull request ... perf/parallel-test-cases"
```

## Opción A: emergencia (en medio de un evento)

Vuelve producción al commit anterior al merge sin esperar un PR. Es el mismo
mecanismo que usa `MIGRACION_SERVIDOR_RUN_IT.md` (`git checkout <COMMIT>`).

```bash
cd /home/serverwewolf/ServerRunIt/Run_it_Judge

# 1. Commit anterior al merge (primer padre)
PREVIO=$(git rev-parse <HASH_DEL_MERGE>^1)
echo "$PREVIO"

# 2. Llevar el código a ese commit
git checkout "$PREVIO"

# 3. Reiniciar SOLO el backend (el frontend no cambió)
sudo systemctl restart run-it-backend.service
```

El checkout queda en detached HEAD. Es temporal: después hacer la opción B
y volver a `main`.

## Opción B: formal (vía PR, deja `main` corregido)

`main` solo recibe cambios por PR, y no se reescribe historia publicada
(restricción de Lovable): nada de `reset`, `force push` ni `rebase`.

**Desde GitHub:** en el PR mergeado, botón **Revert**. Crea un PR que invierte
el cambio; revisarlo y mergearlo.

**O por línea de comandos**, desde un worktree (nunca en el checkout de
producción):

```bash
git fetch origin
git switch -c revert/parallel-test-cases origin/main
git revert -m 1 <HASH_DEL_MERGE>
cd run-it-backend && npm test && cd ..
git push -u origin revert/parallel-test-cases
# abrir el PR hacia main y mergearlo
```

Una vez mergeado, desplegar en producción:

```bash
cd /home/serverwewolf/ServerRunIt/Run_it_Judge
git checkout main
git pull --ff-only origin main
sudo systemctl restart run-it-backend.service
```

No hace falta `npm ci`: el cambio no agregó dependencias.

## Verificar después del rollback

```bash
# Backend vivo
curl -fsS http://127.0.0.1:3001/health

# Judge0 vivo
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:2358/about

# El código volvió al for en serie: tiene que imprimir 0
grep -c runTestCases run-it-backend/queue.js

# Servicio sin errores recientes
sudo journalctl -u run-it-backend.service -n 50 --no-pager
```

Con acceso a la base `run_it`, confirmar que no quedaron envíos colgados:

```sql
SELECT verdict, count(*)
FROM submissions
WHERE submitted_at > now() - interval '1 hour'
  AND verdict IN ('queued', 'judge_error', 'queue_error')
GROUP BY verdict;
```

Los `queued` que existían al momento del reinicio tienen que desaparecer en
~1–2 minutos, cuando BullMQ los retome.

## Qué se pierde al revertir

Solo latencia. Un envío de 5 casos vuelve de ~1,1 s a ~5,2 s, y con muchos
participantes a la vez la cola crece más rápido (Judge0 vuelve a usar 4 de sus
8 sandboxes). Ningún dato ni configuración cambia.
