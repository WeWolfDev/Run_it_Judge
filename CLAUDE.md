# CLAUDE.md

Contexto operativo para Claude Code en este repositorio. Documento denso por
sections, sin explicaciones de fondo.

## 1. Visión general

**Run It** es una plataforma de torneos de programación competitiva por
eliminación. Los participantes compiten en rondas sucesivas; cada ronda cierra
cuando se llena el cupo de clasificados o se acaba el tiempo, y los que no
clasifican quedan eliminados. Gana el último en pie.

Metáfora visual: cada participante es un caballo que avanza en una pista según el
porcentaje de tests resueltos. Los "silks" son colores de acera.

### Stack

| Capa | Tecnología | Versión |
| --- | --- | --- |
| Runtime | Node.js | 22.22.1 (mínimo 22.12; Vite 8 y Nitro 3 no soportan 18/20) |
| Frontend | Vite + TanStack Start + React | 8.1.5 / 1.168.32 / 19.2.8 |
| Estilos | Tailwind CSS | 4.3.3 |
| SSR | Nitro (preset `node-server`) | 3.0.260603-beta |
| Backend | Fastify + Socket.io | 5.12.3 |
| Cola | BullMQ | 5.58.5 |
| Datos | PostgreSQL + Redis | 16.2 / 7.2.4 (Docker) |
| Ejecución de código | Judge0 | 1.13.1 (Docker) |
| Proxy | nginx + Tailscale Funnel | — |

No hay C++ ni Python. Todo el código propio es JavaScript (backend, CommonJS) y
TypeScript/TSX (frontend, ESM).

### Arquitectura

```text
Internet
  |
  +--> nginx :80/:443  (TLS Let's Encrypt)
  |       |
  |       +--> frontend TanStack Start :3002  (127.0.0.1, systemd)
  |       +--> backend Fastify + Socket.io :3001  (127.0.0.1, systemd)
  |             |
  |             +--> PostgreSQL :5433  (Docker, solo loopback)
  |             +--> Redis :6380  (Docker, solo loopback)
  |             +--> Judge0 :2358  (Docker, solo loopback)
  |
  +--> Tailscale Funnel --> 127.0.0.1:8080 --> nginx --> :3002/:3001
```

Bases de datos **separadas y obligatorias**: `judge0` la usa Judge0 internamente,
`run_it` la usa la aplicación. No apuntar el backend a `judge0`: ambas
aplicaciones tienen tablas con nombres iguales.

Módulos: `tournaments` → `rounds` → `submissions`. Un participante se une a una
ronda, envía código, BullMQ lo encola, el worker lo manda a Judge0 y el resultado
vuelve por Socket.io.

### Flujo de un torneo

Un torneo tiene N rondas y termina cuando queda un solo clasificado.

```text
1. Crear torneo y ronda 1        POST /tournaments + POST /rounds
2. Generar PINs                  POST /access-codes/generate
3. Registrarse con un PIN         POST /auth/register
4. Iniciar la ronda               POST /rounds/:id/start
5. Unirse a la ronda              POST /rounds/:id/participants/join
6. Cerrar la ronda                POST /rounds/:id/close
7. Ver quién clasificó            GET  /rounds/:id/next
8. Crear la ronda siguiente       POST /rounds/:id/next
   → vuelve al paso 4 con la nueva ronda (sin el 5: ya están inscriptos)
```

`POST /rounds` crea **solo la primera** ronda de un torneo: si ya tiene alguna,
responde `409`. Las siguientes salen del paso 8, que inscribe a los
clasificados; una creada a mano tendría el roster vacío.

**Plan de rondas.** `PUT /tournaments/:id/plan` crea o actualiza todas las
rondas pendientes de una vez (número, `difficulty`, problema, cupo, tiempo) y
borra las pendientes sin inscriptos que ya no están en el plan; las jugadas no
se tocan. Las siguientes quedan con el roster vacío: el paso 8 las **llena** en
vez de rechazarlas (`existing.planned` en `GET /rounds/:id/next`). Hasta
entonces `/start` las rechaza por falta de roster.

**Sala de espera.** Sin ronda activa, `GET /public/rounds/upcoming` devuelve la
ronda pendiente que el participante espera; se inscribe en la primera ronda
antes de que empiece (el join ya admite `pending`).

**Quién entra a una ronda.** En la primera ronda de un torneo el participante
se inscribe solo (paso 5). En las siguientes solo entra quien está en el roster
que armó el paso 8. El criterio es uno solo, `roundMember()` (roster +
`participants.status = 'active'`), y lo usan el join HTTP y el socket
(`canAccessSocketRound`). No separarlos: si uno deja pasar y el otro no, el
participante entra a la ronda y no ve nada.

**Cuándo inicia una ronda.** `POST /rounds/:id/start` solo pasa si la ronda
está `pending`, el torneo no está `finished`, no hay rondas anteriores del
torneo sin cerrar (`closing` cuenta como abierta) y, si no es la primera, tiene
roster. Todo es condición del mismo `UPDATE`, así dos clics simultáneos no
pasan los dos. El motivo del rechazo sale de `startBlockReason()`, el mismo
texto que `GET /tournaments/:id/rounds` expone en `start_blocked_reason`.
Crear una ronda no la inicia: el panel la inicia desde "Progreso del torneo".

**Casos de un problema.** Se leen cuando corre el job, no cuando se envía.
`PUT /problems/:id` rechaza con `409` un cambio de casos (incluido `is_sample`)
mientras una ronda `active` o `closing` use el problema; nombre, enunciado y
dificultad se pueden editar siempre. `GET /problems/:id/full` (admin) es el
único endpoint que devuelve los casos.

El paso 7 devuelve la vista previa: número de ronda, clasificados con su nombre
y su ranking, y si se puede crear. El paso 8 los inscribe ya en la ronda nueva.
Rechaza con `409` si la ronda no está cerrada, si el torneo ya terminó, si queda
un solo clasificado o si la ronda siguiente ya existe.

El número de la ronda siguiente es `round_number + 1` de la que se acaba de
cerrar, **no** `MAX(round_number) + 1`. Con el `MAX` el chequeo de "¿ya existe?"
es vacío, porque ese número por definición no existe.

`rounds` tiene `UNIQUE (tournament_id, round_number)`. El panel reusa el torneo
con el mismo nombre mientras no esté `finished`; si ya tiene rondas, crear otra
desde "Configurar ronda" da el `409` de arriba. Un torneo `finished` no se
reusa, así que un evento nuevo con el mismo nombre arranca uno nuevo.

**Las rondas se cierran solas.** Hay un `setInterval` de 1 segundo que busca
rondas `active` con `ends_at <= now()` y las cierra.

### Puertos

| Entorno | Frontend | Backend | Quién levanta |
| --- | --- | --- | --- |
| Producción | `127.0.0.1:3002` | `127.0.0.1:3001` | systemd |
| Desarrollo | `127.0.0.1:4000` | `127.0.0.1:5000` | `deploy/dev-branch.sh` |

`main` es producción. Cualquier otra rama es desarrollo, con puertos propios y
base `run_it_dev`.

## 2. Flujo de trabajo y comandos

### Desarrollo (todo en `deploy/dev-branch.sh`)

```bash
# Una vez por máquina, único paso con sudo
sudo docker compose -p runit-dev -f docker-compose.dev.yml up -d

# Sesión de trabajo
git switch <rama>
deploy/dev-branch.sh up          # backend en background + frontend con HMR
deploy/dev-branch.sh restart     # tras un git checkout/pull/merge
deploy/dev-branch.sh status      # avisa si el proceso quedó vencido
deploy/dev-branch.sh logs
deploy/dev-branch.sh down
deploy/dev-branch.sh bootstrap-db  # crea base y rol, sin sudo
```

Desde el Mac, el acceso va por túnel SSH:

```bash
ssh -NL 4000:127.0.0.1:4000 -L 5000:127.0.0.1:5000 serverwewolf@runit-server
```

La terminal del túnel se deja abierta. Sin ella el navegador no carga.

### Verificaciones

```bash
cd frontend
npm run typecheck        # tsc --noEmit
npm run lint             # eslint, debe dar 0 errores
npm run format           # prettier --write .  (reescribe, usarlo con cuidado)

cd ../run-it-backend
npm test                 # node --test; las suites *.e2e.test.js se saltean
RUN_IT_JUDGE_E2E=1 node --test test/judge.e2e.test.js    # Judge0 real, backend dev
RUN_IT_ROUNDS_E2E=1 node --test test/rounds.e2e.test.js  # rondas y problemas, backend dev
```

`npm run lint` admite 6 warnings de `react-refresh/only-export-components` que
son preexistentes. Cualquier error distinto es tuyo.

No hay CI. Estas verificaciones son manuales y hay que correrlas antes de
commitear.

### Producción

Solo por el procedimiento de `MIGRACION_SERVIDOR_RUN_IT.md` (sección 18 para
actualizar). Resumen: backup, chequeo previo de solo lectura,
`git checkout main && git pull`, `npm ci`, build con `VITE_API_URL=""`, y
`systemctl restart` de uno en uno: primero el backend, después el frontend.

```bash
# El build de producción REQUIERE estos flags
VITE_API_URL="" VITE_SOCKET_URL="/" npm run build
```

### Smoke y E2E

```bash
sudo bash deploy/smoke-test.sh
sudo node deploy/e2e-test.cjs
sudo env RUN_IT_API_URL=https://<host> E2E_ALLOW_REMOTE=1 node deploy/e2e-test.cjs
```

## 3. Estructura

```text
frontend/            App TanStack Start
  src/routes/        Rutas: login, admin, participante, pista, reglas, __root
  src/components/    AdminPanel, RaceTrack, ParticipantView, ui/ (shadcn)
  src/lib/api.ts     Cliente HTTP. VITE_API_URL="" = mismo origen
  src/lib/runit.ts   Tipos de eventos y cliente de Socket.io
  vite.config.ts     Wrapper de @lovable.dev/vite-tanstack-config
  .output/           Build SSR. Lo sirve systemd en :3002. NO versionado

run-it-backend/      API Fastify
  index.js           1091 líneas: rutas, auth, rondas, scoring, sockets. Sin tipos
  db.js              Pool de Postgres, initDb(), bootstrap de rol y base
  queue.js           BullMQ: Queue + Worker sobre "run-it-submissions"
  session-store.js   Sesiones en Redis o memoria
  judge0-client.js   Cliente de Judge0
  schema.sql         Schema aplicado por initDb() en cada arranque
  test/              3 tests. DB-free, con fastify.inject()
  secrets            Variables de producción. root-only, chmod 440. NUNCA versionar

deploy/              Scripts de operación
  dev-branch.sh      Entorno de desarrollo aislado por rama
  bootstrap-ubuntu.sh Instalador idempotente de Ubuntu
  backup-run-it.sh   Dump verificado de run_it
  smoke-test.sh, e2e-test.cjs
  systemd/           Unidades de servicio y timer de backup
  nginx/             Plantillas de vhost: http, https, tailscale
  tailscale/         Publicación gratuita por Funnel

docker-compose.yml       Producción: Judge0, Postgres, Redis
docker-compose.dev.yml   Redis efímero de desarrollo (:6381)
judge0.conf              Secretos de Judge0. NO versionar
```

`schema.sql` se aplica en cada arranque con `CREATE TABLE IF NOT EXISTS` y
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Las migraciones son idempotentes y
deben seguir siéndolo.

## 4. Reglas críticas

### Estilo

- Frontend: TypeScript, 2 espacios, comillas dobles, punto y coma, ancho 100
  (según `.prettierrc`). Más largo gana: `1000 < 1000n`.
- Backend: JavaScript CommonJS, tabulaciones, comillas simples, punto y coma.
- Todo el texto de la interfaz y los comentarios, en español.
- El backend **no** usa punto y coma al final de la última línea de un bloque.
- Sin dependencias nuevas sin justificar. Redis, Postgres, Socket.io y
  `crypto` (built-in) ya cubren lo necesario.

### Aislamiento y seguridad

- **Nunca apuntar el backend a la base `judge0`.** Colisión de tablas.
- **Nunca compartir Redis entre desarrollo y producción.** El backend siempre
  arranca un worker de BullMQ sobre la cola de nombre fijo
  `run-it-submissions` (`index.js:899`, `queue.js:10`) y no hay flag para
  desactivarlo. Un worker de desarrollo robaría submissions de producción y
  `index.js` las dejaría en `queued` para siempre, sin error en el log.
- `serverwewolf` **no** está en el grupo `docker` a propósito. Todo
  `docker compose` lleva `sudo`.
- Los puertos de desarrollo escuchan solo en `127.0.0.1`. El config de Lovable
  impone `host: "::"` y `port: 8080`
  (`@lovable.dev/vite-tanstack-config/dist/index.js:1245-1248`), por eso el
  script pasa `--host 127.0.0.1` por CLI, que tiene prioridad sobre el archivo.
- No modificar `/etc/systemd/system/`, `/etc/nginx/`, reglas de firewall ni
  `ufw` sin pedido explícito.
- No tocar `judge0.conf` ni `run-it-backend/secrets`. Son root-only y no se
  versionan.
- No imprimir contraseñas en logs, commits ni chat.

### VITE_* y `.env.local`

Vite carga `.env.local` **también en modo production**
(`node.js:5661-5666`). Un `VITE_API_URL` de desarrollo en ese archivo
contaminaría el build de producción. Por eso las variables viajan por
`process.env`, que sobrescribe a los archivos (`node.js:5697`). No crear
`.env.local` con variables `VITE_*`.

### Git

Ramas: `main` es producción y solo recibe merge vía PR. Cualquier otra rama es
desarrollo.

Mensajes en Conventional Commits, en inglés, imperativo y en minúsculas:

```text
feat: add access codes with per-tournament expiry
fix: detect stale dev backend after git checkout
docs: document the tunnel SSH flow
chore: add restart subcommand
style: apply prettier formatting
refactor: extract ranking query
test: cover round close
perf: add index on submissions
```

Tipos válidos: `feat`, `fix`, `docs`, `chore`, `style`, `refactor`, `test`,
`perf`.

**Restricción de `frontend/AGENTS.md`:** el proyecto está conectado a Lovable. No
reescribir historia publicada. Nada de `force push`, `rebase`, `amend` ni `squash`
sobre commits ya subidos. Los pushes a la rama conectada se sincronizan a Lovable,
así que la rama debe quedar siempre en estado funcional. Para traer `main` a una
rama ya publicada, usar `git merge origin/main`, nunca rebase.

### Pruebas

`npm test` corre `node --test` sobre `run-it-backend/test/`. Los tests existentes
usan `fastify.inject()` y `SESSION_STORE=memory`, sin tocar la base.

Todo test nuevo debe ser DB-free o usar una base propia. No apuntar nunca a
`run_it`.

## 5. Infraestructura

### Servidor

- Ubuntu, `x86_64`. **Judge0 requiere `linux/amd64` y `privileged: true`.** En
  Apple Silicon el sandbox no funciona y las ejecuciones reales fallan.
- systemd: `run-it-backend.service` y `run-it-frontend.service`, usuario no root,
  con `ProtectSystem=strict`, `PrivateTmp`, `IPAddressDeny=any` +
  `IPAddressAllow=localhost`.
- `run-it-backup.timer` corre a las 03:15 con 15 min de jitter. Dump en
  `/var/backups/run-it`, retención 14 días, con `sha256`.

### Rutas de red

Solo `22`, `80` y `443` son públicos. Todo lo demás en loopback: `2358` Judge0,
`3001`/`3002` app, `3003`/`5433` Postgres, `3004`/`6380` Redis, `6381` Redis dev,
`8080` proxy de Funnel, `9090` Cockpit.

Tailscale Funnel publica `https://run-it-server.tail32f6e5.ts.net` hacia
`127.0.0.1:8080`. Es **internet público**, no tailnet. Para exponer algo solo a la
tailnet usar `tailscale serve`, nunca `funnel`.

Cockpit escucha solo en `127.0.0.1:9090`; el acceso remoto es por túnel SSH.

### El checkout del servidor es producción

`/home/serverwewolf/ServerRunIt/Run_it_Judge` es el `WorkingDirectory` de los dos
servicios. El checkout está en la rama que se deployó.

- `npm run build` ahí **reescribe el `.output` que está sirviendo tráfico**.
- Un `git checkout` cambia el código fuente, no el build. Producción no se
  entera hasta que alguien compila y reinicia.
- Para trabajar en una rama sin tocar producción, usar `git worktree`.

### Trampa conocida: node --watch

`dev-branch.sh` lanza el backend con `node --watch index.js`. Reinicia el
proceso al cambiar un archivo, pero **se pierde los eventos de inotify que
dispara git**, porque `git checkout` reemplaza archivos en vez de modificarlos.

El síntoma es silencioso: `/health` responde 200 y todo parece sano, pero el
proceso ejecuta la versión anterior. **Después de un `git checkout`, `git pull` o
`git merge`, correr `deploy/dev-branch.sh restart`.** `status` detecta y avisa.

El frontend con Vite no sufre esto.

### Documentos de referencia

| Archivo | Contenido |
| --- | --- |
| `MIGRACION_SERVIDOR_RUN_IT.md` | Migración de servidor, deploy, rollback, diagnóstico |
| `BACKEND_RUN_IT.md` | API, variables de entorno, flujo de alta, limitaciones |
| `DEVELOPMENT_COMMANDS.md` | Entorno de desarrollo, túnel SSH, credenciales de prueba |
| `CODIGOS_ACCESO.md` | Códigos de acceso temporales y sus estados |
| `LOCAL_CHANGES_CONFIG.md` | Por qué el desarrollo está aislado de `main` |
| `CHANGELOG_RUN_IT.md` | Bitácora y pendientes conocidos |

## Pendientes conocidos

Ordenados por impacto. No están resueltos.

**Backend**

- `submissionRate` (`index.js:16`) es un `Map()` en memoria: se reinicia con el
  proceso y no escala a varias instancias. Migrar a Redis.
- `GET /public/rounds/active` (`index.js:728`) expone `p.statement`. Con un solo
  test visible, el `expected` es legible antes de enviar código.
- Falta el evento `round:closing_soon` que promete `frontend/README.md`.
- `users.access_code` en texto plano. El dilema: hashearlo impide recuperar la
  lista que el organizador repartió.
- El manejador global de errores solo traduce `22P02` (un id que no es UUID)
  a `400`. Cada ruta sigue capturando sus propios errores de Postgres: sin eso
  un `23505` sale como un 500 crudo. Ver `POST /rounds` como referencia.

**Frontend**

- `ParticipantView` carga el enunciado al montar: si el admin lo corrige con la
  ronda en curso, el participante lo ve al recargar o reconectarse.
- Sin estados de carga ni de error en las rutas.
- 6 warnings de `react-refresh` degradan el HMR a full reload.

**Transversal**

- No hay CI. Por eso el formato acumuló 108 errores en varios commits.
- Los tests de rondas y del juez son e2e contra el backend dev y no corren en
  `npm test`. Nada cubre auth ni códigos.
- `index.js` son más de 1400 líneas de JavaScript sin tipar.
- Sin métricas ni alertas. Judge0 caído se nota solo si alguien mira `/ready`.
- Sin pruebas de carga. Con `COUNT=8` en `judge0.conf` no se sabe cuántos
  concurrentes aguanta.
