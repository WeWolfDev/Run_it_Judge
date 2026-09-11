# Run It: documento técnico y operación

## Resumen

Run It es un torneo de programación por rondas, con una pista pública en tiempo
real, un panel de administrador y una vista de participante. Judge0 se usa como
motor de ejecución; el backend de Run It orquesta usuarios, rondas, cola,
ranking y eventos.

## Arquitectura resumida

```text
Navegador
  -> Frontend TanStack Start SSR
  -> Backend Fastify/Socket.io
       -> PostgreSQL
       -> Redis (BullMQ + sesiones)
       -> Worker BullMQ -> Judge0
```

El flujo de envío es: el frontend autentica al participante, el backend valida
la ronda y registra la submission, BullMQ la encola, el worker ejecuta todos
los casos de prueba en Judge0, el resultado actualiza PostgreSQL y emite
`participant:progress` por Socket.io.

## Qué está implementado

### Backend (`run-it-backend/`)

- Fastify en `index.js`; `GET /health` y `GET /ready` (comprueba PostgreSQL y Redis).
- Login por rol (`POST /auth/login`), logout, y alta de participantes por
  código de acceso de un solo uso (`POST /auth/register`).
- Sesiones con store configurable (`session-store.js`): Redis con expiración
  (`SESSION_STORE=redis`, `SESSION_TTL_SECONDS`) y fallback en memoria para
  desarrollo.
- PostgreSQL con tablas para usuarios, códigos, torneos, problemas, rondas,
  participantes, submissions y ranking (`schema.sql`, inicialización automática).
- CRUD completo de torneos, problemas y rondas para el panel de admin.
- BullMQ + Redis para encolar submissions; worker con concurrencia
  `SUBMISSION_CONCURRENCY`.
- **Scoring multi-test**: el worker ejecuta un caso de prueba por entrada
  (stdin) vía batch de Judge0 y calcula porcentaje = casos correctos / total;
  solo se resuelve el problema al pasar todos los casos (`scoring.js`).
- Rate limit de submissions en Redis (`rate-limit.js`, `SET NX PX` por
  usuario) con fallback en memoria.
- Cierre transaccional de rondas con desempate:
  1. resueltos por `solved_at`;
  2. mayor porcentaje;
  3. menos intentos fallidos.
- Cierre automático por cupo o por expiración de `ends_at`.
- Autorización de admin/participante en endpoints sensibles.

### Frontend (`frontend/`)

- React + TypeScript + Vite/TanStack Start (SSR, preset node-server).
- `/login`: entrada por rol y registro de participantes con código.
- `/admin`: panel administrativo protegido (torneos, rondas, problemas,
  códigos de acceso, submissions).
- `/participante`: vista de participante protegida.
- `/pista`: vista pública para espectadores, sin login.
- `/reglas`: reglas públicas.
- `RaceTrack`, `AdminPanel` y `ParticipantView`; Socket.io con fallback mock.
- El contrato de UI y el brief de diseño están en `frontend/README.md`.

## Requisitos

- Node.js 18 o superior.
- npm.
- Docker Desktop y Docker Compose v2.
- Una arquitectura Linux `amd64`/`x86_64` es la opción recomendada para Judge0.

## Arranque local

Desde la raíz del repositorio:

```bash
cp judge0.conf.example judge0.conf
# Edita REDIS_PASSWORD y POSTGRES_PASSWORD.
docker compose config -q
docker compose up -d
```

El compose publica localmente:

- Judge0: `localhost:2358`
- PostgreSQL: `localhost:5433` en el host, `5432` dentro de Docker
- Redis: `localhost:6379`

El puerto `5433` evita conflicto con una instancia de PostgreSQL local en
`5432`. El backend usa `5433` por defecto cuando no se define `DATABASE_URL`.

Arranca el backend en otra terminal:

```bash
cd run-it-backend
npm install
npm run dev
```

Arranca el frontend en otra terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite/TanStack Start queda disponible en `http://localhost:8080` en la
configuración actual.

## Acceso de prueba (solo local, con `RUN_IT_SEED_DEMO=true`)

Administrador:

```text
Usuario: admin
Código: ADMIN-RUN-IT
```

Participante:

```text
Usuario: demo
Código: RUN-IT-2026
```

La pista pública no necesita sesión:

```text
http://localhost:8080/pista
```

## Variables de entorno

### Backend

```bash
DATABASE_URL=postgres://usuario:password@127.0.0.1:5433/run_it
REDIS_HOST=127.0.0.1
REDIS_PORT=6380
REDIS_PASSWORD=tu-password
JUDGE0_URL=http://127.0.0.1:2358
SUBMISSION_CONCURRENCY=4
SUBMISSION_RATE_WINDOW_MS=1000
SESSION_STORE=redis
SESSION_TTL_SECONDS=28800
ADMIN_USERNAME=admin
ADMIN_ACCESS_CODE=codigo-admin-privado
RUN_IT_SEED_DEMO=false
```

- `SESSION_STORE=redis` activa sesiones y rate limit en Redis; si Redis no
  está disponible, el backend usa el fallback en memoria y lo refleja el
  readiness check.
- `DATABASE_URL` debe apuntar a la base `run_it`, no a la base `judge0`.
- `ADMIN_ACCESS_CODE` define el código del usuario `admin` y no tiene valor
  por defecto.

### Frontend

```bash
VITE_API_URL=http://localhost:3000      # en producción: vacío (mismo origen)
VITE_SOCKET_URL=http://localhost:3000   # en producción: /
```

## Flujo de una submission

1. El participante inicia sesión (o se registra con un código) y recibe un token.
2. Se registra en la ronda mediante `/rounds/:id/participants/join`.
3. El frontend envía código a `/rounds/:id/submissions` (rate limit por
   usuario en Redis).
4. El backend valida rol, participante, ronda activa y no pausada.
5. BullMQ encola la submission junto con los casos de prueba del problema.
6. El worker envía el código a Judge0 una vez por caso de prueba (batch con
   stdin codificado en base64; fallback secuencial si el endpoint batch no
   existe).
7. Cada resultado se compara con el `expected` del caso; el porcentaje es
   casos correctos / total y `solved` solo con el 100 %.
8. Se actualizan `submissions` y `round_participants`.
9. Socket.io emite `participant:progress`.
10. Si se llena el cupo, la ronda se cierra transaccionalmente.

## Endpoints principales

```text
GET  /health
GET  /ready
POST /auth/login
POST /auth/register                    participante, consume un código de acceso
POST /auth/logout
GET  /problems
POST /problems                         admin
GET  /problems/:id
PUT  /problems/:id                     admin
DELETE /problems/:id                   admin
POST /tournaments                      admin
GET  /tournaments                      admin
PUT  /tournaments/:id                  admin
DELETE /tournaments/:id                admin
POST /tournaments/:id/start            admin
POST /tournaments/:id/participants     admin
GET  /tournaments/:id/rounds           admin
GET  /tournaments/:id/leaderboard      admin
POST /access-codes/generate            admin
POST /access-codes/:code/claim         participant
POST /rounds                           admin
PUT  /rounds/:id                       admin (solo pending)
DELETE /rounds/:id                     admin (solo pending)
POST /rounds/:id/start                 admin
POST /rounds/:id/pause                 admin
POST /rounds/:id/close                 admin
POST /rounds/:id/participants/join     participant
GET  /rounds/:id/state
GET  /rounds/:id/leaderboard
GET  /rounds/:id/submissions           admin
POST /rounds/:id/submissions           participant
GET  /public/rounds/active             público
```

## Eventos Socket.io

```text
round:started
round:paused
round:closing_soon
round:closed
participant:progress
submission:queued
tournament:winner
round:snapshot
```

El cliente puede solicitar el estado actual al reconectar con:

```js
socket.emit("round:snapshot", roundId);
```

## Seguridad y producción

### Resuelto en producción (2026-09-10)

- `POST /submissions` sin auth eliminado; la única vía de ejecución es
  `POST /rounds/:id/submissions` con sesión de participante y ronda activa.
- CORS (HTTP y Socket.io) restringido con `ALLOWED_ORIGINS`.
- Judge0, PostgreSQL y Redis solo escuchan en `127.0.0.1` (Docker publica
  puertos fuera de UFW, por eso el bind explícito importa).
- Secretos fuera del código: `judge0.conf` y `run-it-backend/secrets` (no
  versionados, `chmod 600`/`440`); sin credenciales demo en producción,
  seed condicionado a `RUN_IT_SEED_DEMO` y código admin solo por
  `ADMIN_ACCESS_CODE`.
- HTTPS vía nginx con Let's Encrypt; el frontend consume la API en el mismo
  origen.

### Flujo de alta de participantes

- El admin genera códigos con `/access-codes/generate` desde el panel.
- El participante usa `POST /auth/register` desde la pantalla de acceso.
- El registro consume el código de forma transaccional, crea el usuario y
  devuelve una sesión de participante.
- `/access-codes/:code/claim` se conserva para códigos emitidos a usuarios
  que ya existen por otros medios.

### Reglas de seguridad

- No subir `judge0.conf`, `run-it-backend/secrets`, certificados ni
  contraseñas al repositorio.
- No activar `RUN_IT_SEED_DEMO=true` en producción.
- No usar `Access-Control-Allow-Origin: *`.
- No publicar PostgreSQL, Redis ni Judge0 a Internet.
- No ejecutar `docker compose down -v` (borra los datos).

### Limitaciones conocidas (aceptadas en MVP)

- Códigos de acceso y `access_code` de usuarios guardados en texto plano
  (hashear exige migrar códigos existentes; diferido).
- Token de sesión en `localStorage` (superficie XSS estándar; CORS
  restringido mitiga el resto de sitios).
- Rate limit en Redis requiere `SESSION_STORE=redis`; con el fallback en
  memoria no escala a varias instancias del backend.
- `/pista` expone los display names de los participantes (por diseño).
- Judge0 corre con `privileged: true` (requisito del sandbox isolate de
  judge0 CE); riesgo conocido y documentado upstream.
- Sin métricas ni pruebas de carga.

## Respaldos

- `scripts/backup-run-it-db.sh` ejecuta `pg_dump` de la base `run_it` desde
  el contenedor `judge-db-1`, comprime con gzip en `/root/backups`
  (`runit-db-<fecha>.sql.gz`, chmod 600) y conserva 14 días.
- Programado diariamente 04:17 UTC con el timer systemd `run-it-backup.timer`
  (`systemctl status run-it-backup.timer`). El primer respaldo manual y el
  intervalo de retención (`RUN_IT_BACKUP_RETENTION_DAYS`) son configurables.

## Despliegue en producción (gelatina.lat)

Run It sirve en `https://runit.gelatina.lat` (Cloudflare → nginx TLS → servicios
en loopback) desde `/root/judge` en el host gelatina.lat.

Arquitectura de puertos (todos en `127.0.0.1`, nada expuesto al exterior):

| Servicio | Puerto | Gestión |
| --- | --- | --- |
| Judge0 | 2358 | `docker compose up -d` en `/root/judge` |
| PostgreSQL | 5433 (BD `run_it`, separada de la BD `judge0` de Judge0) | docker |
| Redis (docker) | 6380 (el host ya usa 6379) | docker |
| Backend Fastify | 3001 | `systemctl restart run-it-backend` |
| Frontend SSR | 3002 | `systemctl restart run-it-frontend` |

### Secretos

- `judge0.conf` (secretos de Judge0, propietario `1000:999`, chmod 440) y
  `run-it-backend/secrets` (env del backend, chmod 440) no se versionan.

Plantilla del env del backend (`run-it-backend/secrets`):

```dotenv
NODE_ENV=production
PORT=3001
DATABASE_URL=postgres://run_it:CONTRASENA_BD@127.0.0.1:5433/run_it
REDIS_HOST=127.0.0.1
REDIS_PORT=6380
REDIS_PASSWORD=CONTRASENA_REDIS
JUDGE0_URL=http://127.0.0.1:2358
ALLOWED_ORIGINS=https://runit.gelatina.lat
SESSION_STORE=redis
SESSION_TTL_SECONDS=28800
ADMIN_USERNAME=admin
ADMIN_ACCESS_CODE=CODIGO_ADMIN_PRIVADO
RUN_IT_SEED_DEMO=false
SUBMISSION_CONCURRENCY=4
```

- `DATABASE_URL` debe apuntar a la base `run_it`, no a la base `judge0`
  (colisión de tablas `submissions`/`users`/`problems` con Judge0 Rails).
- `REDIS_PORT` es `6380` porque ese es el puerto publicado por Docker en el host.
- `RUN_IT_SEED_DEMO` debe ser `false` en producción.
- `SESSION_STORE=redis` conserva sesiones entre reinicios del backend.

### Ciclo de despliegue

```bash
cd /root/judge && git pull origin main
cd run-it-backend && npm ci --omit=dev
systemctl restart run-it-backend

cd ../frontend && npm ci
VITE_API_URL="" VITE_SOCKET_URL="/" npm run build
systemctl restart run-it-frontend
```

- El frontend se compila para mismo origen (`VITE_API_URL=""`,
  `VITE_SOCKET_URL=/`) con preset Node: `nitro: { preset: "node-server" }` en
  `frontend/vite.config.ts`; nginx enruta `/socket.io/` y las rutas de API al
  backend (`nginx -t` antes de recargar).
- El backend no arranca sin `DATABASE_URL`; `ADMIN_ACCESS_CODE` define el
  código del usuario `admin` y no tiene valor por defecto.
- El host usa cgroup v2 y el isolate de judge0 1.13.1 espera cgroup v1: se
  evita `--cg` fijando `ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT=true` y
  `ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT=true` en `judge0.conf`.

### Verificación post-despliegue

```bash
curl -fsS https://runit.gelatina.lat/health
curl -fsS https://runit.gelatina.lat/ready
curl -I https://runit.gelatina.lat/login
```

Checklist funcional:

- `/health` responde HTTP 200; `/ready` HTTP 200 con BD y Redis disponibles.
- Login admin con el usuario y código configurados.
- El panel admin crea un torneo o genera un código.
- Un participante se registra con un código generado.
- `/pista` funciona sin iniciar sesión.
- Una submission llega a Judge0, evalúa todos los casos y actualiza el ranking.
- Los eventos de Socket.io funcionan al iniciar, pausar y cerrar una ronda.

### Diagnóstico

```bash
systemctl status run-it-backend --no-pager
systemctl status run-it-frontend --no-pager
journalctl -u run-it-backend -n 100 --no-pager
journalctl -u run-it-frontend -n 100 --no-pager
cd /root/judge && docker compose ps
docker compose logs --tail=100 server worker db redis
```

## Validación disponible

```bash
docker compose config -q
cd run-it-backend && npm test
cd ../frontend && npm ci && VITE_API_URL="" VITE_SOCKET_URL="/" npm run build
```

## Apagado

```bash
docker compose down
```

Esto conserva PostgreSQL. No uses `docker compose down -v` salvo que quieras borrar los datos.

## Bitácora de cambios

### 2026-09-11: consolidación de main y mejoras pendientes

- Consolidados en `main` los cambios del propietario del repositorio
  (workflows de admin completos, alta de participantes por códigos, sesiones
  Redis opcionales, tests de salud).
- Scoring multi-test: el worker ejecuta cada caso de prueba (stdin por caso)
  con el endpoint batch de Judge0 (base64, con fallback secuencial), calcula
  el porcentaje real de casos correctos y solo marca `solved` al pasar todos.
- Rate limit de submissions migrado a Redis (`SET NX PX` por usuario) con
  fallback en memoria; ventana configurable con `SUBMISSION_RATE_WINDOW_MS`.
- Respaldos: `scripts/backup-run-it-db.sh` + timer systemd `run-it-backup.timer`
  (diario 04:17 UTC, retención 14 días).
- Pruebas automatizadas con `node --test`: scoring, rate limit, cliente
  Judge0 (batch/fallback), sesiones y endpoints de salud.
- Documentación consolidada: `README.md` nuevo, este documento absorbe
  `CHANGELOG_RUN_IT.md` y `SOLICITUD_SERVIDOR_RUN_IT.md` (retirados);
  `BACKEND_RUN_IT.md` renombrado a `RUN_IT.md`.

### 2026-09-10: producción en gelatina.lat (runit.gelatina.lat)

- Seguridad: eliminado `POST /submissions` sin auth, CORS restringido por
  `ALLOWED_ORIGINS`, secretos fuera del código (`judge0.conf` y
  `run-it-backend/secrets`, no versionados), seed demo condicionado a
  `RUN_IT_SEED_DEMO`, código admin por `ADMIN_ACCESS_CODE`.
- Corregida la colisión de esquema: Run It usa su propia base de datos
  `run_it` (Judge0 Rails usa la BD `judge0` y también define `submissions`,
  `users` y `problems`).
- Scoring corregido: el worker compara la salida con el `expected` del
  problema en vez de aceptar cualquier salida.
- Desplegado con judge0 1.13.1 fijo, systemd (`run-it-backend`,
  `run-it-frontend`), nginx `runit.gelatina.lat` con TLS Let's Encrypt.

### 2026-09-09: arranque local reproducible

- PostgreSQL pasó a publicarse como `5433:5432` porque una instancia local de
  macOS ocupaba el puerto `5432`. Judge0 sigue usando el servicio Docker `db`
  y su puerto interno normal.
- Se cambió el volumen de PostgreSQL a `data_v2` para separar la inicialización
  corregida de un volumen local anterior que no contenía el rol `judge0`.
- `run-it-backend/db.js` apunta a `127.0.0.1:5433` por defecto y mantiene
  `DATABASE_URL` como configuración preferente.
- La ronda soporta el campo `paused`; los envíos se rechazan mientras está
  pausada.
- Los participantes pueden unirse a rondas `pending` o `active`.
- `socket.io-client` quedó declarado en `frontend/package.json`.

## Pendientes conocidos

- Hashear códigos de acceso (requiere migrar códigos existentes).
- Considerar cookies `httpOnly` en lugar de token en `localStorage`.
- Métricas y pruebas de carga.
- Pruebas de ciclo completo sobre BD real (las actuales son unitarias y de
  endpoints sin BD).