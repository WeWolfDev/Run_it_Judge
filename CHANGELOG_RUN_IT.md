# Bitácora de Run It

## 2026-09-24

### Servidor Ubuntu y endurecimiento

- Se agregó `deploy/bootstrap-ubuntu.sh` para instalar Docker, Node 22, nginx,
  systemd, SSH, Certbot y Cockpit en un host Ubuntu `amd64`.
- Cockpit queda enlazado únicamente a `127.0.0.1:9090`; el acceso remoto se
  realiza mediante túnel SSH y no se publica el puerto 9090.
- Nginx usa un bloque HTTP challenge-only antes de TLS; nunca enruta login/API
  en texto plano. Las plantillas HTTPS se validan y activan atómicamente.
- Redis usa AOF y volumen persistente; el compose fija `linux/amd64` y limita
  el tamaño de logs.
- El bootstrap crea bases separadas, comprueba la contraseña de Judge0, genera
  un backup, prueba su restauración y ejecuta smoke/E2E.
- Se elevate Node mínimo a 22.12 y se añadió typecheck/build SSR.
- El panel administrativo puede crear problemas en una instalacion limpia.
- Las sesiones Redis fallan cerradas; el readiness reporta su estado.
- Se elimino la emision global de codigo fuente en `submission:queued` y se
  reforzo la autorizacion de submissions, limites de lenguaje/tamano y salas
  Socket.io dinamicas.

## 2026-09-10

### Documentación de seguridad y gaps

- Reescrita la sección «Seguridad y producción»: estado resuelto en
  producción, gap de producto (alta de participantes bloquea el torneo) y
  limitaciones MVP aceptadas (sesiones/rate limit en memoria, códigos en
  texto plano, scoring de un solo test, `privileged` de Judge0).

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

- El rate limit de submissions sigue siendo local al proceso.
- Los codigos de acceso y `access_code` se almacenan en texto plano.
- El scoring MVP usa el primer caso de prueba.
- Judge0 requiere un entorno x86_64 o un servicio externo para produccion.
- Faltan pruebas de carga, alertas y rotacion automatica de backups.