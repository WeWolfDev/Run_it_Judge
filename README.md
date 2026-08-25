# Run_it_Judge
# Especificación Técnica: Battle Royale de Programación Competitiva

## 1. Resumen del proyecto

Torneo de eliminación tipo "battle royale" donde los concursantes resuelven problemas de programación competitiva (estilo ICPC) en rondas sucesivas. Una UI de carrera visualiza el avance de cada participante como una ficha que se mueve por una pista conforme resuelve test cases. Al cierre de cada ronda (por cupo lleno o por tiempo agotado) se aplica una jerarquía de desempate para decidir quién avanza y quién queda eliminado, hasta que queda un solo ganador.

**Escala objetivo:** 50-200 concursantes en la ronda inicial.

---

## 2. Reglas del juego (mecánica core)

### 2.1 Estructura de rondas

- El torneo se compone de N rondas configurables, cada una con:
  - Un problema asignado (con nivel de dificultad propio).
  - Un cupo de clasificación (cuántos concursantes pasan a la siguiente ronda).
  - Un límite de tiempo.
- El número de concursantes decrece ronda a ronda hasta llegar a 1 ganador.

### 2.2 Condición de cierre de ronda

Una ronda se cierra cuando ocurre **la primera** de estas dos condiciones:

1. **Cupo lleno:** el número de concursantes que ha resuelto correctamente el problema alcanza el cupo definido para esa ronda.
2. **Tiempo agotado:** se llega al límite de tiempo configurado, sin importar cuántos hayan resuelto el problema.

### 2.3 Jerarquía de desempate y asignación de lugares

Al cerrar la ronda, se ordena a todos los concursantes activos según esta jerarquía (de mayor a menor prioridad):

1. **Resolvió el problema completo** → ordenado por timestamp de entrega exitosa (más rápido = mejor lugar).
2. **No resolvió** → ordenado por porcentaje de test cases pasados (mayor % = mejor lugar).
3. **Empate en % de test cases** → ordenado por menor número de intentos fallidos.

Se toman los primeros N lugares (según el cupo de la ronda) como clasificados; el resto queda descalificado del torneo.

**Nota de diseño:** esta jerarquía debe vivir en el backend, nunca en el cliente, y debe ejecutarse de forma atómica (transacción) para evitar condiciones de carrera si dos eventos de cierre se disparan casi simultáneamente (ej. el cupo se llena en el mismo instante en que expira el timer).

### 2.4 Dificultad progresiva configurable

- Cada problema tiene metadata de dificultad (`1-5` o `facil/medio/dificil`) y tags temáticos (arrays, grafos, DP, etc.).
- El organizador define un **perfil de torneo** antes de arrancar: número de rondas, cupo/porcentaje de corte por ronda, y rango de dificultad permitido por ronda.
- Recomendación: rondas tempranas con problemas fáciles/rápidos (para no trabar el torneo con 200 personas esperando), subiendo dificultad conforme se reduce el número de concursantes.

### 2.5 Fuente de problemas — advertencia legal

- **ICPC:** problemas de rondas/regionales pasadas suelen estar disponibles públicamente con fines educativos (sitio oficial de ICPC, Codeforces Gym, archivo ACM), pero conviene verificar la licencia de cada fuente específica, sobre todo si el torneo se monetiza.
- **LeetCode:** no ofrece API pública para reutilizar sus problemas/test cases en un producto de terceros. Raspar (scrapear) su contenido o reutilizar sus casos de prueba tiene riesgo de infracción de términos de servicio y derechos de autor. Recomendación: usarlo solo como referencia de estilo/dificultad y generar problemas propios inspirados en ese formato, o solicitar permiso explícito si se planea usar contenido real.

---

## 3. Arquitectura general

```
┌─────────────┐      HTTPS/WSS      ┌──────────────────┐
│  Frontend    │◄───────────────────►│   Backend API     │
│  (React)     │   REST + WebSocket  │  (Node/Fastify)   │
└─────────────┘                     └──────┬────────────┘
                                            │
                     ┌──────────────────────┼───────────────────────┐
                     │                      │                       │
              ┌──────▼──────┐       ┌───────▼────────┐      ┌───────▼───────┐
              │  PostgreSQL  │       │  Redis + Queue  │      │  Judge0 (VPS   │
              │  (estado)    │       │  (BullMQ)       │      │  independiente)│
              └─────────────┘       └────────┬────────┘      └───────▲───────┘
                                              │                       │
                                              └───────────────────────┘
                                          workers consumen cola y llaman a Judge0
```

**Principio de diseño:** el motor de ejecución de código (Judge0) vive en un servidor separado del backend de orquestación, para que la carga de compilación/ejecución no compita por recursos con el servidor de WebSockets que mantiene la UI en tiempo real.

---

## 4. Stack tecnológico recomendado

| Componente | Tecnología | Razón |
|---|---|---|
| Backend / API | Node.js + Fastify | I/O ligero, buen soporte de WebSockets |
| Tiempo real | Socket.io | Manejo de rooms por ronda, reconexión automática |
| Base de datos | PostgreSQL | Transacciones consistentes para el corte de ronda |
| Cola de trabajos | Redis + BullMQ | Evita saturar Judge0 con envíos simultáneos |
| Motor de ejecución | Judge0 (self-hosted, MIT license) | Sandboxing por contenedor, 60+ lenguajes, gratis y sin límite de ejecuciones al self-hostear |
| Frontend | React + Socket.io-client | Renderizado eficiente de fichas en movimiento (SVG + CSS transitions) |
| Autenticación | JWT simple (email/username + password, u OAuth) | Asociar submissions a participantes |

---

## 5. Modelo de datos

```sql
-- Torneo y configuración general
tournaments (
  id UUID PRIMARY KEY,
  name TEXT,
  config_json JSONB,        -- perfil de dificultad por ronda, nº de rondas, etc.
  status TEXT,               -- pending | active | finished
  created_at TIMESTAMP
);

-- Bandeja de problemas
problems (
  id UUID PRIMARY KEY,
  name TEXT,
  difficulty TEXT,            -- facil | medio | dificil
  statement TEXT,
  test_cases_json JSONB,      -- [{input, expected_output}, ...]
  source TEXT,                -- icpc | propio | otro
  tags TEXT[]
);

-- Rondas del torneo
rounds (
  id UUID PRIMARY KEY,
  tournament_id UUID REFERENCES tournaments(id),
  round_number INT,
  problem_id UUID REFERENCES problems(id),
  capacity INT,                -- cupo de clasificación
  time_limit_seconds INT,
  started_at TIMESTAMP,
  ends_at TIMESTAMP,           -- calculado server-side, fuente de verdad del timer
  status TEXT                  -- pending | active | closing | closed
);

-- Participantes del torneo (persisten entre rondas)
participants (
  id UUID PRIMARY KEY,
  tournament_id UUID REFERENCES tournaments(id),
  user_id UUID,
  display_name TEXT,
  avatar_icon TEXT,
  status TEXT                  -- active | eliminated | winner
);

-- Estado de un participante DENTRO de una ronda específica
round_participants (
  id UUID PRIMARY KEY,
  round_id UUID REFERENCES rounds(id),
  participant_id UUID REFERENCES participants(id),
  best_pass_percentage NUMERIC,     -- para animar la ficha en vivo
  solved_at TIMESTAMP,              -- null si no resolvió
  failed_attempts_count INT DEFAULT 0,
  final_rank INT,                   -- calculado al cerrar la ronda
  final_status TEXT                 -- advanced | eliminated
);

-- Cada envío de código individual
submissions (
  id UUID PRIMARY KEY,
  round_participant_id UUID REFERENCES round_participants(id),
  code TEXT,
  language TEXT,
  submitted_at TIMESTAMP,
  test_cases_passed INT,
  test_cases_total INT,
  verdict TEXT,                     -- accepted | wrong_answer | tle | runtime_error | compile_error
  judge0_token TEXT                 -- referencia al submission en Judge0
);
```

`round_participants` es la tabla central: contiene el estado en vivo que alimenta la posición de la ficha, y al cerrar la ronda es donde se calcula `final_rank` aplicando la jerarquía de desempate de la sección 2.3.

---

## 6. Máquina de estados de una ronda

```
PENDING → ACTIVE → CLOSING → CLOSED
```

- **PENDING:** ronda creada, esperando su turno para iniciar.
- **ACTIVE:** se aceptan submissions; cada resultado de Judge0 actualiza `round_participants` y se emite por WebSocket.
- **CLOSING:** se dispara cuando (a) el cupo se llena con solvers confirmados, o (b) `ends_at` se cumple. En este estado ya no se aceptan submissions nuevas; las que ya estaban en la cola terminan de procesarse.
- **CLOSED:** el backend calcula el ranking final (sección 2.3), marca `advanced`/`eliminated` en cada `round_participant`, actualiza `participants.status`, y emite el evento final.

**Importante:** `ends_at` se calcula y guarda en el servidor al iniciar la ronda. El cliente solo lo usa para pintar un countdown visual; nunca es la fuente de verdad del cierre.

---

## 7. Flujo de una submission

1. El participante envía código desde el frontend → `POST /rounds/:id/submissions`.
2. El backend valida que la ronda esté `ACTIVE` y que el participante no exceda el rate limit (ver sección 9).
3. Se encola el job en BullMQ con el código, el problema y sus test cases.
4. Un worker toma el job, lo envía a Judge0 (una ejecución por test case), y agrega los resultados.
5. El worker calcula `test_cases_passed / test_cases_total`, determina el `verdict`, y actualiza `round_participants` y `submissions` en una transacción.
6. Si el problema quedó 100% resuelto, se registra `solved_at` con el timestamp del servidor.
7. Se emite el evento `participant:progress` por WebSocket al room de la ronda.
8. El frontend recibe el evento e interpola visualmente el movimiento de la ficha.

---

## 8. Eventos de WebSocket

| Evento | Dirección | Payload | Propósito |
|---|---|---|---|
| `round:started` | servidor → clientes | `{round_id, ends_at, problem}` | Arranca el timer visual y la pista |
| `participant:progress` | servidor → clientes | `{participant_id, test_cases_passed, test_cases_total, solved: bool}` | Mueve la ficha correspondiente |
| `round:closing_soon` | servidor → clientes | `{seconds_remaining}` | Aviso dramático (ej. últimos 10s) |
| `round:closed` | servidor → clientes | `{ranking: [{participant_id, final_rank, final_status}]}` | Resultado final de la ronda |
| `tournament:winner` | servidor → clientes | `{participant_id}` | Se dispara al cerrar la última ronda |
| `submit:code` | cliente → servidor | `{round_id, code, language}` | Envío de una solución |

**Manejo de reconexión:** si un cliente pierde conexión, el estado vive en la base de datos, no en el socket. Al reconectar, el cliente se re-suscribe al room de la ronda activa y pide un snapshot (`GET /rounds/:id/state`) para ponerse al día antes de seguir recibiendo eventos incrementales.

---

## 9. Dimensionamiento de Judge0 y control de carga

- Con 200 concursantes y, por ejemplo, 10 test cases por problema, una sola "ola" de envíos simultáneos puede generar hasta 2000 ejecuciones en Judge0. Por eso la cola (BullMQ) es obligatoria, no opcional.
- Configurar Judge0 con múltiples workers; como referencia inicial, 8-16 workers en un VPS de 4-8 vCPUs debería cubrir picos de esa magnitud sin colas largas — validar con pruebas de carga propias antes del evento real.
- **Rate limiting por usuario:** limitar cuántas submissions puede hacer un mismo participante por minuto, para que nadie sature la cola reenviando código repetidamente y le quite turno a otros.
- Judge0 self-hosted debe correr en un servidor separado del backend de orquestación (ver arquitectura, sección 3).

---

## 10. Anti-trampas

- **Aislamiento de ejecución:** ya cubierto por el sandboxing de Judge0 (namespaces + cgroups de Linux).
- **Detección de soluciones memorizadas:** si se usan problemas conocidos de LeetCode, hay riesgo de que alguien ya tenga la solución memorizada. Mitigación: preferir problemas propios o variantes con datos/restricciones modificadas respecto al original.
- **Prevención de copiado entre concursantes:** considerar un sistema básico de similitud de código (ej. comparar AST o usar una herramienta tipo MOSS) para submissions dentro de la misma ronda, marcando para revisión manual los pares sospechosamente idénticos.
- **Multi-cuentas:** requerir verificación de cuenta única (email institucional, por ejemplo) si el contexto lo amerita.

---

## 11. Frontend — UI de carrera

- Representar la pista como un componente SVG o HTML/CSS, donde cada ficha tiene una posición `X` calculada a partir de `test_cases_passed / test_cases_total` (0% = inicio de la pista, 100% = línea de meta).
- Usar transiciones CSS (`transform: translateX(...)`) en vez de re-renderizar todo el DOM en cada evento, para que 200 fichas moviéndose simultáneamente no degraden el rendimiento.
- Concursantes eliminados: mantenerlos visibles pero con un estado visual distinto (ficha atenuada/gris) en vez de desaparecer, para claridad narrativa del "battle royale".
- Countdown de ronda basado en `ends_at` del servidor, ajustado por diferencia de reloj cliente-servidor al conectar (ej. sincronizar con un ping inicial).

---

## 12. Endpoints REST (núcleo mínimo)

```
POST   /tournaments                     Crear torneo (config de rondas, dificultad)
POST   /tournaments/:id/participants    Registrar concursante
POST   /tournaments/:id/start           Iniciar torneo (arranca ronda 1)

GET    /rounds/:id/state                Snapshot completo del estado actual (para reconexión)
POST   /rounds/:id/submissions          Enviar código
GET    /rounds/:id/leaderboard          Ranking en vivo (fallback sin WebSocket)

GET    /problems                        Listar banco de problemas
POST   /problems                        Crear problema (statement, test cases, dificultad, tags)
```

---

## 13. Fases de implementación sugeridas

1. **Fase 1 — Núcleo del juez:** integrar Judge0, definir el formato de problemas y test cases, endpoint de submission simple sin UI de carrera (solo texto: aceptado/rechazado).
2. **Fase 2 — Lógica de rondas:** máquina de estados de ronda, jerarquía de desempate, cierre automático por cupo/tiempo, todo probado con datos simulados (sin frontend visual todavía).
3. **Fase 3 — Tiempo real:** integrar WebSockets, emitir eventos de progreso, construir la UI de carrera básica.
4. **Fase 4 — Escala y anti-trampas:** cola de trabajos, rate limiting, pruebas de carga con 200 usuarios simulados, detección de similitud de código.
5. **Fase 5 — Pulido:** panel de administración para configurar el perfil de dificultad por ronda, manejo de reconexión robusto, animaciones finales de la UI.

---

## 14. Puntos abiertos a decidir antes de construir

- Fuente definitiva de problemas (propios vs. licenciados) — ver sección 2.5.
- Política exacta de rate limiting (cuántas submissions por minuto por usuario).
- Si se necesita soporte multi-lenguaje o se restringe a uno o dos lenguajes para simplificar el banco de test cases.
- Mecanismo de autenticación definitivo (email/password vs. OAuth vs. cuentas institucionales).
