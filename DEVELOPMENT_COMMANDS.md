# Comandos de desarrollo

Resumen operativo del entorno de desarrollo por ramas. La explicación
completa del diseño está en [LOCAL_CHANGES_CONFIG.md](LOCAL_CHANGES_CONFIG.md).
Los códigos de acceso y las credenciales de prueba están en
[CODIGOS_ACCESO.md](CODIGOS_ACCESO.md).

## Lo único que tienes que ejecutar tú

Es el único paso que pide `sudo`, porque `serverwewolf` no está en el grupo
`docker` (a propósito: `MIGRACION_SERVIDOR_RUN_IT.md:96-97`).

```bash
cd /home/serverwewolf/ServerRunIt/Run_it_Judge
sudo docker compose -p runit-dev -f docker-compose.dev.yml up -d
```

**Qué hace, en una línea:** levanta un Redis nuevo y desechable en
`127.0.0.1:6381`, solo para desarrollo.

**Qué levanta:** un contenedor `redis:7.2.4`. Uno solo. Nada más.

| Parte | Para qué |
| --- | --- |
| `sudo` | `serverwewolf` no está en el grupo `docker`; sin esto no hay acceso al socket de Docker |
| `-p runit-dev` | nombre de proyecto propio, para que no se mezcle con los contenedores de producción |
| `-f docker-compose.dev.yml` | usa el compose de desarrollo, no el `docker-compose.yml` de producción |
| `up -d` | crea y arranca en segundo plano |

**Por qué el Redis es obligatorio.** No es higiene, es una corrección de un
fallo real. El backend arranca siempre un worker de BullMQ sobre la cola de
nombre fijo `run-it-submissions` (`index.js:587`, `queue.js:10` y `queue.js:21`)
y no hay forma de desactivarlo. Si el backend de desarrollo compartiera el
Redis de producción, ese worker robaría las submissions en vuelo, y al buscar
el resultado en la base de desarrollo no lo encontraría (`index.js:597` corta
con `return null`): quedarían en `queued` para siempre, sin error en el log.

**Por qué es seguro:**

- Bind a `127.0.0.1:6381`, igual que el de producción en `6380`. Los dos son
  inalcanzables desde la red: ni por IP pública ni por Tailscale.
- Sin volumen y sin persistencia (`--save "" --appendonly no`): se recrea vacío
  en un segundo.
- `restart: "no"`: no vuelve solo tras un reboot, a diferencia del
  `restart: always` de producción.
- No toca Postgres, Judge0, nginx, systemd ni el Redis de producción.

**Para deshacerlo:**

```bash
sudo docker compose -p runit-dev -f docker-compose.dev.yml down
```

No hay volumen, así que `down` lo borra entero.

## Comandos que NO necesitan sudo

```bash
cd /home/serverwewolf/ServerRunIt/Run_it_Judge

deploy/dev-branch.sh bootstrap-db   # crear la base y el rol de desarrollo
deploy/dev-branch.sh up             # backend en background + frontend con HMR
deploy/dev-branch.sh restart        # reiniciar todo (tras un git checkout o pull)
deploy/dev-branch.sh status         # rama, puertos, proceso y aviso si está vencido
deploy/dev-branch.sh logs           # log del backend, en vivo
deploy/dev-branch.sh down           # detener el entorno completo
deploy/dev-branch.sh reset-db       # borrar la base y el rol de desarrollo

### Después de un `git checkout`, `git pull` o `git merge`

**Reiniciá.** El backend corre con `node --watch`, que reinicia el proceso al
cambiar un archivo, pero **se pierde los eventos que dispara git**: `git
checkout` reemplaza los archivos en vez de modificarlos, y el watcher a veces no
lo ve.

El síntoma es silencioso y por eso engañoso: `/health` sigue respondiendo 200 y
todo parece sano, pero el proceso ejecuta la versión anterior del código. Pasó
con los códigos de acceso, que seguían saliendo con el formato viejo de 22
caracteres sin que apareciera ningún error.

`status` compara el hash de los archivos del backend con el que se guardó al
arrancar, y avisa cuando el proceso no corresponde al código en disco:

```bash
deploy/dev-branch.sh status
```

El frontend con Vite no sufre esto: detecta los reemplazos de git sin problema.
```

`bootstrap-db` ya está hecho: la base `run_it_dev` y su rol existen. Opcional,
porque `up` los crea igual en el primer arranque.

## Flujo completo de una sesión de trabajo

**1. En el servidor, por SSH** — levanta el entorno:

```bash
cd /home/serverwewolf/ServerRunIt/Run_it_Judge
git switch <tu-rama>
deploy/dev-branch.sh up
```

Imprime la rama, los puertos y la base, y deja el frontend en primer plano con
HMR. `Ctrl-C` detiene ambos.

**2. En el Mac, terminal nueva** — el túnel:

```bash
ssh -NL 4000:127.0.0.1:4000 -L 5000:127.0.0.1:5000 serverwewolf@run-it-server.tail32f6e5.ts.net
```

Se deja abierta. Es lo que sostiene el acceso.

**3. En el navegador del Mac:**

| Qué | URL |
| --- | --- |
| Frontend | http://localhost:4000 |
| Backend health | http://localhost:5000/health |
| Backend readiness | http://localhost:5000/ready |
| Login dev | http://localhost:4000/login |

| Qué | Valor |
| --- | --- |
| Usuario | `devadmin` |
| Código | `dev-admin-dev` |

Definidos en `deploy/dev-branch.sh` como `DEV_ADMIN_USERNAME` y
`DEV_ADMIN_ACCESS_CODE`. Viven solo en la base `run_it_dev` y no se escriben
nunca en el archivo de secretos de producción.

## Comprobaciones

Todo debe escuchar solo en loopback. Si apareciera `0.0.0.0:4000` o
`100.99.72.24:4000`, el servicio sería alcanzable desde la red: páralo y revisa
el `--host`.

```bash
ss -lntp | grep -E ':(4000|5000)'
curl -s http://127.0.0.1:5000/ready
curl -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/login   # producción
```

## Si algo falla

| Síntoma | Causa |
| --- | --- |
| `El Redis de desarrollo no está levantado` | falta el comando `sudo` del principio |
| `El backend de desarrollo está vencido` | el código en disco cambió; `deploy/dev-branch.sh restart` |
| `El puerto 4000/5000 ya está ocupado` | hay otro dev corriendo; `deploy/dev-branch.sh down` |
| Los códigos salen con formato viejo (22 caracteres) | proceso vencido; `deploy/dev-branch.sh restart` |
| `La rama activa es 'main'` | es el entorno de producción; cambia de rama |
| `/ready` devuelve 503 en dev | el Redis dev no está arriba |
| El navegador no carga | se cayó el túnel SSH; reabre la terminal del paso 2 |
| Login falla | `ALLOWED_ORIGINS` del dev es `http://localhost:4000`; si entrás por otra URL, no coincide |

## Puertos

| Entorno | Frontend | Backend |
| --- | --- | --- |
| `main` (producción, systemd) | `127.0.0.1:3002` | `127.0.0.1:3001` |
| Desarrollo (`dev-branch.sh`) | `127.0.0.1:4000` | `127.0.0.1:5000` |

## Datos

| Recurso | Desarrollo | Producción | Aislado |
| --- | --- | --- | --- |
| PostgreSQL | base `run_it_dev` | base `run_it` | sí |
| Redis | `127.0.0.1:6381` | `127.0.0.1:6380` | sí |
| Judge0 | `127.0.0.1:2358` | `127.0.0.1:2358` | no, se comparte |
