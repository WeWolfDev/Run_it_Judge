# Solicitud para dejar Run It funcionando en producción

Este documento es para la persona externa que administra el servidor. El código ya está en el repositorio remoto; necesito que prepare el servidor, configure los secretos y deje accesible la aplicación.

## 1. Datos que necesito que confirme

Por favor confirmar:

- Acceso administrativo al servidor por SSH o que alguien con acceso ejecute los comandos.
- Sistema operativo y arquitectura del servidor. Se recomienda Linux `amd64`/`x86_64`.
- Ruta donde quedará el proyecto.
- Dominio que se usará. Actualmente: `runit.gelatina.lat`.
- Que el DNS del dominio apunta a la IP del servidor.
- Que Docker y Docker Compose v2 están instalados.
- Que Node.js 18 o superior y npm están instalados.
- Que nginx está instalado o que puede instalarse.
- Que los puertos públicos 80 y 443 están disponibles.
- Que hay espacio en disco suficiente para PostgreSQL, Redis y Judge0.

No necesito que se me envíen contraseñas por chat. Solo necesito confirmación cuando los secretos estén configurados.

## 2. Código a desplegar

Usar la rama `main` del repositorio remoto y el commit más reciente publicado.

```bash
git clone <URL_DEL_REPOSITORIO> /root/judge
cd /root/judge
git checkout main
```

Si el proyecto ya existe:

```bash
cd /root/judge
git pull origin main
```

## 3. Servicios que debe levantar

El archivo `docker-compose.yml` levanta estos servicios:

- Judge0 API, solo en `127.0.0.1:2358`.
- Worker de Judge0.
- PostgreSQL, solo en `127.0.0.1:5433`.
- Redis, solo en `127.0.0.1:6380`.

Ejecutar desde `/root/judge`:

```bash
cp judge0.conf.example judge0.conf
```

Editar `judge0.conf` y cambiar como mínimo:

```dotenv
REDIS_PASSWORD=GENERAR_UN_SECRETO_UNICO
POSTGRES_PASSWORD=GENERAR_OTRO_SECRETO_UNICO
```

No usar los valores `change-this-*`. Proteger el archivo:

```bash
chmod 440 judge0.conf
chown 1000:999 judge0.conf

docker compose config -q
docker compose up -d
docker compose ps
```

Los volúmenes de PostgreSQL deben ser persistentes. No ejecutar `docker compose down -v` porque borra los datos.

## 4. Base de datos de Run It

Run It necesita una base de datos propia llamada `run_it`, separada de la base `judge0` que usa internamente Judge0.

Crear, si no existe:

- Base: `run_it`.
- Usuario: `run_it`.
- Contraseña: un secreto único.
- Acceso local desde el backend por `127.0.0.1:5433`.

El backend crea las tablas automáticamente desde `run-it-backend/schema.sql` al arrancar.

## 5. Archivo de secretos del backend

Crear `/root/judge/run-it-backend/secrets` y hacer que el servicio systemd lo cargue. Contenido esperado:

```dotenv
NODE_ENV=production
PORT=3001
DATABASE_URL=postgres://run_it:CONTRASENA_BD@127.0.0.1:5433/run_it
REDIS_HOST=127.0.0.1
REDIS_PORT=6380
REDIS_PASSWORD=CONTRASENA_REDIS
JUDGE0_URL=http://127.0.0.1:2358
ALLOWED_ORIGINS=https://runit.gelatina.lat
SESSION_STORE=redis
SESSION_TTL_SECONDS=28800
ADMIN_USERNAME=admin
ADMIN_ACCESS_CODE=CREAR_UN_CODIGO_ADMIN_SEGURO
RUN_IT_SEED_DEMO=false
SUBMISSION_CONCURRENCY=4
```

Protegerlo:

```bash
chmod 440 /root/judge/run-it-backend/secrets
```

Requisitos importantes:

- `DATABASE_URL` debe apuntar a la base `run_it`, no a la base `judge0`.
- `REDIS_PORT` es `6380` porque ese es el puerto publicado por Docker en el host.
- `ALLOWED_ORIGINS` debe ser exactamente `https://runit.gelatina.lat`.
- `ADMIN_ACCESS_CODE` es el código inicial del usuario admin. Debe ser privado y no reutilizar códigos de ejemplo.
- `RUN_IT_SEED_DEMO` debe ser `false` en producción.
- `SESSION_STORE=redis` permite conservar sesiones cuando se reinicia el backend.

## 6. Backend y frontend

Instalar dependencias del backend:

```bash
cd /root/judge/run-it-backend
npm ci --omit=dev
```

El backend debe quedar como servicio systemd llamado `run-it-backend`, escuchando en `127.0.0.1:3001` y ejecutando:

```bash
node /root/judge/run-it-backend/index.js
```

Construir el frontend:

```bash
cd /root/judge/frontend
npm ci
VITE_API_URL="" VITE_SOCKET_URL="/" npm run build
```

El frontend debe quedar como servicio systemd llamado `run-it-frontend`, escuchando en `127.0.0.1:3002`.

Comandos esperados:

```bash
systemctl enable --now run-it-backend
systemctl enable --now run-it-frontend
systemctl restart run-it-backend
systemctl restart run-it-frontend
```

## 7. nginx y HTTPS

Configurar nginx para `runit.gelatina.lat` con certificado TLS válido, preferiblemente Let's Encrypt.

La configuración debe:

- Redirigir HTTP a HTTPS.
- Enviar API y Socket.io al backend `127.0.0.1:3001`.
- Enviar `/socket.io/` con soporte de WebSocket.
- Enviar el resto de las rutas al frontend `127.0.0.1:3002`.
- No exponer directamente los puertos 2358, 3001, 3002, 5433 ni 6380.

Validar y recargar:

```bash
nginx -t
systemctl reload nginx
```

## 8. Qué debe probar la persona del servidor

Después de configurar todo:

```bash
curl -fsS https://runit.gelatina.lat/health
curl -fsS https://runit.gelatina.lat/ready
curl -I https://runit.gelatina.lat/login
```

Debe confirmar también:

- `/health` responde HTTP 200.
- `/ready` responde HTTP 200 y muestra base de datos y Redis disponibles.
- El login admin funciona con el usuario y código configurados.
- El panel admin permite crear un torneo o generar un código.
- Un participante puede registrarse con un código generado.
- `/pista` funciona sin iniciar sesión.
- Una submission llega a Judge0 y actualiza el ranking.
- Los eventos de Socket.io funcionan al iniciar, pausar y cerrar una ronda.

## 9. Información que debe devolverme al terminar

No debe enviar contraseñas ni archivos de secretos. Solo devolver:

```text
Dominio configurado: sí/no
HTTPS válido: sí/no
Commit desplegado: <hash>
Backend activo: sí/no
Frontend activo: sí/no
Judge0 y worker activos: sí/no
PostgreSQL activo: sí/no
Redis activo: sí/no
/health: HTTP <código>
/ready: HTTP <código>
Login admin probado: sí/no
Registro de participante probado: sí/no
Submission probada: sí/no
Backup inicial realizado: sí/no
```

## 10. Comandos de diagnóstico

```bash
systemctl status run-it-backend --no-pager
systemctl status run-it-frontend --no-pager
journalctl -u run-it-backend -n 100 --no-pager
journalctl -u run-it-frontend -n 100 --no-pager
cd /root/judge && docker compose ps
docker compose logs --tail=100 server worker db redis
```

## 11. Reglas de seguridad

- No subir `judge0.conf`, `run-it-backend/secrets`, certificados ni contraseñas al repositorio.
- No activar `RUN_IT_SEED_DEMO=true` en producción.
- No usar `Access-Control-Allow-Origin: *`.
- No publicar PostgreSQL, Redis ni Judge0 a Internet.
- No ejecutar `docker compose down -v`.
- Configurar backups periódicos de la base `run_it` y probar su restauración.
- Mantener actualizado el sistema operativo, Docker, nginx y los certificados TLS.

## 12. Resultado esperado

Al finalizar, la aplicación debe estar disponible en:

```text
https://runit.gelatina.lat
```

El acceso inicial será el usuario `admin` y el `ADMIN_ACCESS_CODE` que la persona administradora haya configurado de forma privada.
