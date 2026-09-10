# Bitácora de Run It

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