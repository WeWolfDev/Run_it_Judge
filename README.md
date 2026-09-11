# Run It

Torneo de programación competitiva por rondas ("battle royale"): cada
participante es un caballo en una pista que avanza según el porcentaje de
casos de prueba resueltos. Judge0 ejecuta el código; el backend de Run It
orquesta usuarios, rondas, cola, ranking y eventos en tiempo real.

## Estructura

```text
run-it-backend/   API Fastify + Socket.io + worker BullMQ -> Judge0
frontend/         TanStack Start (React + TypeScript + SSR, preset node-server)
scripts/          Operación del host (respaldos de la base run_it)
docker-compose.yml  Judge0 1.13.1 + PostgreSQL + Redis (solo loopback)
```

## Documentación

| Documento | Contenido |
| --- | --- |
| [`RUN_IT.md`](RUN_IT.md) | Documento técnico completo: implementación, operación local, despliegue en producción, seguridad, bitácora y pendientes |
| [`frontend/README.md`](frontend/README.md) | Brief de diseño y contrato de UI de la pista |
| [`frontend/src/routes/README.md`](frontend/src/routes/README.md) | Convenciones de rutas TanStack Start |

## Arranque rápido (local)

Requisitos: Node.js 18+, Docker Compose v2, npm.

```bash
cp judge0.conf.example judge0.conf   # edita REDIS_PASSWORD y POSTGRES_PASSWORD
docker compose config -q && docker compose up -d

cd run-it-backend  && npm install && npm run dev   # :3000
cd frontend        && npm install && npm run dev   # :8080
```

Pista pública sin login: `http://localhost:8080/pista`. Accesos de prueba y
detalles completos en [`RUN_IT.md`](RUN_IT.md).

## Pruebas

```bash
cd run-it-backend && npm test
```

Suites con `node --test`: endpoints de salud, evaluación multi-test,
rate limit, cliente Judge0 (batch con base64 y fallback) y sesiones.

## Producción

Run It sirve en `https://runit.gelatina.lat` (Cloudflare → nginx TLS →
servicios en loopback) desde este mismo directorio en el host gelatina.lat.
Procedimiento, secretos, verificación y diagnóstico en
[`RUN_IT.md`](RUN_IT.md#despliegue-en-producción-gelatinalat).

Reglas de seguridad esenciales (detalladas en `RUN_IT.md`):

- Nunca versionar `judge0.conf` ni `run-it-backend/secrets`.
- Nunca `RUN_IT_SEED_DEMO=true` ni `docker compose down -v` en producción.
- Respaldo diario automático de la base `run_it`
  (`systemctl status run-it-backup.timer`).

> Nota: el frontend está conectado a Lovable; no reescribir el historial
> publicado del repositorio (ver `frontend/AGENTS.md`).