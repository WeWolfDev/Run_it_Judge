# Run It: estado técnico y operación local

## Resumen

Run It es un torneo de programación por rondas, con una pista pública en tiempo real, un panel de administrador y una vista de participante. Judge0 se usa como motor de ejecución; el backend de Run It orquesta usuarios, rondas, cola, ranking y eventos.

## Qué está implementado

### Backend

- Fastify en `run-it-backend/index.js`.
- `GET /health`.
- `GET /ready` comprueba PostgreSQL, la cola Redis y el estado del almacen de sesiones.
- Login por rol mediante `POST /auth/login`.
- Registro de participantes mediante `POST /auth/register` usando un código de acceso de un solo uso.
- Sesiones en memoria para desarrollo local; en produccion requiere Redis y falla cerrado si Redis no esta disponible.
- PostgreSQL con tablas para usuarios, códigos, torneos, problemas, rondas, participantes, submissions y ranking.
- Seed de desarrollo opcional con `RUN_IT_SEED_DEMO=true`; no hay credenciales demo por defecto y produccion usa `false`.
- El administrador puede crear problemas y rondas desde `/admin`; en una base limpia no hace falta sembrar datos.
- BullMQ + Redis para encolar submissions.
- Socket.io para eventos y snapshots.
- Cierre transaccional de rondas con desempate:
  1. resueltos por `solved_at`;
  2. mayor porcentaje;
  3. menos intentos fallidos.
- Cierre automático por cupo o por expiración de `ends_at`.
- Rate limit básico por usuario para submissions.
- Autorización de admin/participante en endpoints sensibles.

### Frontend

- React + TypeScript + Vite/TanStack Router en `frontend/`.
- `/login`: entrada por rol.
- `/admin`: panel administrativo protegido.
- `/participante`: vista de participante protegida.
- `/pista`: vista pública para espectadores, sin login.
- `/reglas`: reglas públicas.
- `RaceTrack`, `AdminPanel` y `ParticipantView`.
- Socket.io en produccion mediante `VITE_SOCKET_URL=/`; el feed mock solo debe usarse en desarrollo.

## Requisitos

- Node.js 22.12 o superior (Vite 8, Nitro 3 y TanStack Start ya no admiten Node.js 18/20).
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
- Redis: `localhost:6380` (el host evita el 6379 ocupado)

El puerto `5433` evita el conflicto con una instancia de PostgreSQL instalada
directamente en macOS que ya escucha en `5432`. `DATABASE_URL` es obligatorio y
debe apuntar a la base `run_it`, separada de `judge0`.

En el bootstrap de produccion el usuario no se agrega al grupo `docker`;
usa `sudo docker compose ...` para diagnosticar o operar contenedores.

Arranca el backend en otra terminal:

```bash
cd run-it-backend
npm ci
DATABASE_URL=postgres://run_it:password@127.0.0.1:5433/run_it \
REDIS_PORT=6380 npm run dev
```

Arranca el frontend en otra terminal:

```bash
cd frontend
npm ci
VITE_API_URL=http://localhost:3001 VITE_SOCKET_URL=http://localhost:3001 npm run dev
```

Vite/TanStack Start queda disponible en `http://localhost:8080` en la
configuración actual.

## Acceso de prueba

El usuario admin se crea al arrancar solo cuando se define
`ADMIN_ACCESS_CODE`; no existe una credencial por defecto. Participantas deben
registrarse con un codigo generado por el admin.

La pista pública no necesita sesión:

```text
http://localhost:8080/pista
```

## Variables de entorno

Backend:

```bash
DATABASE_URL=postgres://run_it:password@127.0.0.1:5433/run_it
REDIS_HOST=127.0.0.1
REDIS_PORT=6380
REDIS_PASSWORD=tu-password
JUDGE0_URL=http://127.0.0.1:2358
SESSION_STORE=redis
SESSION_TTL_SECONDS=28800
ADMIN_USERNAME=admin
ADMIN_ACCESS_CODE=codigo-privado
RUN_IT_SEED_DEMO=false
SUBMISSION_CONCURRENCY=4
```

Frontend:

```bash
# Desarrollo:
VITE_API_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001

# Produccion (mismo origen, Nginx enruta API y WebSocket):
VITE_API_URL=
VITE_SOCKET_URL=/
```

## Flujo de una submission

1. El participante inicia sesión y recibe un token.
2. Se registra en la ronda mediante `/rounds/:id/participants/join`.
3. El frontend envía código a `/rounds/:id/submissions`.
4. El backend valida rol, participante, ronda activa y rate limit.
5. BullMQ encola la submission.
6. El worker envía el código a Judge0 y espera el token final.
7. El resultado actualiza `submissions` y `round_participants`.
8. Socket.io emite `participant:progress`.
9. Si se llena el cupo, la ronda se cierra transaccionalmente.

## Endpoints principales

```text
GET  /health
POST /auth/login
POST /auth/register                    participante, consume un código de acceso
GET  /problems
POST /problems                         admin
POST /tournaments                      admin
POST /tournaments/:id/start            admin
POST /tournaments/:id/participants    admin
POST /access-codes/generate            admin
POST /access-codes/:code/claim         participant
POST /rounds                           admin
POST /rounds/:id/start                 admin
POST /rounds/:id/pause                 admin
POST /rounds/:id/close                 admin
POST /rounds/:id/participants/join     participant
GET  /rounds/:id/state
GET  /rounds/:id/leaderboard
GET  /tournaments/:id/leaderboard admin
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
- Scoring corregido: el worker compara la salida con el `expected` del
  problema (antes aceptaba cualquier salida no vacía).

### Flujo de alta de participantes

- El admin genera códigos con `/access-codes/generate` desde el panel.
- El participante usa `POST /auth/register` desde la pantalla de acceso.
- El registro consume el código de forma transaccional, crea el usuario y
  devuelve una sesión de participante.
- `/access-codes/:code/claim` se conserva para códigos emitidos a usuarios
  que ya existen por otros medios.

### Limitaciones conocidas (aceptadas en MVP)

- Sesiones en memoria solo para desarrollo; en produccion `SESSION_STORE=redis` es obligatorio y el backend falla cerrado si Redis no esta disponible.
- Rate limit de submissions en memoria (1/s por usuario): se resetea al
  reiniciar y no escalaría a varias instancias; migrar a Redis.
- Códigos de acceso y `access_code` de usuarios guardados en texto plano.
- Token de sesión en `localStorage` (superficie XSS estándar; CORS
  restringido mitiga el resto de sitios).
- El endpoint publico de ronda activa incluye los casos de prueba para el MVP;
  no usar casos secretos en un torneo competitivo hasta implementar ocultamiento.
- Scoring usa solo el primer caso de prueba (`test_cases[0]`); no hay
  ejecución multi-test.
- `/pista` expone los display names de los participantes (por diseño).
- Judge0 corre con `privileged: true` (requisito del sandbox isolate de
  judge0 CE); riesgo conocido y documentado upstream.
- Backups y restauracion inicial del bootstrap disponibles; aun no hay metricas,
  alertas ni pruebas de carga.

## Validación disponible

El bootstrap de produccion ejecuta:

```bash
docker compose config -q
npm ci y npm test                         # backend
npm ci, npm run typecheck y npm run build # frontend
npm run judge0                            # ejecucion real de Judge0
bash deploy/smoke-test.sh
sudo node deploy/e2e-test.cjs             # flujo completo y limpieza
```

En el checkout actual se validaron Node 22.22.1, typecheck, build SSR y las
pruebas backend. El E2E completo queda habilitado por el bootstrap después de
que Docker, Redis, PostgreSQL y Judge0 esten disponibles.

## Apagado

```bash
docker compose down
```

Esto conserva PostgreSQL. No uses `docker compose down -v` salvo que quieras borrar los datos.

## Despliegue en producción (gelatina.lat)

Run It sirve en `https://runit.gelatina.lat` (Cloudflare → nginx TLS → servicios
en loopback) desde `/root/judge` en el host gelatina-lat.

Arquitectura de puertos (todos en `127.0.0.1`, nada expuesto al exterior):

| Servicio | Puerto | Gestión |
| --- | --- | --- |
| Judge0 | 2358 | `docker compose up -d` en `/root/judge` |
| PostgreSQL | 5433 (BD `run_it`, separada de la BD `judge0` de Judge0) | docker |
| Redis (docker) | 6380 (AOF persistente en volumen Docker) | docker |
| Backend Fastify | 3001 | `systemctl restart run-it-backend` |
| Frontend SSR | 3002 | `systemctl restart run-it-frontend` |

- `judge0.conf` (secretos de Judge0) y `run-it-backend/secrets` (env del
  backend) no se versionan. `judge0.conf` requiere `chmod 440` y propietario
  `1000:999` para el contenedor Judge0; el EnvironmentFile del backend es
  root-only y systemd lo carga antes de drop privileges.
- Docker publica puertos fuera de UFW: por eso todos los binds son a
  `127.0.0.1` explícito en `docker-compose.yml`.
- El host usa cgroup v2 y el isolate de judge0 1.13.1 espera cgroup v1: se
  evita `--cg` fijando `ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT=true` y
  `ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT=true` en `judge0.conf`.
- El backend no arranca sin `DATABASE_URL`; `RUN_IT_SEED_DEMO=true` solo
  siembra datos demo (desactivado en producción). `ADMIN_ACCESS_CODE` define
  el código del usuario `admin` y no tiene valor por defecto.
- El CORS (HTTP y Socket.io) se restringe con `ALLOWED_ORIGINS`; en
  producción: `https://runit.gelatina.lat`.
- El endpoint público `POST /submissions` (ejecución arbitraria sin auth) se
  eliminó; la única vía de ejecución es `POST /rounds/:id/submissions` con
  sesión de participante y ronda activa.
- El frontend se compila para mismo origen (`VITE_API_URL=""`,
  `VITE_SOCKET_URL=/`) con preset Node: `nitro: { preset: "node-server" }` en
  `frontend/vite.config.ts`; nginx enruta `/socket.io/` y las rutas de API al
  backend (`nginx -t` antes de recargar).
- El worker de submissions compara `stdout` con el `expected` del problema
  (antes daba por resuelto cualquier salida no vacía).

Ciclo de despliegue del frontend:

```bash
cd frontend && VITE_API_URL="" VITE_SOCKET_URL="/" npm run build
systemctl restart run-it-frontend
```

Para un host Ubuntu nuevo se recomienda el bootstrap versionado, que instala
Node 22, Docker, nginx, systemd y Cockpit sin abrir Cockpit a Internet:

```bash
sudo bash deploy/bootstrap-ubuntu.sh
```

Cockpit queda en `127.0.0.1:9090`; el acceso remoto se realiza con
`ssh -N -L 9090:127.0.0.1:9090 usuario@ servidor`. El HTTP nginx solo atiende
el challenge ACME y devuelve 503 hasta que exista un certificado TLS valido.

## Bitácora de cambios

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
- Se reinstalaron las dependencias frontend después de borrar `node_modules`.
  `socket.io-client` quedó declarado en `frontend/package.json`.

### Explicación del sistema

1. Docker inicia Judge0, su worker, PostgreSQL y Redis desde
   `docker-compose.yml`.
2. El backend Fastify escucha en `127.0.0.1:3001` en producción, inicializa el
   esquema y expone autenticación, rondas, submissions y eventos Socket.io.
3. Redis/BullMQ desacopla el envío de código de la respuesta HTTP; el worker
   consulta Judge0 y actualiza el progreso de la ronda.
4. PostgreSQL conserva usuarios, torneos, rondas, participantes y resultados.
5. El frontend SSR en `127.0.0.1:3002` consume el backend en `3001` a traves
   de nginx; `/pista` consulta el estado público y recibe actualizaciones.
6. En Apple Silicon, Judge0 usa `platform: linux/amd64`; para ejecución fiable
   se recomienda un host Linux `x86_64` o un servicio Judge0 externo.

### Validación más reciente

El checkout actual valida con Node 22.22.1:

```text
Backend npm test                  OK
Frontend npm run typecheck        OK
Frontend SSR build                OK
```

El host nuevo completa ademas `deploy/smoke-test.sh`, la prueba real de Judge0
y `deploy/e2e-test.cjs` durante el bootstrap.
