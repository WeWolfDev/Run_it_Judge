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
- Git, Node.js 18 o superior y npm.
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
chmod 440 judge0.conf
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
docker compose up -d
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
  -U judge0 -d run_it --clean --if-exists --no-owner
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
npm run lint
npm run build
```

El build del frontend debe generar `.output/server/index.mjs`.

## 9. Crear los servicios systemd

Crear `/etc/systemd/system/run-it-backend.service`:

```ini
[Unit]
Description=Run It backend
After=docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/root/judge/run-it-backend
EnvironmentFile=/root/judge/run-it-backend/secrets
ExecStart=/usr/bin/node /root/judge/run-it-backend/index.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

Crear `/etc/systemd/system/run-it-frontend.service`:

```ini
[Unit]
Description=Run It frontend
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/judge/frontend
Environment=NODE_ENV=production
Environment=PORT=3002
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node /root/judge/frontend/.output/server/index.mjs
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

Activar ambos servicios:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now run-it-backend run-it-frontend
sudo systemctl status run-it-backend run-it-frontend --no-pager
```

Comprobaciones locales:

```bash
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3001/ready
curl -I http://127.0.0.1:3002/login
```

`/health` debe responder 200. `/ready` debe indicar base de datos y Redis en estado `ok`.

## 10. Configurar nginx y HTTPS

Crear `/etc/nginx/sites-available/runit.gelatina.lat`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name runit.gelatina.lat;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name runit.gelatina.lat;

    ssl_certificate /etc/letsencrypt/live/runit.gelatina.lat/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/runit.gelatina.lat/privkey.pem;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~ ^/(health|ready|auth/|problems|tournaments|access-codes/|rounds/|public/) {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Primero habilitar HTTP para emitir el certificado:

```bash
sudo mkdir -p /var/www/html
sudo ln -s /etc/nginx/sites-available/runit.gelatina.lat /etc/nginx/sites-enabled/runit.gelatina.lat
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d runit.gelatina.lat
sudo nginx -t
sudo systemctl reload nginx
```

Configurar el DNS `A` o `AAAA` para que `runit.gelatina.lat` apunte al servidor nuevo antes de ejecutar certbot. Mantener abiertos solo los puertos 80 y 443 en el firewall.

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
cd /root/judge
docker compose exec -T db pg_dump -U judge0 -d run_it --format=custom > /var/backups/run-it/run_it_$(date +%F).dump
chmod 600 /var/backups/run-it/*.dump
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
sudo ss -lntp | grep -E ':(80|443|2358|3001|3002|5433|6380)'
```

Problemas frecuentes:

- `/ready` falla: comprobar `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT` y las contrasenas.
- Judge0 no esta healthy: revisar `docker compose logs server worker` y la arquitectura del host.
- Frontend 502: comprobar que existe `.output/server/index.mjs` y que escucha en `127.0.0.1:3002`.
- Socket.io no actualiza: comprobar la ruta `/socket.io/` y los headers WebSocket de nginx.
- Login admin falla tras una migracion: comprobar que se restauro `run_it` y que `ADMIN_ACCESS_CODE` coincide con el usuario existente.

## 15. Rollback

Si el servidor nuevo falla:

1. Detener `run-it-backend` y `run-it-frontend` en el servidor nuevo.
2. Volver el DNS a la IP del servidor anterior.
3. Arrancar los servicios anteriores.
4. No borrar el volumen Docker ni el backup del servidor nuevo.
5. Investigar los logs y corregir antes de repetir el cambio.

No ejecutar `docker compose down -v` durante un rollback.

## 16. Entrega final

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
