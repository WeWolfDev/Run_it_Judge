# Bitácora de Run It

## 2026-09-10

### Despliegue en producción (runit.gelatina.lat)

- Stack: Judge0 1.13.1 + Postgres 16.2 + Redis 7.2.4 en Docker con binds solo
  a `127.0.0.1`; backend en systemd (`:3001`), frontend SSR con preset Node
  (`:3002`), nginx con TLS Let's Encrypt.
- Run It usa la base de datos `run_it`, separada de la base `judge0` que
  gestiona el propio Judge0 (colisión de tablas `submissions`/`users`/
  `problems` corregida).
- Seguridad: eliminado `POST /submissions` público, CORS restringido,
  credenciales demo fuera del repositorio, seed demo solo con
  `RUN_IT_SEED_DEMO=true`, código admin por `ADMIN_ACCESS_CODE`.
- Scoring: el worker compara la salida con el `expected` del problema.
- Judge0 en cgroup v2: límites por proceso/hilo activados para evitar
  `--cg` (isolate 1.13.1 solo soporta cgroup v1).

## 2026-09-09

### Infraestructura local

- PostgreSQL de Docker se publica en `localhost:5433` porque el puerto `5432`
  estaba ocupado por otra instancia local de PostgreSQL.
- El servicio mantiene `5432` dentro de la red Docker; Judge0 no cambia su
  conexión interna.
- Se usa el volumen `data_v2` para evitar reutilizar un volumen inicializado sin
  el rol `judge0`.
- Judge0 y su worker mantienen `linux/amd64` para compatibilidad con el
  sandbox; Apple Silicon puede requerir un host x86_64 para ejecuciones reales.

### Backend

- Fastify arranca en `http://localhost:3000`.
- `GET /health` responde `{"status":"ok"}`.
- La URL PostgreSQL por defecto usa `127.0.0.1:5433`; `DATABASE_URL` permite
  sobreescribirla.
- Se mantiene la inicialización del esquema y de los datos demo.
- Las rondas tienen el estado `paused` y los envíos se bloquean mientras están
  pausadas.
- Los participantes pueden unirse a rondas pendientes o activas.

### Frontend

- Vite/TanStack Start sirve la aplicación en `http://localhost:8080`.
- `/login` autentica por rol.
- `/pista` es la vista pública del torneo.
- `socket.io-client` está instalado y declarado como dependencia.

## Arquitectura resumida

```text
Navegador
  -> Frontend Vite/TanStack Start :8080
  -> Backend Fastify/Socket.io :3000
       -> PostgreSQL :5433 (host) / :5432 (Docker)
       -> Redis :6379
       -> BullMQ worker -> Judge0 :2358
```

El flujo de envío es: frontend autentica al participante, backend valida la
ronda y registra la submission, BullMQ la encola, el worker la envía a Judge0,
y el resultado actualiza PostgreSQL y emite `participant:progress` por Socket.io.

## Pendientes conocidos

- Las sesiones son de memoria y deben migrarse a sesiones persistentes o JWT.
- Las credenciales de desarrollo deben sustituirse por secretos del entorno.
- Judge0 requiere un entorno x86_64 o un servicio externo para producción.
- Faltan pruebas automatizadas de ciclo completo, scoring y administración.