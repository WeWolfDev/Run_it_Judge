# Run It: estado técnico y operación local

## Resumen

Run It es un torneo de programación por rondas, con una pista pública en tiempo real, un panel de administrador y una vista de participante. Judge0 se usa como motor de ejecución; el backend de Run It orquesta usuarios, rondas, cola, ranking y eventos.

## Qué está implementado

### Backend

- Fastify en `run-it-backend/index.js`.
- `GET /health`.
- Login por rol mediante `POST /auth/login`.
- Sesiones en memoria para desarrollo local.
- PostgreSQL con tablas para usuarios, códigos, torneos, problemas, rondas, participantes, submissions y ranking.
- Seed de desarrollo:
  - `admin` / `ADMIN-RUN-IT`
  - `demo` / `RUN-IT-2026`
  - Torneo y ronda demo de `Hola mundo`.
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
- Feed mock como fallback y Socket.io opcional mediante `VITE_SOCKET_URL`.

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

El puerto `5433` evita el conflicto con una instancia de PostgreSQL instalada
directamente en macOS que ya escucha en `5432`. El backend usa `5433` por
defecto cuando no se define `DATABASE_URL`.

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

## Acceso de prueba

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

Backend:

```bash
DATABASE_URL=postgres://judge0:password@localhost:5433/judge0
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=tu-password
JUDGE0_URL=http://localhost:2358
SUBMISSION_CONCURRENCY=4
```

Frontend:

```bash
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
VITE_ROUND_ID=00000000-0000-0000-0000-000000000002
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

### Gap de producto (bloqueante para un torneo)

- **No existe flujo de alta de participantes.** `/auth/login` solo valida
  usuarios ya existentes en la tabla `users`, y los endpoints admin
  (`/access-codes/generate`, `/access-codes/:code/claim`) generan y
  reclaman códigos pero nunca crean un `user`. Hace falta un endpoint
  tipo `POST /auth/register` que consuma un access code y cree el
  participante (o un endpoint admin que cree usuarios). Sin esto, el
  torneo solo puede arrancar insertando usuarios a mano en la base de
  datos.

### Limitaciones conocidas (aceptadas en MVP)

- Sesiones en memoria: se pierden al reiniciar el backend (logout global),
  no tienen expiración y no hay invalidación de token.
- Rate limit de submissions en memoria (1/s por usuario): se resetea al
  reiniciar y no escalaría a varias instancias; migrar a Redis.
- Códigos de acceso y `access_code` de usuarios guardados en texto plano.
- Token de sesión en `localStorage` (superficie XSS estándar; CORS
  restringido mitiga el resto de sitios).
- Scoring usa solo el primer caso de prueba (`test_cases[0]`); no hay
  ejecución multi-test.
- `/pista` expone los display names de los participantes (por diseño).
- Judge0 corre con `privileged: true` (requisito del sandbox isolate de
  judge0 CE); riesgo conocido y documentado upstream.
- Sin backups, métricas ni pruebas de carga.

## Validación disponible

Validaciones ejecutadas sin dependencias:

```bash
docker compose config -q
```

También se verificaron diagnósticos estáticos de los archivos backend y frontend. El build completo no se pudo ejecutar en el entorno de trabajo cuando `npm` no estaba disponible; en una máquina con Node instalado debe ejecutarse:

```bash
cd run-it-backend && npm install
cd ../frontend && npm install && npm run build
```

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
| Redis (docker) | 6380 (el host ya usa 6379) | docker |
| Backend Fastify | 3001 | `systemctl restart run-it-backend` |
| Frontend SSR | 3002 | `systemctl restart run-it-frontend` |

- `judge0.conf` (secretos de Judge0) y `run-it-backend/secrets` (env del
  backend) no se versionan. Ambos requieren `chmod 440 judge0.conf` con
  propietario `1000:999` para que el contenedor pueda leerlo.
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
2. El backend Fastify escucha en `3000`, inicializa el esquema y los datos demo,
   y expone autenticación, rondas, submissions y eventos Socket.io.
3. Redis/BullMQ desacopla el envío de código de la respuesta HTTP; el worker
   consulta Judge0 y actualiza el progreso de la ronda.
4. PostgreSQL conserva usuarios, torneos, rondas, participantes y resultados.
5. El frontend en `8080` consume el backend en `3000`; `/pista` consulta el
   estado público y puede recibir actualizaciones en tiempo real.
6. En Apple Silicon, Judge0 usa `platform: linux/amd64`; para ejecución fiable
   se recomienda un host Linux `x86_64` o un servicio Judge0 externo.

### Validación más reciente

```text
docker compose config -q          OK
PostgreSQL en localhost:5433      current_user=judge0, database=judge0
Backend http://localhost:3000     /health -> {"status":"ok"}
Frontend http://localhost:8080    / -> redirección a /login
Frontend http://localhost:8080    /pista disponible
```
