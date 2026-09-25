# Documentación Técnica y Guía de Despliegue del Servidor/Juez

## 1. Resumen Ejecutivo y Misión del Stack

### Propósito del Repositorio

**Run It** es una plataforma de torneo de programación competitiva por rondas. Permite a administradores crear torneos, definir problemas, gestionar participantes mediante códigos de acceso, y ejecutar rondas de programación con evaluación automática de código. Los participantes envían soluciones que son ejecutadas y evaluadas por un motor de sandboxing, y los resultados se reflejan en tiempo real en un ranking público.

La arquitectura del sistema se compone de tres capas principales:
- **Frontend**: Aplicación web React + TypeScript que proporciona las interfaces de login, panel de administración, vista de participante y pista pública en vivo.
- **Backend (Run It)**: Servidor API en Node.js/Fastify que orquesta autenticación, gestión de torneos/rondas/participantes, cola de submissions y eventos en tiempo real vía Socket.io.
- **Motor de Evaluación (Judge0)**: Servicio de sandboxing que ejecuta el código enviado por los participantes en un entorno aislado y devuelve veredictos.

### Arquitectura del Sistema

```
Navegador (Cliente)
  │
  ▼
Frontend Vite/TanStack Start (:8080 / :3002 en producción)
  │  HTTP + Socket.io
  ▼
Backend Fastify/Socket.io (:3000 en dev, :3001 en prod)
  │
  ├── PostgreSQL (:5433 host / :5432 Docker) — Usuarios, torneos, rondas, participantes, submissions
  ├── Redis (:6380 host / :6379 Docker) — Cola BullMQ + store de sesiones (opcional)
  │
  ▼
BullMQ Worker → Judge0 API (:2358)
  │              │
  │              └── Docker containers con cgroups/namespaces para sandboxing
  │
  └── socket.io.emit("participant:progress") → Frontend
```

### Tecnologías Utilizadas

| Componente | Tecnología | Versión/Mención |
|---|---|---|
| **Lenguaje Backend** | Node.js | 18 o superior |
| **Framework Backend** | Fastify | v5.12.3 |
| **Lenguaje Frontend** | TypeScript | v5.8.3 |
| **Framework Frontend** | React + TanStack Start | React 19.2, TanStack Router 1.170 |
| **Build Tool Frontend** | Vite + Nitro | Vite 8.1.5, Nitro 3.0 (preset node-server) |
| **Base de Datos Principal** | PostgreSQL | 16.2 (Docker) |
| **Cola de Mensajería** | Redis + BullMQ | Redis 7.2.4, BullMQ 5.58.5 |
| **Motor de Ejecución** | Judge0 CE | 1.13.1 (Docker, imagen `judge0/judge0:1.13.1`) |
| **Tiempo Real** | Socket.io | v4.8.1 |
| **Sandboxing** | Docker + cgroups | `privileged: true`; en cgroup v2 se usan `ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT` y `ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT` |
| **Gestor de Contenedores** | Docker + Docker Compose | v2 |
| **Proxy/SSL** | nginx + Let's Encrypt | TLS HTTPS |
| **CSS/Tailwind** | TailwindCSS v4 + Radix UI | Componentes de UI |

### Flujo de Interacción entre API y el Módulo "Juez" Evaluador

1. El participante se autentica (`POST /auth/login`) y recibe un token de sesión.
2. Se registra en una ronda activa (`POST /rounds/:id/participants/join`).
3. El frontend envía código fuente al backend (`POST /rounds/:id/submissions`).
4. El backend valida: rol de participante, ronda activa, no pausada, rate limit (1 envío/s por usuario).
5. La submission se persiste en PostgreSQL con estado `queued`.
6. BullMQ encola el job `execute` en Redis.
7. El worker de BullMQ recibe el job y llama a Judge0 (`POST /submissions` con `language_id`).
8. Judge0 ejecuta el código en sandbox (Docker + cgroups) y devuelve un token de submission.
9. El worker consulta el estado (`GET /submissions/:token`) en polling cada 500ms hasta que `status.id > 2`.
10. El resultado se compara contra el `expected` del primer test case del problema.
11. Si coincide → veredicto `accepted` (pasa 1 test). Si no → veredicto del status Judge0.
12. Se actualiza `submissions` y `round_participants` en PostgreSQL.
13. Socket.io emite `participant:progress` al frontend en tiempo real.
14. Si se alcanza la capacidad de la ronda, se cierra transaccionalmente con ranking.

---

## 2. Características Principales del Sistema

### Funcionalidades Clave a Nivel de Administración

- **Gestión de Usuarios**: Login por rol (`admin` / `participant`), registro con código de acceso de un solo uso.
- **Generación de Códigos de Acceso**: El admin puede generar hasta 500 códigos `RUNIT-XXXXXXXX` por lotes.
- **Gestión de Torneos**: Crear, listar, actualizar, eliminar y activar torneos.
- **Gestión de Problemas**: CRUD completo de problemas con nombre, enunciado, dificultad (`easy`/`medium`/`hard`) y casos de prueba en JSONB.
- **Gestión de Rondas**: Crear rondas asociadas a un torneo y problema, configurar cupo máximo y tiempo límite, iniciar/pausar/cerrar.
- **Panel Administrativo Completo**: Dashboard con control de ronda (temporizador, stats de cupo/resueltos/activos), tabla de participantes con avance en vivo, ranking, historial de submissions, generación de códigos, configuración de rondas.
- **Cierre Automático de Rondas**: Por cupo lleno o por expiración de `ends_at` (chequeo cada segundo).
- **Cierre Transaccional con Desempate**: Orden de clasificación: 1) `solved_at` (primer resuelto gana), 2) mayor `best_pass_percentage`, 3) menor `failed_attempts_count`.

### Capacidades de Evaluación del Juez

| Capacidad | Detalle |
|---|---|
| **Lenguajes Soportados** | Python (`language_id: 71`) y JavaScript (`language_id: 63`). Extensible modificando `LANGUAGE_IDS` en `judge0-client.js`. |
| **Límite de Tiempo** | Configurable por ronda (`time_limit_seconds`). Judge0 aplica límites de CPU y tiempo por proceso/hilo. |
| **Límite de Memoria** | Configurable en `judge0.conf` (`ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT=true`). |
| **Sandboxing** | Judge0 corre con `privileged: true` en Docker, usa `isolate` para crear namespaces y cgroups. En cgroup v2 se requiere configuración especial (activar límites por proceso/hilo). |
| **Scoring** | Comparación exacta de `stdout` contra el campo `expected` del primer test case. Se cuenta como `test_cases_passed` 1 si coincide, 0 en caso contrario. |
| **Rate Limit** | 1 submission por segundo por usuario (en memoria, se resetea al reiniciar el backend). |
| **Concurrencia** | `SUBMISSION_CONCURRENCY=4` workers concurrentes de Judge0 por defecto. |
| **Cola** | BullMQ con Redis como backend de cola, desacopla la recepción HTTP de la ejecución. |

---

## 3. Requerimientos Mínimos Indispensables (Baseline Funcional)

### Dependencias Estrictas

| Dependencia | Versión Mínima | Propósito | ¿Obligatorio? |
|---|---|---|---|
| **Node.js** | 18.x | Runtime del backend Fastify y del frontend (Vite/Nitro) | **Sí** |
| **npm** | 9.x+ | Gestión de paquetes Node | **Sí** |
| **Docker** | 20.10+ | Contenerización de Judge0, PostgreSQL, Redis | **Sí** |
| **Docker Compose** | v2 | Orquestación de servicios Docker | **Sí** |
| **PostgreSQL** | 16.x (vía Docker) | Base de datos principal de Run It | **Sí** |
| **Redis** | 7.2.x (vía Docker) | Cola BullMQ + store de sesiones | **Sí** |
| **Judge0 CE** | 1.13.1 (vía Docker) | Motor de ejecución/sandboxing | **Sí** |
| **nginx** | 1.20+ (producción) | Reverse proxy con TLS | Solo producción |
| **Let's Encrypt certbot** | — | Certificados TLS | Solo producción |
| **Git** | 2.30+ | Clonado del repositorio | **Sí** |

### Variables de Entorno Requeridas

**Backend** (`run-it-backend/secrets` o `.env`):
```bash
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
PORT=3001
NODE_ENV=production
```

**Frontend** (`.env`):
```bash
VITE_API_URL=
VITE_SOCKET_URL=/
VITE_ROUND_ID=00000000-0000-0000-0000-000000000002
```

**Judge0** (`judge0.conf`):
```dotenv
REDIS_HOST=redis
REDIS_PASSWORD=GENERAR_UN_SECRETO_UNICO
POSTGRES_HOST=db
POSTGRES_DB=judge0
POSTGRES_USER=judge0
POSTGRES_PASSWORD=GENERAR_OTRO_SECRETO_UNICO
COUNT=8
MAX_QUEUE_SIZE=100
```

**Nota sobre puertos**: En producción, el backend escucha en `3001` (no `3000` como en dev), Redis se expone en `6380` (no `6379`, porque el host ya usa esa puerto), y PostgreSQL en `5433` (no `5432`, evitar conflicto con instancias locales). Todos los binds son a `127.0.0.1`.

### Servicios Auxiliares

| Servicio | Puerto (host) | Puerto (Docker) | Estado |
|---|---|---|---|
| Judge0 API | 127.0.0.1:2358 | 2358 | Obligatorio |
| Judge0 Worker | — | — | Obligatorio |
| PostgreSQL | 127.0.0.1:5433 | 5432 | Obligatorio |
| Redis | 127.0.0.1:6380 | 6379 | Obligatorio |
| Backend Fastify | 127.0.0.1:3001 | — | Obligatorio |
| Frontend SSR | 127.0.0.1:3002 | — | Obligatorio (prod) |
| nginx | 80 (HTTP), 443 (HTTPS) | — | Obligatorio (prod) |

### Hardware Mínimo Recomendado

| Recurso | Mínimo (MVP / ~20 participantes) | Recomendado (Producción / ~100+ participantes) |
|---|---|---|
| **CPU** | 2 cores (x86_64/amd64) | 4-8 cores (Judge0 es intensivo en CPU para sandboxing) |
| **RAM** | 4 GB | 8-16 GB (PostgreSQL + Redis + Docker + Node.js + Judge0) |
| **Almacenamiento** | 20 GB SSD | 50+ GB SSD (datos PostgreSQL, Docker images, logs) |
| **Red** | 100 Mbps | 1 Gbps (para Judge0 que ejecuta código arbitrario) |
| **Arquitectura** | x86_64 / amd64 | x86_64 / amd64 (Judge0 CE sandbox requiere compatibilidad) |

**Nota crítica**: Judge0 CE 1.13.1 requiere un entorno `linux/amd64`. En Apple Silicon (M1/M2/M3/M4), se debe forzar la plataforma `linux/amd64` o usar un servicio Judge0 externo. Para ejecución fiable en producción, se recomienda un host Linux `x86_64`.

---

## 4. Distribución Linux Recomendada

### Recomendación: **Ubuntu Server 22.04 LTS + Cockpit**

### Justificación Técnica

**¿Por qué Ubuntu Server 22.04 LTS?**

1. **Máxima compatibilidad con Docker y Judge0**: Ubuntu 22.04 tiene soporte nativo de Docker, containerd y las utilidades necesarias para cgroups. Judge0 CE 1.13.1 depende de `isolate` y su binario `run` que espera una distribución Linux estable con soporte de namespaces. Ubuntu ha demostrado compatibilidad probada con el stack Judge0 en entornos de producción documentados.

2. **LTS (Long Term Support)**: Soporte oficial de 5 años (hasta abril de 2027), lo que garantiza estabilidad de paquetes, actualizaciones de seguridad y compatibilidad con herramientas de infraestructura.

3. **Amplia documentación comunitaria**: Cualquier problema con Docker, PostgreSQL, nginx o systemd tiene soluciones inmediatas disponibles para Ubuntu.

4. **cgroup v2 nativo**: Ubuntu 22.04 utiliza cgroup v2 por defecto, lo cual es el mismo entorno donde se ha validado el despliegue de Run It en producción (`gelatina.lat`). Los parches de Judge0 para cgroup v2 (`ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT=true`) están ya probados.

5. **Disponibilidad de paquetes**: `docker.io`, `docker-compose`, `nginx`, `postgresql`, `redis-server` están en los repositorios oficiales, eliminando la necesidad de repositorios de terceros.

**¿Por qué Cockpit como interfaz gráfica?**

Cockpit es un panel web de administración de servidores que:
- Consume **muy pocos recursos** (~50-100 MB RAM, un proceso ligero).
- Se integra directamente con `systemd` para gestionar servicios (ver estado, reiniciar, ver logs).
- Provee interfaz para gestión de red (IP estática, firewall, SSH), disco, containers Docker y usuarios.
- Es accesible vía navegador en `https://<IP>:9090`.
- Es mantenido por un proyecto patrocinado por Red Hat con paquetes disponibles en Ubuntu.

**Alternativas evaluadas y descartadas:**

| Alternativa | Razón para descartar |
|---|---|
| **Debian 12 + Cockpit** | Excelente estabilidad, pero Cockpit tiene menos integración con Docker y requiere configuración adicional del repositorio. |
| **CentOS Stream / Rocky Linux** | Menor soporte comunitario para Docker, curva de aprendizaje más empinada, Cockpit no tan pulido. |
| **Ubuntu Desktop + GNOME** | Consume demasiados recursos (1-2 GB RAM base), innecesario para un servidor. |
| **AlmaLinux / RHEL** | Licenciamiento, menor disponibilidad de paquetes Docker en repositorios base. |
| **Sin escritorio (headless puro)** | No cumple el requisito de "interfaz gráfica amigable". Cockpit es la alternativa más ligera. |

### Configuración Recomendada Post-Instalación

- Instalar Cockpit: `sudo apt install cockpit cockpit-docker`
- Habilitar Cockpit: `sudo systemctl enable --now cockpit.socket`
- Acceso: `https://<IP_SERVIDOR>:9090`
- Usar Cockpit para: gestión de servicios, firewall (UFW), red (IP estática), Docker containers, logs.

---

## 5. Guía de Despliegue Paso a Paso (De PC a Servidor Operativo)

### Paso 1: Preparación del Sistema Operativo

#### 1.1 Instalar Ubuntu Server 22.04 LTS

Descargar la ISO desde https://ubuntu.com/download/server. Instalar con las opciones por defecto, seleccionando OpenSSH server durante la instalación.

#### 1.2 Configurar IP Estática

```bash
# Verificar el nombre de la interfaz de red
nmcli device status

# Configurar IP estática (ajustar según tu red)
sudo nmcli connection modify "Wired connection 1" \
  ipv4.addresses "192.168.1.100/24" \
  ipv4.gateway "192.168.1.1" \
  ipv4.dns "8.8.8.8,1.1.1.1" \
  ipv4.method manual \
  connection.autoconnect yes

sudo nmcli connection up "Wired connection 1"
```

#### 1.3 Configurar Firewall (UFW)

```bash
# Permitir SSH, HTTP, HTTPS y Cockpit
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 9090/tcp
sudo ufw allow 5433/tcp   # Solo para acceso local de debug
sudo ufw enable
sudo ufw status
```

#### 1.4 Instalar Cockpit (Interfaz Gráfica Web)

```bash
sudo apt update
sudo apt install -y cockpit cockpit-docker
sudo systemctl enable --now cockpit.socket
```

Acceder desde el navegador: `https://<IP_DEL_SERVIDOR>:9090` (aceptar certificado autofirmado).

#### 1.5 Actualizar el Sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt autoremove -y
sudo reboot
```

---

### Paso 2: Entorno Base y Dependencias

#### 2.1 Instalar Docker y Docker Compose

```bash
# Actualizar índices de paquetes
sudo apt update

# Instalar dependencias previas
sudo apt install -y ca-certificates curl gnupg lsb-release

# Agregar clave G oficial de Docker
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Agregar repositorio de Docker
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Instalar Docker Engine, CLI y Compose
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verificar instalación
sudo docker --version
sudo docker compose version

# Agregar usuario actual al grupo docker (reemplazar 'usuario')
sudo usermod -aG docker $USER
newgrp docker

# Habilitar Docker en el arranque
sudo systemctl enable --now docker
```

#### 2.2 Instalar Node.js 18+ y npm

```bash
# Agregar repositorio NodeSource para Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Instalar Node.js y npm
sudo apt install -y nodejs

# Verificar
node --version   # Debe mostrar v20.x o superior
npm --version    # Debe mostrar 10.x o superior
```

#### 2.3 Instalar PostgreSQL Client (opcional, para debug)

```bash
sudo apt install -y postgresql-client
```

#### 2.4 Instalar nginx y Certbot (para producción)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
```

#### 2.5 Instalar Git

```bash
sudo apt install -y git
```

---

### Paso 3: Configuración del Repositorio

#### 3.1 Clonar el Repositorio

```bash
# Crear directorio de trabajo
sudo mkdir -p /root/judge
sudo chown $(whoami):$(whoami) /root/judge
cd /root/judge

# Clonar el repositorio
git clone <URL_DEL_REPOSITORIO> .
git checkout main

# Verificar el commit desplegado
git log --oneline -1
```

#### 3.2 Configurar `judge0.conf`

```bash
# Copiar el archivo de ejemplo
cp judge0.conf.example judge0.conf

# Editar con valores seguros
cat > judge0.conf << 'EOF'
REDIS_HOST=redis
REDIS_PASSWORD=GENERAR_UN_SECRETO_UNICO_AQUI
POSTGRES_HOST=db
POSTGRES_DB=judge0
POSTGRES_USER=judge0
POSTGRES_PASSWORD=GENERAR_OTRO_SECRETO_UNICO_AQUI
COUNT=8
MAX_QUEUE_SIZE=100
EOF

# Proteger el archivo de secretos
chmod 440 judge0.conf
sudo chown 1000:999 judge0.conf
```

#### 3.3 Crear la Base de Datos `run_it`

```bash
# Verificar que PostgreSQL está corriendo
cd /root/judge
docker compose up -d db redis

# Esperar a que PostgreSQL esté listo
sleep 5

# Crear la base de datos y usuario para Run It
docker exec -it run-it-judge-db-1 psql -U judge0 -d judge0 -c "
  CREATE DATABASE run_it;
  CREATE USER run_it WITH PASSWORD 'CONTRASENA_BD_SEGURA';
  GRANT ALL PRIVILEGES ON DATABASE run_it TO run_it;
"
```

#### 3.4 Crear el Archivo de Secretos del Backend

```bash
cat > run-it-backend/secrets << 'EOF'
NODE_ENV=production
PORT=3001
DATABASE_URL=postgres://run_it:CONTRASENA_BD_SEGURA@127.0.0.1:5433/run_it
REDIS_HOST=127.0.0.1
REDIS_PORT=6380
REDIS_PASSWORD=CONTRASENA_REDIS_SEGURA
JUDGE0_URL=http://127.0.0.1:2358
ALLOWED_ORIGINS=https://runit.tu-dominio.com
SESSION_STORE=redis
SESSION_TTL_SECONDS=28800
ADMIN_USERNAME=admin
ADMIN_ACCESS_CODE=CREAR_CODIGO_ADMIN_MUY_SEGURO
RUN_IT_SEED_DEMO=false
SUBMISSION_CONCURRENCY=4
EOF

# Proteger el archivo de secretos
chmod 440 run-it-backend/secrets
```

**Importante**: Nunca subir `judge0.conf`, `run-it-backend/secrets`, certificados ni contraseñas al repositorio. El `.gitignore` ya excluye estos archivos.

#### 3.5 Construir el Frontend

```bash
cd /root/judge/frontend
npm ci
VITE_API_URL="" VITE_SOCKET_URL="/" npm run build
```

Nota: `VITE_API_URL=""` y `VITE_SOCKET_URL="/"` configuran el frontend para mismo origen, donde nginx enruta todo.

#### 3.6 Instalar Dependencias del Backend

```bash
cd /root/judge/run-it-backend
npm ci --omit=dev
```

#### 3.7 Verificar Docker Compose

```bash
cd /root/judge
docker compose config -q   # No debería producir salida = configuración válida
```

---

### Paso 4: Despliegue y Arranque

#### 4.1 Levantar los Servicios Docker

```bash
cd /root/judge

# Iniciar todos los servicios Docker (Judge0, worker, PostgreSQL, Redis)
docker compose up -d

# Verificar que todos los contenedores están corriendo
docker compose ps

# Verificar logs de los servicios críticos
docker compose logs --tail=50 server worker db redis
```

**Esperar a que PostgreSQL y Redis estén listos** antes de continuar (verificar con `docker compose ps` donde todos muestren `Up`).

#### 4.2 Configurar Backend como Servicio Systemd

```bash
# Crear el archivo de servicio systemd para el backend
sudo cat > /etc/systemd/system/run-it-backend.service << 'EOF'
[Unit]
Description=Run It Backend (Fastify)
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/judge/run-it-backend
EnvironmentFile=/root/judge/run-it-backend/secrets
ExecStart=/usr/bin/node /root/judge/run-it-backend/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Recargar systemd y habilitar el servicio
sudo systemctl daemon-reload
sudo systemctl enable --now run-it-backend
sudo systemctl start run-it-backend
```

#### 4.3 Configurar Frontend como Servicio Systemd

```bash
# Crear el archivo de servicio systemd para el frontend
sudo cat > /etc/systemd/system/run-it-frontend.service << 'EOF'
[Unit]
Description=Run It Frontend (TanStack Start SSR)
After=run-it-backend.service
Requires=run-it-backend.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/judge/frontend
ExecStart=/usr/bin/npm run dev -- --host 127.0.0.1 --port 3002
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Alternativa: si se usa el build de Nitro (recomendado en producción):
# ExecStart=/usr/bin/node /root/judge/frontend/.output/server/index.mjs

sudo systemctl daemon-reload
sudo systemctl enable --now run-it-frontend
sudo systemctl start run-it-frontend
```

#### 4.4 Configurar nginx como Reverse Proxy

```bash
# Crear la configuración de nginx para Run It
sudo cat > /etc/nginx/sites-available/runit << 'EOF'
server {
    listen 80;
    server_name runit.tu-dominio.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name runit.tu-dominio.com;

    ssl_certificate /etc/letsencrypt/live/runit.tu-dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/runit.tu-dominio.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # WebSocket y API → Backend Fastify
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Todo lo demás → Frontend
    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Habilitar el sitio
sudo ln -sf /etc/nginx/sites-available/runit /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Verificar configuración
sudo nginx -t

# Recargar nginx
sudo systemctl reload nginx
```

#### 4.5 Configurar Certificado TLS con Let's Encrypt

```bash
# Asegurar que el DNS apunta al servidor
# runit.tu-dominio.com -> IP del servidor

# Obtener certificado
sudo certbot --nginx -d runit.tu-dominio.com --non-interactive --agree-tos -m admin@tu-dominio.com

# Verificar renovación automática
sudo certbot renew --dry-run
```

---

### Paso 5: Verificación y Pruebas de Salud

#### 5.1 Verificar Todos los Servicios Docker

```bash
# Ver estado de todos los contenedores
cd /root/judge && docker compose ps

# Verificar que todos están "Up"
# Deberías ver: server Up, worker Up, db Up, redis Up

# Verificar logs de Judge0
docker compose logs --tail=20 server
# Esperar: "API is listening on port 2358"

# Verificar que el healthcheck de Judge0 pasa
curl -fsS http://localhost:2358/about
# Respuesta esperada: JSON con información de Judge0
```

#### 5.2 Verificar Base de Datos y Redis

```bash
# Verificar PostgreSQL
docker exec -it run-it-judge-db-1 psql -U judge0 -d judge0 -c "SELECT 1;"
# Debería retornar: 1

# Verificar Redis
docker exec -it run-it-judge-redis-1 redis-cli -a TU_REDIS_PASSWORD ping
# Respuesta esperada: PONG
```

#### 5.3 Verificar Backend

```bash
# Verificar que el backend está corriendo
systemctl status run-it-backend --no-pager
# Debe mostrar "active (running)"

# Verificar logs
journalctl -u run-it-backend -n 50 --no-pager

# Verificar endpoint de salud
curl -fsS http://localhost:3001/health
# Respuesta esperada: {"status":"ok"}

# Verificar endpoint de readiness (requiere DB + Redis)
curl -fsS http://localhost:3001/ready
# Respuesta esperada: {"status":"ready","database":"ok","redis":"ok"}
```

#### 5.4 Verificar Frontend

```bash
# Verificar que el frontend está corriendo
systemctl status run-it-frontend --no-pager

# Verificar acceso externo (desde el navegador)
# http://localhost:3002 debe redirigir a /login
curl -I http://localhost:3002/login
# Esperado: HTTP 200 o 302
```

#### 5.5 Verificar HTTPS con Dominio

```bash
curl -fsS https://runit.tu-dominio.com/health
# Esperado: {"status":"ok"}

curl -fsS https://runit.tu-dominio.com/ready
# Esperado: {"status":"ready","database":"ok","redis":"ok"}

curl -I https://runit.tu-dominio.com/login
# Esperado: HTTP 200
```

#### 5.6 Prueba Completa del Flujo de Submission

**Prueba de administración:**

```bash
# 1. Login como admin
curl -X POST https://runit.tu-dominio.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","accessCode":"TU_ADMIN_ACCESS_CODE"}'
# Respuesta: {"token":"...","user":{"id":"...","username":"admin","role":"admin"}}

# 2. Generar código de acceso para participante
curl -X POST https://runit.tu-dominio.com/api/access-codes/generate \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"count":1}'
# Respuesta: {"codes":["RUNIT-XXXXXXXX"]}
```

**Prueba de participante:**

```bash
# 3. Registrar participante con el código generado
curl -X POST https://runit.tu-dominio.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"participante1","accessCode":"RUNIT-XXXXXXXX"}'
# Respuesta: {"token":"...","user":{"id":"...","username":"participante1","role":"participant"}}

# 4. Crear torneo (como admin)
curl -X POST https://runit.tu-dominio.com/api/tournaments \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Torneo Demo"}'

# 5. Crear ronda con problema de Hola Mundo
curl -X POST https://runit.tu-dominio.com/api/rounds \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{
    "tournamentId": "ID_DEL_TORNEO",
    "roundNumber": 1,
    "problemId": "ID_DEL_PROBLEMA",
    "capacity": 10,
    "timeLimitSeconds": 3600
  }'

# 6. Iniciar ronda
curl -X POST https://runit.tu-dominio.com/api/rounds/RUND_ID/start \
  -H "Authorization: Bearer TOKEN_ADMIN"
```

**Prueba de submission:**

```bash
# 7. Participante se une a la ronda
curl -X POST https://runit.tu-dominio.com/api/rounds/RUND_ID/participants/join \
  -H "Authorization: Bearer TOKEN_PARTICIPANTE" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Participante 1"}'

# 8. Participante envía solución (Python - Hola mundo)
curl -X POST https://runit.tu-dominio.com/api/rounds/RUND_ID/submissions \
  -H "Authorization: Bearer TOKEN_PARTICIPANTE" \
  -H "Content-Type: application/json" \
  -d '{
    "participantId": "ID_PARTICIPANTE",
    "code": "print(\"Hola mundo\")",
    "language": "python"
  }'
# Respuesta esperada: HTTP 202 con el objeto de submission
```

**Verificación final:**

```bash
# 9. Verificar el ranking
curl -fsS https://runit.tu-dominio.com/api/rounds/RUND_ID/leaderboard \
  -H "Authorization: Bearer TOKEN_PARTICIPANTE"

# 10. Verificar que la ronda se cerró cuando se llenó el cupo
curl -fsS https://runit.tu-dominio.com/api/rounds/RUND_ID/state \
  -H "Authorization: Bearer TOKEN_PARTICIPANTE"
```

#### 5.7 Pruebas de Socket.io en Tiempo Real

Conectarse desde el navegador a `https://runit.tu-dominio.com` y verificar:
- Al iniciar una ronda, se recibe evento `round:started`.
- Al enviar una submission, se recibe `submission:queued`.
- Al completarse la evaluación, se recibe `participant:progress`.
- Al cerrar la ronda, se recibe `round:closed` con el ranking.

#### 5.8 Comandos de Diagnóstico de Producción

```bash
# Estado de servicios systemd
systemctl status run-it-backend --no-pager
systemctl status run-it-frontend --no-pager

# Logs del backend
journalctl -u run-it-backend -n 100 --no-pager
journalctl -u run-it-frontend -n 100 --no-pager

# Estado de Docker
cd /root/judge && docker compose ps
docker compose logs --tail=100 server worker db redis

# Verificar puertos activos
ss -tlnp | grep -E ':(2358|3001|3002|5433|6380)'
```

---

## Apéndice: Resumen de Seguridad en Producción

| Medida | Estado |
|---|---|
| `POST /submissions` sin auth eliminado | **Resuelto** |
| CORS restringido con `ALLOWED_ORIGINS` | **Resuelto** |
| Secretos fuera del código (`judge0.conf`, `secrets`) | **Resuelto** |
| `RUN_IT_SEED_DEMO=false` en producción | **Resuelto** |
| Código admin por `ADMIN_ACCESS_CODE` | **Resuelto** |
| Todos los puentes a `127.0.0.1` (sin exposición externa) | **Resuelto** |
| HTTPS con Let's Encrypt | **Resuelto** |
| nginx como proxy inverso | **Resuelto** |
| `privileged: true` en Judge0 (riesgo conocido) | **Documentado** |
| Sesiones en Redis persistentes | **Resuelto** (con `SESSION_STORE=redis`) |
| Rate limit en memoria (limitación MVP) | **Pendiente de migración a Redis** |
| Códigos de acceso y `access_code` en texto plano | **Limitación aceptada en MVP** |
| Scoring con un solo test case | **Limitación aceptada en MVP** |
| Backups automáticos de PostgreSQL | **Requiere configuración adicional** |
| Métricas y monitoreo | **Requiere configuración adicional** |
| Pruebas de carga | **Requiere configuración adicional** |

---

*Documento generado para el repositorio Run It — Commit de referencia: `b19a369`*
*Fecha de auditoría: Septiembre 2026*
