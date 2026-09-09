# Backend Run It

## Que se hizo

- Se añadió un backend mínimo con Fastify en `run-it-backend/index.js`.
- `GET /health` devuelve `{ "status": "ok" }`.
- `POST /submissions` recibe `code`, `language` y `problemId`.
- El backend crea una submission en Judge0, consulta su token y espera el resultado.
- El problema de prueba fijo es `hola-mundo`; se acepta cuando la salida es `Hola mundo`.
- `run-it-backend/judge0-client.js` usa `fetch` nativo de Node, sin `curl` ni dependencia HTTP adicional.
- Se añadió el compose oficial de Judge0 con PostgreSQL, Redis, servidor y workers.

## Decisiones

- Se usa `platform: linux/amd64` porque la imagen de Judge0 y su sandbox necesitan x86_64. En Apple Silicon puede requerir Rosetta, pero la ejecución de `isolate` no quedó confiable bajo emulación; para un torneo se recomienda una VM Linux x86_64 real.
- `COUNT=8` y `MAX_QUEUE_SIZE=100` son un punto de partida para una prueba de 30-40 participantes. No se configura un worker por participante: las submissions adicionales esperan en la cola.
- La configuración real `judge0.conf` se mantiene fuera de Git porque contiene contraseñas. Usa `judge0.conf.example` como plantilla.
- El backend local escucha en `127.0.0.1:3000`; Judge0 escucha en `2358` dentro del compose. No expongas Judge0 públicamente sin autenticación y firewall.

## Requisitos

- Node.js 18 o superior, porque se usa `fetch` nativo.
- Docker Desktop para desarrollo local, o Linux x86_64 para un despliegue estable.
- Docker Compose v2.

## Arranque local

```bash
cp judge0.conf.example judge0.conf
# Edita judge0.conf y cambia ambas contraseñas.
docker compose config -q
docker compose up -d

cd run-it-backend
npm install
node index.js
```

Comprobaciones:

```bash
# En otra terminal
node -e "fetch('http://localhost:3000/health').then(r => r.text()).then(console.log)"

# Flujo completo contra Judge0
npm run judge0
```

El endpoint propio se puede probar con Node:

```bash
node - <<'NODE'
const response = await fetch('http://localhost:3000/submissions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code: 'print("Hola mundo")',
    language: 'python',
    problemId: 'hola-mundo'
  })
});
console.log(response.status, await response.text());
NODE
```

## Despliegue en una VM Linux

Usa una VM `x86_64`/`amd64`, preferiblemente con al menos 2-4 vCPU y 4-8 GB de RAM para una prueba pequeña. En la VM:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
git clone <REPOSITORIO>
cd <REPOSITORIO>
cp judge0.conf.example judge0.conf
# Edita las contraseñas.
sudo docker compose up -d
sudo docker compose ps
```

El backend debe apuntar a la dirección privada de Judge0 mediante `JUDGE0_URL`. Mantén el puerto 2358 accesible solo desde el backend; publica únicamente la aplicación que necesiten los participantes.

## Escalado y límites

`COUNT` controla cuántas ejecuciones pueden procesarse en paralelo y `MAX_QUEUE_SIZE` limita la cola. Para 10 participantes con problemas cortos, `COUNT=1` puede servir para una prueba; para un torneo real, valida la carga en la misma arquitectura y aumenta workers solo si CPU y memoria lo permiten.

## Apagado

```bash
docker compose down
```

Esto conserva el volumen de PostgreSQL. No uses `docker compose down -v` salvo que quieras borrar los datos.
