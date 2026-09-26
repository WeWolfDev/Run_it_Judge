# Códigos de acceso temporales

Cómo funciona el sistema de PINes de acceso al torneo, y qué credenciales usar
para probarlo en el entorno de desarrollo.

## 1. Para qué sirve

Un organizador genera una tanda de códigos cortos y los reparte entre los
participantes. Cada código sirve **una sola vez**: el participante lo canjea por
una cuenta al registrarse, y después queda marcado como usado.

Al terminar el torneo, los códigos que quedaron sin usar se invalidan. Esa es
la parte que importa: sin ella, un PIN sobrante de un evento de hoy sirve para
entrar al torneo del mes que viene.

```
                  generar                canjear                 invalidar
  (admin)  ─────────────────►  unused  ────────────►  claimed
                                        │
                        ┌───────────────┴───────────────┐
                   vence el TTL              termina el torneo
                        │                               │
                        └──────────►  expired  ◄────────┘
                                        │
                                        └──► el PIN ya no sirve nunca más
```

## 2. Estados

Un código está en uno de tres estados, definidos en el `CHECK` de la tabla:

| Estado | Significado | ¿Sirve? |
| --- | --- | --- |
| `unused` | emitido, nadie lo usó todavía | sí, si no venció |
| `claimed` | alguien ya se registró con él | no, pero su dueño sí puede entrar con él |
| `expired` | invalidado | no, nunca más |

Que un código `claimed` deje de servir **para otras personas** no significa que
el participante pierda su cuenta: para volver a entrar usa su usuario y su
código, por la ruta de login.

## 3. Los tres mecanismos de invalidación

No hay cron ni proceso de limpieza. Los tres viven en la capa de consulta.

**a. Vencimiento por reloj.** La columna `expires_at` es un `timestamptz`. La
consulta de canje exige `expires_at > now()`, así que un código deja de servir
en el instante en que vence, aunque la fila siga diciendo `unused`. No hace
falta que nadie lo marque.

**b. Fin del torneo.** Cuando `closeRound` declara un ganador, marca el torneo
como `finished` e invalida sus códigos pendientes **en la misma transacción**.
Si el evento se cancela antes de que haya ganador, `POST /tournaments/:id/finish`
hace lo mismo.

**c. Revocación manual.** `POST /access-codes/revoke` para cuando hay que
apagar una tanda concreta sin cerrar el torneo.

La consulta que decide si un código sirve es una sola, en `index.js`:

```sql
WHERE ac.status = 'unused'
  AND (ac.expires_at IS NULL OR ac.expires_at > now())
  AND (ac.tournament_id IS NULL OR EXISTS (
        SELECT 1 FROM tournaments t
        WHERE t.id = ac.tournament_id AND t.status <> 'finished'
      ))
```

El `FOR UPDATE` de esa consulta es lo que hace que dos participantes no puedan
canjear el mismo código a la vez: el segundo espera al lock y cuando lo
consigue ya no lo encuentra como `unused`.

## 4. Formato de los códigos

```
WLLYUB
```

6 caracteres sobre un alfabeto de 32 símbolos:

```
ABCDEFGHJKLMNPQRSTUVWXYZ23456789
```

Se descartan `I`, `O`, `0` y `1` porque se confunden entre sí cuando alguien
los lee en voz alta o los copia de una pizarra. Con 6 caracteres hay unos mil
millones de combinaciones.

Se generan con `crypto.randomInt` y no con un módulo de `randomBytes`, que
introduciría sesgo hacia los primeros símbolos del alfabeto.

**El PIN se normaliza al entrar.** `register` y `claim` pasan la entrada por
mayúsculas y quitan espacios y guiones, así que `wll-yub`, `WLL YUB` y `wlllyub`
son el mismo código. `login` prueba primero el valor literal y después el
normalizado, para no romper los códigos antiguos, que sí guardan el guion.

## 5. API

| Método | Ruta | Rol | Qué hace |
| --- | --- | --- | --- |
| `POST` | `/access-codes/generate` | admin | Emite códigos. Acepta `count`, `tournamentId`, `ttlMinutes` |
| `GET` | `/access-codes` | admin | Lista los emitidos con estado y vencimiento |
| `POST` | `/access-codes/revoke` | admin | Invalida por `tournamentId` o por lista de `codes` |
| `POST` | `/access-codes/:code/claim` | participante | Canjea un código suelto |
| `POST` | `/auth/register` | público | Registra usuario + canjea código en una transacción |
| `POST` | `/auth/login` | público | Entra con usuario y código |
| `POST` | `/tournaments/:id/finish` | admin | Cierra el torneo e invalida sus códigos |

`POST /access-codes/generate`:

```json
{ "count": 30, "tournamentId": "<uuid>", "ttlMinutes": 240 }
```

`tournamentId` y `ttlMinutes` son opcionales. Sin ellos el código es global y
no caduca nunca, que es la conducta anterior a esta funcionalidad. Devuelve
`{ "codes": [{ "code": "WLLYUB", "tournament_id": "...", "expires_at": "..." }] }`.

Rechaza con `409` si el torneo ya está `finished`.

## 6. Panel del organizador

En `/admin`, sección **Códigos de acceso**:

- **Torneo**: deja asociar la tanda a un torneo, o dejarla como código global
- **Cantidad**: cuántos emitir, hasta 500
- **Válidos por**: TTL en minutos
- **Códigos emitidos**: tabla con el código, el estado y cuándo vence
- **Revocar sin usar**: invalida la tanda del torneo seleccionado
- **Finalizar torneo e invalidar**: cierra el torneo y mata sus códigos

## 7. Flujo del participante

En `/login`, pestaña **"Registrarme con un código"**:

1. Escribir un nombre de usuario de 3 o más caracteres
2. Escribir el PIN de 6 caracteres
3. Aceptar las reglas

El nombre no se puede repetir, y el PIN se quema en el primer uso.

## 8. Credenciales de prueba

Son **de desarrollo, nunca de producción**. Viven solo en la base `run_it_dev`,
que no es alcanzable desde la red: el backend escucha en `127.0.0.1:5000`.

Definidas en un solo lugar, `deploy/dev-branch.sh`:

```
DEV_ADMIN_USERNAME=devadmin
DEV_ADMIN_ACCESS_CODE=dev-admin-dev
```

| Rol | Usuario | Código |
| --- | --- | --- |
| Administrador | `devadmin` | `dev-admin-dev` |
| Participante | el que elijas, 3+ caracteres | un PIN de 6 que generes |

Se pueden sobreescribir por entorno:

```bash
RUN_IT_DEV_ADMIN_USERNAME=otro RUN_IT_DEV_ADMIN_ACCESS_CODE=otro-codigo \
  deploy/dev-branch.sh up
```

El código tiene que tener **8 caracteres o más**, porque el formulario de login
rechaza lo que no llegue a ese mínimo.

### Generar una tanda para probar

El entorno de desarrollo ya viene con un usuario `devadmin`, un torneo de
ejemplo y un problema, porque el script arranca el backend con
`RUN_IT_SEED_DEMO=true`.

Para emitir códigos por línea de comandos:

```bash
# 1. Loguearse como admin
TOKEN=$(curl -s -X POST http://127.0.0.1:5000/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"devadmin","accessCode":"dev-admin-dev"}' \
  | sed -E 's/.*"token":"([^"]+)".*/\1/')

# 2. Ver los torneos
curl -s http://127.0.0.1:5000/tournaments -H "authorization: Bearer $TOKEN"

# 3. Emitir 5 códigos, sin torneo y sin vencimiento
curl -s -X POST http://127.0.0.1:5000/access-codes/generate \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"count":5}'
```

Los códigos salen en la respuesta. Para probarlos desde el navegador, abrí
`http://localhost:4000/login` y usá la pestaña de registro.

## 9. Desprobar la invalidación

```bash
# Emitir un código con vencimiento de 1 minuto
CODE=$(curl -s -X POST http://127.0.0.1:5000/access-codes/generate \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"count":1,"ttlMinutes":1}' \
  | sed -E 's/.*"code":"([^"]+)".*/\1/')

sleep 61

# Registrar: debe fallar
curl -s -X POST http://127.0.0.1:5000/auth/register \
  -H 'content-type: application/json' \
  -d "{\"username\":\"prueba\",\"accessCode\":\"$CODE\"}"
# {"error":"Código de acceso no disponible"}
```

O bien, desde el panel: **"Finalizar torneo e invalidar"** y después intentar
registrarse con un PIN sin usar.

## 10. Datos

Todo vive en `access_codes`:

| Columna | Para qué |
| --- | --- |
| `code` | El PIN. Único |
| `status` | `unused`, `claimed` u `expired` |
| `claimed_by_user_id` | Quién lo canjeó |
| `display_name` | Nombre con el que se registró |
| `tournament_id` | Torneo al que pertenece. `NULL` = código global |
| `expires_at` | Deadline. `NULL` = no caduca |

Índices: `access_codes_tournament_status_idx` sobre
`(tournament_id, status)`, y `access_codes_expires_at_idx` parcial sobre los
`unused` con vencimiento.

## 11. Nota de seguridad conocida

`users.access_code` guarda el código **en texto plano**, y el login compara en
claro. Eso es deliberado en el diseño actual: el código es una credencial de un
solo uso, y hashearlo impediría al organizador recuperar la lista que repartió.
Está anotado como limitación conocida en `CHANGELOG_RUN_IT.md`.

Consecuencia práctica: quien tenga acceso de lectura a la base de producción
conoce los PINes de los participantes. El aislamiento de la base de desarrollo
existen justamente para que esto no aplique a las pruebas.

## 12. Deploy

El PR incluye migración de schema. Al reiniciar el backend, `initDb()` la
aplica:

```sql
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS tournament_id UUID;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS access_codes_status_check;
ALTER TABLE access_codes ADD CONSTRAINT access_codes_status_check
  CHECK (status IN ('unused', 'claimed', 'expired'));
```

Son columnas aditivas nullable y un swap de constraint. Ambas cosas son
idempotentes, y se verificó corriendo la migración tres veces seguidas sin
error.

**Los códigos que ya existen en producción siguen funcionando.** Los que no
tengan `tournament_id` ni `expires_at` conservan la conducta anterior, sin
caducidad automática, gracias al `IS NULL OR ...` de la consulta.

Hacé el backup de `MIGRACION_SERVIDOR_RUN_IT.md` antes de reiniciar el
backend.

## Documentos relacionados

- `DEVELOPMENT_COMMANDS.md`: cómo levantar el entorno de desarrollo
- `LOCAL_CHANGES_CONFIG.md`: por qué existe y cómo aísla de `main`
- `CHANGELOG_RUN_IT.md`: bitácora del proyecto
