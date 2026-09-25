# Migracion de servidor de Run It

Guia para mover Run It a un servidor nuevo sin perder la base de datos, los secretos ni la configuracion de Judge0.

## 1. Arquitectura final

El dominio recomendado es `runit.gelatina.lat`.

```text
Internet
  |
  +--> nginx :80/:443
        |
        +--> frontend TanStack Start :3002 (127.0.0.1)
        +--> backend Fastify :3001 (127.0.0.1)
              |
              +--> PostgreSQL :5433 (Docker, solo local)
              +--> Redis :6380 (Docker, solo local)
              +--> Judge0 :2358 (Docker, solo local)
```

Bases de datos separadas y obligatorias:

- `judge0`: la usa internamente Judge0.
- `run_it`: la usa la aplicacion Run It.

No apuntar el backend a la base `judge0`: ambas aplicaciones tienen tablas con nombres iguales.

## 2. Datos que deben estar disponibles

Antes de empezar, confirmar:

- Acceso SSH con permisos de administrador.
- Servidor Linux `amd64`/`x86_64` recomendado para Judge0.
- Docker Engine y Docker Compose v2.
- Git, Node.js 22.12 o superior y npm. El frontend bloqueado por Vite 8, Nitro 3 y TanStack Start ya no es compatible con Node.js 18/20.
- nginx y certbot.
- Dominio y acceso al proveedor DNS.
- Al menos 20 GB libres para imagenes, logs y bases de datos.
- Una ventana de mantenimiento para detener escrituras durante el backup final.

No enviar contrasenas por chat. Generarlas directamente en el servidor y guardarlas en los archivos protegidos.

## 3. Preparar el servidor nuevo

Ejecutar como un usuario con `sudo`:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx certbot python3-certbot-nginx
```

Instalar Docker Engine y Compose v2 siguiendo la documentacion oficial de la distribucion. Verificar:

```bash
docker --version
docker compose version
node --version
npm --version
nginx -v
```

### Instalacion automatica reproducible

El repositorio incluye un bootstrap idempotente para Ubuntu 22.04 o posterior.
Desde el checkout ejecuta:

```bash
sudo bash deploy/bootstrap-ubuntu.sh
```

El script instala Docker, Compose, Node.js, nginx, Certbot, SSH y Cockpit; genera
los secretos sin mostrarlos; crea la base `run_it`; configura cgroup v2 para
Judge0; instala las unidades systemd de `deploy/systemd/`; configura Cockpit
solo en loopback; crea un backup inicial y ejecuta `deploy/smoke-test.sh`.

Variables opcionales:

```bash
sudo env RUN_IT_USER=serverwewolf \
  RUN_IT_ORIGIN=https://runit.gelatina.lat \
  RUN_IT_ENABLE_UFW=1 \
  bash deploy/bootstrap-ubuntu.sh
```

`RUN_IT_ENABLE_UFW=1` es opcional porque modifica reglas del firewall. Si se
activa, el script agrega 22, 80 y 443 sin cambiar la politica UFW existente;
esto evita cortar una sesion remota o una configuracion de red. Cockpit sigue
restringido a `127.0.0.1:9090` y no necesita una regla UFW de entrada.

El bootstrap no cambia DNS, no elimina volumenes Docker y respalda una
configuracion nginx existente que no reconozca. Si existe, este ultimo caso se
detiene en lugar de sobrescribirla. El registro queda en
`/var/log/run-it-bootstrap.log` y no imprime contrasenas.

El usuario de servicio no se agrega al grupo `docker` (membership equivaldria a
root). Ejecuta los comandos manuales de Docker con `sudo docker compose ...`.

Crear la carpeta de la aplicacion:

```bash
sudo mkdir -p /root/judge
sudo chown -R "$USER":"$USER" /root/judge
```

## 4. Copiar el codigo

Para una instalacion nueva:

```bash
git clone <URL_DEL_REPOSITORIO> /root/judge
cd /root/judge
git checkout main
git rev-parse HEAD
```

Para una migracion desde otro servidor, usar el mismo commit que estaba en produccion:

```bash
cd /root/judge
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout <COMMIT_PRODUCCION>
```

Guardar el hash mostrado. Debe coincidir con el commit validado en el servidor anterior.

## 5. Configurar Judge0, PostgreSQL y Redis

Crear el archivo de configuracion sin subirlo al repositorio:

```bash
cd /root/judge
cp judge0.conf.example judge0.conf
sudo chown 1000:999 judge0.conf
sudo chmod 440 judge0.conf
```

Editar `judge0.conf` y reemplazar los valores de ejemplo. Como minimo debe contener:

```dotenv
REDIS_HOST=redis
REDIS_PASSWORD=SECRETO_REDIS_UNICO
POSTGRES_HOST=db
POSTGRES_DB=judge0
POSTGRES_USER=judge0
POSTGRES_PASSWORD=SECRETO_POSTGRES_JUDGE0
COUNT=8
MAX_QUEUE_SIZE=100
```

Si el servidor usa cgroup v2 y Judge0 falla al iniciar por `--cg`, anadir tambien:

```dotenv
ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT=true
ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT=true
```

Validar y arrancar:

```bash
docker compose config -q
docker compose up -d db redis
# Esperar healthchecks de db y redis antes de continuar.
docker compose up -d server worker
docker compose ps
```

Los puertos Docker deben quedar ligados a loopback:

- Judge0: `127.0.0.1:2358`.
- PostgreSQL: `127.0.0.1:5433`.
- Redis: `127.0.0.1:6380`.

No ejecutar `docker compose down -v`: elimina los datos de PostgreSQL.

## 6. Crear o restaurar la base `run_it`

### Instalacion nueva

Crear el usuario y la base separada dentro del PostgreSQL de Docker. Sustituir los valores antes de ejecutar:

```bash
cd /root/judge
docker compose exec -T db psql -U judge0 -d postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'run_it') THEN
    CREATE ROLE run_it LOGIN PASSWORD 'CONTRASENA_RUN_IT';
  END IF;
END
$$;
SQL

docker compose exec -T db psql -U judge0 -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname = 'run_it'" | grep -q 1 || \
  docker compose exec -T db createdb -U judge0 -O run_it run_it
```

La contrasena debe ser la misma que se usara en `DATABASE_URL`.

### Restaurar desde el servidor anterior

En el servidor anterior, durante la ventana de mantenimiento:

```bash
cd /root/judge
docker compose exec -T db pg_dump -U judge0 -d run_it --format=custom > /root/run_it.backup
sha256sum /root/run_it.backup
```

Copiar el archivo al servidor nuevo por un canal seguro y verificar el hash. Despues de crear la base nueva:

```bash
cat /root/run_it.backup | docker compose exec -T db pg_restore \
  -U judge0 --role=run_it -d run_it \
  --clean --if-exists --no-owner --exit-on-error

# Verificar que el backend conserva la propiedad de sus objetos.
docker compose exec -T db psql -U run_it -d run_it -c '\dt'
```

Si la base no existe en el servidor anterior o el despliegue es nuevo, no hace falta restaurar datos: el backend crea el esquema al arrancar.

## 7. Configurar los secretos del backend

Crear `/root/judge/run-it-backend/secrets`:

```bash
cat > /root/judge/run-it-backend/secrets <<'EOF'
NODE_ENV=production
PORT=3001
DATABASE_URL=postgres://run_it:CONTRASENA_RUN_IT@127.0.0.1:5433/run_it
REDIS_HOST=127.0.0.1
REDIS_PORT=6380
REDIS_PASSWORD=SECRETO_REDIS_UNICO
JUDGE0_URL=http://127.0.0.1:2358
ALLOWED_ORIGINS=https://runit.gelatina.lat
SESSION_STORE=redis
SESSION_TTL_SECONDS=28800
ADMIN_USERNAME=admin
ADMIN_ACCESS_CODE=CODIGO_ADMIN_LARGO_Y_PRIVADO
RUN_IT_SEED_DEMO=false
SUBMISSION_CONCURRENCY=4
EOF
chmod 440 /root/judge/run-it-backend/secrets
```

Ajustar propietario y grupo para que el usuario del servicio pueda leerlo. Nunca guardar este archivo en Git.

Puntos que no se deben cambiar accidentalmente:

- `DATABASE_URL` termina en `/run_it`, no en `/judge0`.
- `REDIS_PORT` es `6380` porque es el puerto del host.
- `ALLOWED_ORIGINS` debe ser el origen HTTPS real, sin `*`.
- `RUN_IT_SEED_DEMO=false` en produccion.
- Si se migra la aplicacion, conservar `ADMIN_ACCESS_CODE` para mantener el acceso admin.

## 8. Instalar y probar las dependencias

```bash
cd /root/judge/run-it-backend
npm ci --omit=dev
npm test

cd /root/judge/frontend
npm ci
npm run typecheck
VITE_API_URL="" VITE_SOCKET_URL="/" npm run build
```

El build del frontend debe generar `.output/server/index.mjs`.

## 9. Crear los servicios systemd

Las unidades mantenidas en el repositorio son:

- `deploy/systemd/run-it-backend.service`.
- `deploy/systemd/run-it-frontend.service`.

El bootstrap las copia a `/etc/systemd/system/`, sustituye la ruta y el
usuario de servicio, y las activa. Ejecutan Node.js como usuario no root, con
archivos de sistema y home en solo lectura, temporales privados y restricciones
de namespaces. No repliques el ejemplo antiguo que usaba `User=root`.

Para instalarlas manualmente, sustituye los marcadores `@@APP_DIR@@`,
`@@APP_USER@@` y `@@APP_GROUP@@`; es preferible usar el bootstrap para evitar una
configuracion incompleta. Después:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now run-it-backend.service run-it-frontend.service
sudo systemctl status run-it-backend.service run-it-frontend.service --no-pager
```

Comprobaciones locales:

```bash
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3001/ready
curl -I http://127.0.0.1:3002/login
```

`/health` debe responder 200. `/ready` debe indicar base de datos, Redis y sesiones en estado `ok`.

## 10. Configurar nginx y HTTPS

Usar las plantillas versionadas:

- `deploy/nginx/runit-http.conf` para la primera validacion y el desafio ACME.
- `deploy/nginx/runit-https.conf` despues de que exista el certificado.

No activar el bloque TLS antes de crear el certificado: `nginx -t` fallaria
por rutas `ssl_certificate` inexistentes. El bootstrap selecciona
automaticamente HTTP cuando todavia no existe el certificado y selecciona TLS
en ejecuciones posteriores.

Configuracion manual recomendada:

```bash
cd /root/judge
sudo mkdir -p /var/www/html
sudo cp deploy/nginx/runit-http.conf /etc/nginx/sites-available/run-it
sudo sed -i 's/@@ORIGIN_HOST@@/runit.gelatina.lat/g' \
  /etc/nginx/sites-available/run-it
sudo ln -sfnT /etc/nginx/sites-available/run-it \
  /etc/nginx/sites-enabled/run-it
sudo nginx -t
sudo systemctl reload nginx

# HTTP-01 requiere que DNS/Cloudflare ya apunte el origen a este host.
# El vhost HTTP solo publica el challenge y devuelve 503 para toda la app.
sudo certbot certonly --webroot -w /var/www/html -d runit.gelatina.lat

sudo cp deploy/nginx/runit-https.conf /etc/nginx/sites-available/run-it
sudo sed -i 's/@@ORIGIN_HOST@@/runit.gelatina.lat/g' \
  /etc/nginx/sites-available/run-it
sudo nginx -t
sudo systemctl reload nginx
```

El bloque HTTP nunca enruta login, API ni Socket.io: solo permite el challenge
ACME y devuelve 503 para el resto. Asi, un corte de DNS temporal no degrada la
aplicacion a HTTP plano. Configurar el DNS `A` o `AAAA` para que
`runit.gelatina.lat` apunte al servidor nuevo antes de usar HTTP-01. Si se usa
Cloudflare, cambiar el origen correctamente y mantener el proxy DNS activo; los
puertos 80 y 443 siguen siendo los unicos puertos publicos de la aplicacion.

## 11. Cambio de servidor sin perder datos

1. Bajar el TTL del DNS a 300 segundos con antelacion.
2. Preparar el servidor nuevo y probarlo con `curl` localmente.
3. Detener el backend en el servidor anterior para impedir escrituras:
   `sudo systemctl stop run-it-backend`.
4. Hacer el backup final de `run_it` y copiarlo al servidor nuevo.
5. Restaurar la base, conservar los secretos y arrancar los servicios nuevos.
6. Cambiar el DNS al servidor nuevo.
7. Esperar la propagacion y ejecutar las pruebas publicas.
8. Mantener el servidor anterior apagado pero disponible durante el periodo de observacion.

Las sesiones guardadas en Redis deben migrarse junto con Redis si se quiere evitar que los usuarios tengan que iniciar sesion de nuevo. Si no se migra Redis, el sistema seguira funcionando, pero se producira un logout global.

## 12. Validacion funcional

Ejecutar:

```bash
curl -fsS https://runit.gelatina.lat/health
curl -fsS https://runit.gelatina.lat/ready
curl -fsSI https://runit.gelatina.lat/login
```

La prueba E2E completa se ejecuta en el servidor porque valida tambien Judge0,
Redis, Socket.IO y la base de datos. Lee el secreto admin sin imprimirlo, crea
un problema/ronda/participante temporal, comprueba `accepted` y el cierre, y
luego elimina sus datos:

```bash
cd /ruta/del/repositorio
sudo node deploy/e2e-test.cjs
```

Para apuntar la API al dominio publico en el mismo servidor:

```bash
sudo env RUN_IT_API_URL=https://runit.gelatina.lat \
  E2E_ALLOW_REMOTE=1 node deploy/e2e-test.cjs
```

Usar `E2E_KEEP_DATA=1` solo cuando se quiera conservar la prueba para
inspeccionarla manualmente.

Comprobar manualmente:

- HTTPS valido y redireccion de HTTP a HTTPS.
- Login del usuario `admin` con el codigo privado.
- Creacion de torneo o generacion de codigo desde `/admin`.
- Registro de un participante.
- Acceso publico a `/pista` sin iniciar sesion.
- Inicio, pausa y cierre de una ronda.
- Una submission ejecutada por Judge0 y reflejada en el ranking.
- Actualizaciones en tiempo real por Socket.io.
- Reinicio del backend sin perder sesiones si `SESSION_STORE=redis` esta activo.

## 13. Backups y restauracion

Crear el directorio de backups con permisos restrictivos:

```bash
sudo install -d -m 700 /var/backups/run-it
sudo bash -c '
  cd /root/judge || exit 1
  dump="/var/backups/run-it/run_it_$(date -u +%Y%m%dT%H%M%SZ).dump"
  docker compose exec -T db pg_dump -U judge0 -d run_it --format=custom > "$dump"
  chmod 600 "$dump"
  sha256sum "$dump" > "$dump.sha256"
  chmod 600 "$dump" "$dump.sha256"
  printf "Backup creado: %s\n" "$dump"
'
```

Conservar tambien una copia segura de:

- `judge0.conf`.
- `run-it-backend/secrets`.
- La configuracion nginx y systemd.
- El hash del commit desplegado.

Probar una restauracion periodicamente en una base temporal. No considerar un backup valido hasta haber comprobado que se puede restaurar.

## 14. Diagnostico

```bash
sudo systemctl status run-it-backend --no-pager
sudo systemctl status run-it-frontend --no-pager
sudo journalctl -u run-it-backend -n 100 --no-pager
sudo journalctl -u run-it-frontend -n 100 --no-pager
cd /root/judge
docker compose ps
docker compose logs --tail=100 server worker db redis
sudo nginx -t
sudo ss -lntp | grep -E ':(22|80|443|2358|3001|3002|5433|6380|9090)'
```

Problemas frecuentes:

- `/ready` falla: comprobar `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT` y las contrasenas.
- Judge0 no esta healthy: revisar `docker compose logs server worker` y la arquitectura del host.
- Frontend 502: comprobar que existe `.output/server/index.mjs` y que escucha en `127.0.0.1:3002`.
- Socket.io no actualiza: comprobar la ruta `/socket.io/` y los headers WebSocket de nginx.
- Login admin falla tras una migracion: comprobar que se restauro `run_it` y que `ADMIN_ACCESS_CODE` coincide con el usuario existente.
- Cockpit no conecta: comprobar `systemctl status cockpit.socket`, que `9090` escucha solo en `127.0.0.1` y que el tunel SSH sigue abierto.

## 15. Cockpit y acceso remoto seguro

El bootstrap instala `cockpit` y `cockpit-storaged`, habilita `cockpit.socket` y
añade este override. Ubuntu 26.04 ya no ofrece `cockpit-docker` en sus
repositorios oficiales; el plugin de contenedores no es necesario para
administrar el host y no se instala desde terceros automáticamente:

```ini
[Socket]
ListenStream=
ListenStream=127.0.0.1:9090
```

Asi Cockpit no escucha en la IP publica del servidor. Desde la computadora del
administrador crear un tunel SSH:

```bash
ssh -N -L 9090:127.0.0.1:9090 <usuario>@<IP-o-DNS-del-servidor>
```

Abrir `https://localhost:9090`, aceptar el certificado local de Cockpit e
iniciar sesion con un usuario Linux del servidor que tenga `sudo`. El plugin de
Containers permite observar Docker; para reiniciar contenedores se requiere
privilegio administrativo.

La maquina tambien debe ser alcanzable por SSH. Si esta en una red privada:

- Para acceso desde la misma LAN, usar su IP privada.
- Para acceso remoto, configurar un reenvio TCP del router al puerto 22 o usar
  una VPN.
- Con IPv6 publica, comprobar reglas del router, del ISP y del firewall antes
  de depender de ese camino.
- No abrir 9090 en el router. El tunel termina en el puerto 22.

Comprobaciones:

```bash
sudo systemctl status cockpit.socket --no-pager
sudo ss -lntp | grep ':9090'
# Debe mostrar 127.0.0.1:9090, no 0.0.0.0:9090 ni [::]:9090.
```

## 16. Rollback

Si el servidor nuevo falla:

1. Detener `run-it-backend` y `run-it-frontend` en el servidor nuevo para
   impedir nuevas escrituras.
2. Si el servidor nuevo ya recibio tráfico, crear un dump final de `run_it` y
   restaurarlo en el servidor anterior antes de reabrirlo.
3. Verificar la restauracion y el estado de la base anterior.
4. Volver el DNS al origen anterior.
5. Arrancar los servicios anteriores.
6. No borrar el volumen Docker ni el backup del servidor nuevo.
7. Investigar los logs y corregir antes de repetir el cambio.

Cambiar el DNS sin sincronizar los datos aceptados en el servidor nuevo puede
perder escrituras. No ejecutar `docker compose down -v` durante un rollback.

## 17. Entrega final

Devolver estos datos, sin contrasenas ni archivos de secretos:

```text
Dominio configurado: si/no
HTTPS valido: si/no
Commit desplegado: <hash>
Backend activo: si/no
Frontend activo: si/no
Judge0 y worker activos: si/no
PostgreSQL activo: si/no
Redis activo: si/no
Cockpit activo y restringido a loopback: si/no
Tunel SSH remoto a Cockpit probado: si/no
/health: HTTP <codigo>
/ready: HTTP <codigo>
Login admin probado: si/no
Registro de participante probado: si/no
Submission probada: si/no
Backup inicial realizado: si/no
Restauracion de backup probada: si/no
Rollback preparado: si/no
```

Resultado esperado: `https://runit.gelatina.lat` sirve la aplicacion y permite ejecutar una ronda completa de principio a fin.
