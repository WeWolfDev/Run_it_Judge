<div align="center">

<img src="docs/screens/banner.png" alt="Run It" width="720">

🌐 **Español** · [English](README.en.md)

### Torneos de programación competitiva por eliminación, con pista de carreras en vivo

Cada participante es un corredor. Cada test que pasa lo acerca a la meta.<br>
Cada ronda deja afuera a los que no llegan. **Gana el último en pie.**

![Node](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TanStack Start](https://img.shields.io/badge/TanStack_Start-1.168-FF4154)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-tiempo_real-010101?logo=socketdotio&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?logo=redis&logoColor=white)
![Judge0](https://img.shields.io/badge/Judge0-1.13-F7931E)

[Cómo se juega](#-cómo-se-juega) ·
[Organizador](#-panel-del-organizador) ·
[Participante](#-la-pantalla-del-participante) ·
[Pista y público](#-la-pista-y-la-pantalla-del-público) ·
[Voto del público](#-voto-del-público-hits) ·
[Ceremonia](#-ceremonia-de-premios) ·
[Arquitectura](#-arquitectura) ·
[Desarrollo](#-desarrollo)

<img src="docs/screens/login.jpg" alt="Pantalla de inicio de Run It con estética arcade" width="900">

</div>

---

## 🏁 Cómo se juega

Run It convierte un torneo de programación en una carrera que se puede proyectar
en una sala. El organizador arma las rondas, los participantes resuelven
problemas y el público mira cómo avanzan los corredores en la pista.

```text
  Ronda 1            Ronda 2            Ronda 3            Final
  ┌────────┐         ┌────────┐         ┌────────┐         ┌────────┐
  │ 16 🐎  │  ─────▶ │  8 🐎  │  ─────▶ │  4 🐎  │  ─────▶ │  1 🏆  │
  │ cupo 8 │         │ cupo 4 │         │ cupo 1 │         │        │
  └────────┘         └────────┘         └────────┘         └────────┘
```

1. **Cada ronda tiene un problema, un cupo y un tiempo.** La ronda cierra cuando
   se llena el cupo de clasificados o cuando se acaba el reloj.
2. **Clasifican los primeros en resolver** todos los casos de prueba. El resto
   queda eliminado.
3. **Los clasificados pasan solos a la ronda siguiente.** Nadie de afuera puede
   entrar a mitad del torneo.
4. **La ronda que deja un solo clasificado es la final.** Ese corredor gana el
   torneo y arranca la ceremonia de premios.

### Orden del ranking

Cuando hay que desempatar, se aplica en este orden:

| # | Criterio | Detalle |
| --- | --- | --- |
| 1 | **Completó** | Quien pasó todos los casos va antes que quien no. |
| 2 | **Llegada** | Entre los que completaron, el que llegó primero. |
| 3 | **Tests** | Entre los que no completaron, más porcentaje de casos pasados. |
| 4 | **Penalizaciones** | Cada envío fallido suma **30 s** de penalización. |

### Lenguajes

| Lenguaje | Compilador en Judge0 |
| --- | --- |
| C | GCC 9.2.0 |
| C++ | GCC 9.2.0 |
| Python | Python 3 |

Las plantillas iniciales de cada lenguaje están en
[`plantillas_lenguajes/`](plantillas_lenguajes/).

---

## 🛠 Panel del organizador

Todo el torneo se maneja desde `/admin`, organizado en pestañas.

### Control de ronda

El tablero de la ronda en curso: cupo, conectados, cuántos resolvieron, envíos,
el reloj y la cola de evaluación de Judge0. Desde acá se inicia la ronda (con una
cuenta regresiva de 10 s), se pausa o se fuerza el cierre. A la derecha,
**Progreso del torneo** muestra todas las rondas, cuál se puede iniciar y por
qué no las demás.

<img src="docs/screens/admin-control-ronda.png" alt="Control de ronda del panel de administración" width="900">

### Rondas

Crear el torneo y planificar todas sus rondas de una vez: dificultad, problema,
cupo de clasificados y tiempo. Las rondas pendientes se pueden editar hasta que
empiezan; la siguiente se llena sola con los clasificados de la anterior.

<img src="docs/screens/admin-rondas.png" alt="Planificación de rondas del torneo" width="900">

### Problemas

Cada problema tiene enunciado (con soporte para fórmulas KaTeX), dificultad y
casos de prueba. Los casos se cargan a mano o se importan desde un `.zip`. Los
marcados como **ejemplo público** son los que ve el participante; el resto queda
oculto. La **pista del organizador** solo se revela si la grada la gana en una
votación.

> Los casos no se pueden cambiar mientras una ronda en curso use el problema. El
> nombre, el enunciado y la dificultad, sí.

<img src="docs/screens/admin-crear-problema.png" alt="Formulario para crear un problema con casos de prueba" width="900">

### Acceso

Los participantes se registran con un **código de acceso** de un solo uso. El
organizador los genera en lote, con vencimiento y, opcionalmente, atados a un
torneo: cuando el torneo termina, sus códigos se invalidan. Más detalle en
[`CODIGOS_ACCESO.md`](CODIGOS_ACCESO.md).

<img src="docs/screens/admin-codigos-acceso.png" alt="Generación y listado de códigos de acceso" width="900">

### Historial

Los torneos terminados salen de los selectores y quedan acá hasta que se borran.
También permite limpiar usuarios que se registraron y nunca entraron a un torneo.

<img src="docs/screens/admin-historial.png" alt="Historial de torneos" width="900">

---

## 🎮 La pantalla del participante

### 1. Elegir corredor

Antes de la primera ronda cada participante elige su personaje entre varias
familias (clásicos, animales, Tiny Heroes, aldeanos, humanos, NPC). Es su
caballo en la pista durante todo el torneo y no se puede cambiar.

<img src="docs/screens/participante-personaje.png" alt="Selección de personaje" width="900">

### 2. Sala de espera y cuenta regresiva

Mientras el organizador no inicia la ronda, el participante espera en la línea
de salida. Al iniciarla, una cuenta regresiva avisa que el editor está por
abrirse.

<table>
  <tr>
    <td width="50%"><img src="docs/screens/participante-espera.jpg" alt="Sala de espera antes de la ronda"></td>
    <td width="50%"><img src="docs/screens/participante-cuenta-regresiva.jpg" alt="Cuenta regresiva antes de abrir el editor"></td>
  </tr>
  <tr>
    <td align="center"><sub>Esperando que el organizador inicie la ronda</sub></td>
    <td align="center"><sub>¡Prepárate! El editor se abre al llegar a cero</sub></td>
  </tr>
</table>

### 3. Resolver

Enunciado a la izquierda, editor con plantilla a la derecha, reloj arriba. Abajo,
los ejemplos públicos y el historial de envíos.

<img src="docs/screens/participante-editor.jpg" alt="Editor de código del participante" width="900">

**Probar** corre el código contra los ejemplos (o contra una entrada propia) y
**no cuenta como envío**. **Enviar solución** lo evalúa contra todos los casos,
visibles y ocultos.

<img src="docs/screens/participante-probar-casos.png" alt="Resultados de probar contra los ejemplos" width="900">

### 4. Clasificar

Al pasar todos los casos, el lugar queda asegurado y el editor se bloquea: no
hace falta enviar más en esa ronda.

<img src="docs/screens/participante-clasificado.jpg" alt="Participante clasificado con el editor bloqueado" width="900">

---

## 📺 La pista y la pantalla del público

### `/pista` — la carrera

Pensada para proyectar. Cada corredor avanza según el porcentaje de tests que
resolvió; los que clasificaron se marcan en verde y el panel lateral cuenta el
cupo y narra lo que pasa en vivo.

<img src="docs/screens/pista-jugadores.jpeg" alt="Pista con cuatro corredores, uno ya en la meta" width="900">

<table>
  <tr>
    <td width="50%"><img src="docs/screens/pista-en-curso.png" alt="Pista al inicio de la ronda"></td>
    <td width="50%"><img src="docs/screens/pista-meta.png" alt="Corredor llegando a la meta"></td>
  </tr>
  <tr>
    <td align="center"><sub>Línea de salida, 0 %</sub></td>
    <td align="center"><sub>En la meta, 100 % y clasificado</sub></td>
  </tr>
</table>

### `/publico` — escenarios temáticos

Otra forma de mostrar la misma ronda, con escenarios que se pueden alternar:
**La pista**, **La torre de lava**, **Globos al cielo**, **Fútbol: el arco** y
**El bote salvavidas**. En *Globos al cielo*, cada bloque de tests sube el globo
un nivel y los que entran en la nube dorada son los que pasan.

<table>
  <tr>
    <td width="50%"><img src="docs/screens/publico-globos.jpg" alt="Globos al cielo, inicio de la ronda"></td>
    <td width="50%"><img src="docs/screens/publico-globos-nube.jpg" alt="Globos al cielo, corredor en la nube dorada"></td>
  </tr>
  <tr>
    <td align="center"><sub>El globo despega</sub></td>
    <td align="center"><sub>Llegó a la nube dorada: clasificado</sub></td>
  </tr>
</table>

Las dos pantallas muestran un QR para que la grada vote en `/votar`.

---

## 🗳 Voto del público (hits)

Con la ronda en curso, el organizador anuncia una votación: la grada escanea el
QR y, sin cuenta, elige entre un **hit bueno** y uno **malo** del mismo peso.
Hay 15 s de aviso y 40 s para votar. El efecto cae sobre todos los corredores por
igual y **nunca toca el editor, el enunciado ni el veredicto**.

| Peso | Hit bueno 🟢 | Hit malo 🔴 |
| :---: | --- | --- |
| 1 | **Pista del organizador**: se revela la pista del problema | **Reloj oculto**: el reloj desaparece 60 s |
| 1 | **Aliento de la grada**: ánimo en pantalla | **Apagón**: pantalla a oscuras 45 s |
| 2 | **Minuto extra**: +60 s a la ronda | **Niebla**: el ranking se oculta 75 s |
| 2 | **Amnistía**: los fallos no penalizan por 90 s | **Penalización doble**: cada fallo cuesta el doble por 120 s |
| 3 | **Cupo +1**: clasifica uno más | **Cupo −1**: clasifica uno menos |

Reglas: máximo 2 votaciones por ronda, ninguna en el primer minuto ni en los
últimos 2, y cada par se usa una sola vez. Quien tiene sesión iniciada no vota.

---

## 🏆 Ceremonia de premios

Cuando queda un solo clasificado el torneo termina. La ceremonia se ve en la
pista y en la pantalla de cada participante, y el organizador la avanza paso a
paso desde *Progreso del torneo*.

<img src="docs/screens/ceremonia-ganador.jpg" alt="Anuncio del ganador del torneo" width="900">

Después del ganador se revelan los premios uno por uno. Un premio sin candidato
queda desierto.

| Premio | A quién va |
| --- | --- |
| 🔥 **El Ave Fénix** | Clasificó estando al borde de la eliminación. |
| 🗡 **El Matagigantes** | El jugador revelación que dejó afuera a un favorito. |
| 🛡 **Superviviente** | Clasificó sin resolver, por desempate. |
| ⚔️ **El Verdugo** | Más rondas ganadas siendo el primero en resolver. |
| ⚡ **El Rayo del AC** | El primer *Accepted* del torneo. |
| 🚀 **Compilador O(1) Humano** | La solución más rápida en el juez. |
| 💪 **Amigo del Penalizador** | Más envíos fallidos en un solo problema, sin rendirse. |
| 👑 **GMA · Gran Maestro del Algoritmo** | El ganador del torneo. |

<img src="docs/screens/ceremonia-premio.jpg" alt="Revelación del premio Gran Maestro del Algoritmo" width="900">

<img src="docs/screens/ceremonia-final.jpg" alt="Pantalla de cierre: ¡Gracias por correr!" width="900">

---

## 🎨 Paletas y sonido

Cada usuario elige su paleta desde la barra superior y se guarda en su
navegador: **Arcade Neón**, **Atardecer Synthwave**, **Ficha Dorada** y
**Pantalla CRT**. Los efectos de sonido (ZzFX) se pueden apagar desde el mismo
lugar.

---

## 🧱 Arquitectura

```text
Internet
  │
  ├──▶ nginx :80/:443  (TLS Let's Encrypt)
  │       ├──▶ frontend  TanStack Start   :3002
  │       └──▶ backend   Fastify + Socket.io :3001
  │                ├──▶ PostgreSQL :5433   (base run_it)
  │                ├──▶ Redis      :6380   (sesiones + cola BullMQ)
  │                └──▶ Judge0     :2358   (sandbox de ejecución)
  │
  └──▶ Tailscale Funnel ──▶ 127.0.0.1:8080 ──▶ nginx
```

**Recorrido de un envío:** el participante envía → el backend lo encola en
BullMQ → el worker lo manda a Judge0 caso por caso → el resultado vuelve por
Socket.io a la pantalla del participante, la pista y el panel.

| Capa | Tecnología |
| --- | --- |
| Frontend | Vite 8 · TanStack Start · React 19 · Tailwind CSS 4 |
| SSR | Nitro (`node-server`) |
| Backend | Fastify 5 · Socket.io · BullMQ |
| Datos | PostgreSQL 16 · Redis 7 |
| Juez | Judge0 1.13 (Docker, `linux/amd64`, `privileged`) |
| Publicación | nginx · Tailscale Funnel |

### Estructura del repositorio

```text
frontend/              App TanStack Start
  src/routes/          login, admin, participante, pista, publico, votar, reglas, legal
  src/components/      AdminPanel, ProjectedRace, ParticipantView, publico/
run-it-backend/        API Fastify + Socket.io
  index.js             Rutas, auth, rondas, scoring y sockets
  hits.js              Reglas del voto del público
  awards.js            Premios de la ceremonia
  queue.js             Cola BullMQ hacia Judge0
  schema.sql           Esquema idempotente, se aplica en cada arranque
deploy/                Scripts de desarrollo, deploy, backup, smoke y e2e
plantillas_lenguajes/  Plantillas iniciales de C, C++ y Python
docs/screens/          Capturas de este README
```

---

## 💻 Desarrollo

Requiere **Node.js 22.12 o superior** y Docker. Judge0 necesita un host
`x86_64`: en Apple Silicon el sandbox no ejecuta código.

```bash
# Una vez por máquina
sudo docker compose -p runit-dev -f docker-compose.dev.yml up -d
deploy/dev-branch.sh bootstrap-db

# Cada sesión
deploy/dev-branch.sh up        # backend :5000 + frontend :4000 con HMR
deploy/dev-branch.sh restart   # después de checkout, pull o merge
deploy/dev-branch.sh down
```

Verificaciones antes de commitear:

```bash
cd frontend && npm run typecheck && npm run lint
cd ../run-it-backend && npm test
```

### Flujo de un torneo por API

```text
POST /tournaments                  crear torneo
PUT  /tournaments/:id/plan         planificar las rondas
POST /access-codes/generate        generar códigos
POST /auth/register                registrarse con un código
POST /rounds/:id/participants/join unirse a la primera ronda
POST /rounds/:id/start             iniciar la ronda
POST /rounds/:id/close             cerrar (o se cierra sola al vencer)
POST /rounds/:id/next              pasar los clasificados a la siguiente
```

---

## 🤝 Contribuir y licencia

Run It tiene **todos los derechos reservados**. El código es público para que se
pueda leer y mejorar: se puede hacer un fork **solo para proponer cambios a este
repositorio**. No se permite copiarlo, reusarlo ni redistribuirlo sin permiso
escrito de WeWolfDev.

- Cómo contribuir y qué implica abrir un PR: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Términos completos: [`LICENSE`](LICENSE)
- Los recursos de terceros (sprites, fondos, fuentes, sonido) tienen su propia
  licencia: [`CREDITS.md`](CREDITS.md)

---

## 📚 Documentación

| Documento | Contenido |
| --- | --- |
| [`BACKEND_RUN_IT.md`](BACKEND_RUN_IT.md) | API, variables de entorno y flujo de alta |
| [`DEVELOPMENT_COMMANDS.md`](DEVELOPMENT_COMMANDS.md) | Entorno de desarrollo y túnel SSH |
| [`MIGRACION_SERVIDOR_RUN_IT.md`](MIGRACION_SERVIDOR_RUN_IT.md) | Deploy, rollback y diagnóstico en producción |
| [`CODIGOS_ACCESO.md`](CODIGOS_ACCESO.md) | Códigos de acceso y sus estados |
| [`LOCAL_CHANGES_CONFIG.md`](LOCAL_CHANGES_CONFIG.md) | Aislamiento entre desarrollo y producción |
| [`CHANGELOG_RUN_IT.md`](CHANGELOG_RUN_IT.md) | Bitácora y pendientes |
| [`CREDITS.md`](CREDITS.md) | Créditos y licencias de sprites, fondos, fuentes y sonido |

---

<div align="center">

**Run It** · Hecho por WeWolfDev<br>
<sub>Leonardo San Martin Lopez · Cesar Augusto</sub><br>
<sub>Sprites, fondos y fuentes de terceros: ver <a href="CREDITS.md">CREDITS.md</a></sub>

</div>
