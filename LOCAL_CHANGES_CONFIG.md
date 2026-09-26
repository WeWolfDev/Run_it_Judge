# Entorno de desarrollo aislado por rama

Este documento explica cómo trabajar en una rama de desarrollo **sin tocar el
entorno de `main`**, que es el que está sirviendo producción en este servidor.

## 1. Para qué existe

`main` en este servidor no es un checkout cualquiera: es el directorio de trabajo
de los dos servicios de systemd.

```
/etc/systemd/system/run-it-frontend.service
  WorkingDirectory=/home/serverwewolf/ServerRunIt/Run_it_Judge/frontend
  ExecStart=.../frontend/.output/server/index.mjs      -> 127.0.0.1:3002

/etc/systemd/system/run-it-backend.service
  WorkingDirectory=/home/serverwewolf/ServerRunIt/Run_it_Judge/run-it-backend
  ExecStart=.../run-it-backend/index.js                -> 127.0.0.1:3001
```

Si levantáramos un entorno de desarrollo con los puertos de producción, el
proceso de `npm run dev` se pelearía con el de systemd, y cualquier
`npm run build` reescribiría el `.output` que está sirviendo tráfico en ese
momento. Este entorno usa otros puertos y otra base de datos para que eso no
pueda pasar.

## 2. Cómo se asignan los puertos

La asignación depende de la rama activa. El script la decide al arrancar, no
hay archivos que editar ni que mantener sincronizados.

| Rama activa | Frontend | Backend | Quién los levanta |
| --- | --- | --- | --- |
| `main` | `127.0.0.1:3002` | `127.0.0.1:3001` | systemd |
| Cualquier otra | `127.0.0.1:4000` | `127.0.0.1:5000` | `deploy/dev-branch.sh` |

En `main`, `deploy/dev-branch.sh up` se niega a arrancar y lo dice. No es una
sugerencia: es un `exit 1` deliberado, para que nadie confundan el entorno de
desarrollo con el de producción.

Si 4000 o 5000 estuvieran ocupados:

```bash
RUN_IT_DEV_FRONTEND_PORT=4100 RUN_IT_DEV_BACKEND_PORT=5100 deploy/dev-branch.sh up
```

### Por qué los puertos por variable de entorno no alcanzaban

El frontend no lee el puerto de ninguna variable. El config de Lovable lo
impone:

```js
// @lovable.dev/vite-tanstack-config/dist/index.js:1245-1248
} else config = mergeConfig({ server: { host: "::", port: 8080 } }, config);
```

Ese `host: "::"` significa que un `npm run dev` a secas escucharía en **todas**
las interfaces, incluida la IP de Tailscale del servidor. Por eso el script
pasa los valores por CLI, que tiene prioridad sobre el archivo de config:

```bash
npm run dev -- --port 4000 --host 127.0.0.1
```

El backend sí lee `PORT`, pero ya es seguro por construcción: `index.js:568`
tiene `host: '127.0.0.1'` fijo, sin variable que lo cambie.

### Por qué no hay `.env.local` ni hook de git

Un `.env.local` en `frontend/` habría contaminado el build de producción. Vite
carga ese archivo **también en modo production**:

```js
// vite/dist/node/chunks/node.js:5661-5666
return [`.env`, `.env.local`, `.env.${mode}`, `.env.${mode}.local`] ...
```

Un `npm run build` a secas se comería un `VITE_API_URL` de desarrollo y lo
hornearía dentro del `.output`. Hay una red de seguridad —`process.env`
sobrescribe a los archivos (línea 5697)— pero dependería de que nadie olvide
los flags del build documentado. Por eso las variables viajan por `process.env`
desde el script, que gana siempre.

El hook `post-checkout` se descartó porque no puede inyectar variables en el
momento del arranque: solo puede escribir archivos, que es justamente lo que
acabo de descartar.

## 3. Qué queda aislado y qué se comparte

| Recurso | Desarrollo | Producción | Aislado |
| --- | --- | --- | --- |
| PostgreSQL | base `run_it_dev`, rol `run_it_dev` | base `run_it` | sí |
| Redis | efímero en `127.0.0.1:6381` | `127.0.0.1:6380` | sí |
| Judge0 | `127.0.0.1:2358` | `127.0.0.1:2358` | **no, se comparte** |
| Sesiones | Redis de desarrollo | Redis de producción | sí |
| Cola BullMQ | Redis de desarrollo | Redis de producción | sí |

Judge0 se comparte a propósito: para Run It es un servicio de ejecución sin
estado, solo devuelve resultados por token. El único coste es que las
submissions de desarrollo compiten por los slots del worker, y por eso el
script arranca el backend con `SUBMISSION_CONCURRENCY=1`.

### El Redis de desarrollo no es opcional

No es una medida de higiene, es una corrección de un fallo real. El backend
arranca **siempre** un worker de BullMQ, sin excepción:

```js
// index.js:587
const submissionWorker = startSubmissionWorker(async ({ submissionId, result, token }) => {
```

sobre una cola de nombre fijo, sin prefijo ni flag para desactivarlo:

```js
// queue.js:10 y queue.js:21
new Queue('run-it-submissions', { connection })
new Worker('run-it-submissions', ...)
```

BullMQ reparte los jobs entre todos los workers registrados en esa cola. Si el
backend de desarrollo apuntara al Redis de producción, su worker robaría las
submissions en vuelo de producción, y al ir a escribir el resultado haría el
`SELECT` contra la base de desarrollo, donde esa fila no existe:

```js
// index.js:597
if (!submissionRow.rowCount || submissionRow.verdict !== 'queued') return null;
```

Corta ahí, el job termina "correctamente", y la submission de producción se
queda en `queued` para siempre. Sin error en el log, sin aviso. Por eso
`deploy/dev-branch.sh` **se niega a arrancar** si detecta `REDIS_PORT=6380` o
una base llamada `run_it`.

## 4. Cómo levantar los servicios en el servidor

### 4.1 Una sola vez por máquina

El Redis de desarrollo es un contenedor efímero, sin volumen y sin persistencia.
Se recrea vacío en un segundo:

```bash
cd /home/serverwewolf/ServerRunIt/Run_it_Judge
sudo docker compose -p runit-dev -f docker-compose.dev.yml up -d
```

El `-p runit-dev` lo mantiene separado del compose de producción. Para
detenerlo:

```bash
sudo docker compose -p runit-dev -f docker-compose.dev.yml down
```

### 4.2 Cada vez que quieras trabajar

```bash
cd /home/serverwewolf/ServerRunIt/Run_it_Judge
git switch <tu-rama>
deploy/dev-branch.sh up
```

El script imprime la rama, los puertos y la base que va a usar, levanta el
backend en segundo plano, espera a que `/health` responda y después deja el
frontend en primer plano con HMR. `Ctrl-C` detiene ambos.

La base y el rol de desarrollo se crean solos en el primer arranque: el backend
usa `DATABASE_ADMIN_URL` para hacer bootstrap (db.js:13-45) y aplica
`schema.sql` (db.js:66-70). No hay migraciones que aplicar a mano.

Otros subcomandos:

```bash
deploy/dev-branch.sh status        # rama, puertos y proceso del backend
deploy/dev-branch.sh logs          # log del backend, en vivo
deploy/dev-branch.sh down          # detener el backend
deploy/dev-branch.sh reset-db      # borrar la base y el rol de desarrollo
```

### 4.3 Si prefieres un worktree

Es lo más seguro cuando trabajas en el backend, porque los procesos de systemd
y tu entorno de desarrollo quedan con directorios distintos. `main` ya está
checkouteado en el checkout principal, así que un worktree tiene que ir en otra
rama:

```bash
git worktree add -b mi-rama /home/serverwewolf/preview-mi-rama main
cd /home/serverwewolf/preview-mi-rama
npm --prefix frontend ci
deploy/dev-branch.sh up
```

Los puertos son los mismos 4000/5000, así que solo puede correr un entorno de
desarrollo a la vez. El script lo comprueba antes de arrancar y avisa.

## 5. SSH Port Forwarding: cómo acceder desde tu computadora

### Qué es

Un túnel SSH reenvía un puerto de tu computadora al mismo puerto del servidor,
saltando por la conexión SSH. El tráfico viaja cifrado dentro de esa conexión.

```
Tu Mac (localhost:4000)
   │
   │  conexión SSH cifrada ──────────────►  servidor (127.0.0.1:4000)
   │                                          ↑
   └── el navegador no sabe nada de esto ──────┘
```

Lo que cambia con esto es **dónde escucha el servicio**. El frontend de
desarrollo escucha en `127.0.0.1:4000` del servidor, y `127.0.0.1` significa
"solo este servidor, nadie más". El túnel no publica nada: el navegador de tu
Mac cree que está hablando con su propio `localhost:4000`, y en realidad está
hablando con el puerto del servidor a través del túnel.

La diferencia con abrir el puerto:

| | Túnel SSH | Puerto abierto |
| --- | --- | --- |
| Quién alcanza el servicio | solo quien tiene la sesión SSH | cualquiera que llegue a la IP |
| Cifrado | el de SSH, extremo a extremo | depende de la capa de arriba |
| Regla de firewall | ninguna | hay que abrirla y acordarse de cerrarla |
| Al cerrar la terminal | desaparece | sigue ahí |

Por eso el script fuerza `--host 127.0.0.1` y por eso **no** hay que abrir nada
en `ufw`. El puerto 4000 nunca es alcanzable desde la red, ni desde la IP
pública ni desde la tailnet de Tailscale.

### 5.1 Paso a paso

**Paso 1 — abre una terminal nueva en tu Mac** (no en el servidor) y ejecuta:

```bash
ssh -NL 4000:127.0.0.1:4000 -L 5000:127.0.0.1:5000 serverwewolf@100.99.72.24
```

El desglose:

| Parte | Significado |
| --- | --- |
| `-N` | no abre sesión de shell, solo reenvía puertos |
| `-L 4000:127.0.0.1:4000` | de tu `localhost:4000` al `127.0.0.1:4000` del servidor |
| `-L 5000:127.0.0.1:5000` | igual para el backend |

En este servidor Tailscale ya está activo, así que también funciona por nombre
de MagicDNS en vez de la IP:

```bash
ssh -NL 4000:127.0.0.1:4000 -L 5000:127.0.0.1:5000 serverwewolf@runit-server
```

**Paso 2 — deja esa terminal abierta.** Es la que sostiene el túnel. Si la
cierras, el túnel se cae y el navegador dejará de cargar.

**Paso 3 — en el navegador de tu Mac, abre:**

| Qué | URL |
| --- | --- |
| Frontend (esta es la que usas) | http://localhost:4000 |
| Backend, health | http://localhost:5000/health |
| Backend, readiness | http://localhost:5000/ready |
| Login del admin de desarrollo | http://localhost:4000/login |

El login de desarrollo es con el usuario `devadmin` y el código
`dev-codigo-no-usar-en-produccion`. La pista pública está en
http://localhost:4000/pista y con `RUN_IT_SEED_DEMO=true` ya viene con un
problema y un participante de ejemplo.

### 5.2 Comprobación de que el aislamiento aguanta

En el servidor, con el entorno de desarrollo corriendo:

```bash
ss -lntp | grep -E ':(4000|5000)'
```

Debe mostrar `127.0.0.1:4000` y `127.0.0.1:5000`, y nada más. Si apareciera
`0.0.0.0:4000` o `100.99.72.24:4000`, el servicio estaría alcanzable desde la
red y habría que parar y revisar el `--host`.

Y para confirmar que el frontend de desarrollo y el de producción son
servicios distintos:

```bash
curl -o /dev/null -w "dev      %{http_code}\n" http://127.0.0.1:4000/login
curl -o /dev/null -w "prod     %{http_code}\n" http://127.0.0.1:3002/login
curl -s http://127.0.0.1:5000/ready
```

## 6. Antes de commitear en `main`

`main` es el entorno de producción y solo se despliega con el procedimiento de
`MIGRACION_SERVIDOR_RUN_IT.md`. Si tu rama ya está lista:

```bash
cd frontend
npm run lint
npm run typecheck
cd ../run-it-backend
npm test
```

`npm run lint` y `npm run typecheck` no escriben nada. **`npm run build` sí
escribe `.output`**, que es el artefacto que sirve el systemd en `:3002`: no lo
ejecutes en el checkout principal salvo que sea el deploy, y con las variables
correctas:

```bash
VITE_API_URL="" VITE_SOCKET_URL="/" npm run build
```
