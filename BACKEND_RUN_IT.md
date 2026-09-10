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

La autenticación actual es suficiente para desarrollo local, pero no para producción:

- Las sesiones viven en memoria y se pierden al reiniciar.
- Los códigos están almacenados en texto plano.
- Falta JWT o sesiones persistentes.
- El rate limit debe migrarse a Redis.
- CORS debe restringirse al dominio del frontend.
- Judge0 no debe exponerse públicamente sin firewall/autenticación.
- Faltan HTTPS, backups, métricas y pruebas de carga.

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

## Bitácora de cambios

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
