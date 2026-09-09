# Run it General

Construye la interfaz de "Run It", una plataforma de torneos de programación competitiva por eliminación, con estética de carrera de caballos. Genera las pantallas en React + Tailwind CSS.

===== CONTEXTO DEL PRODUCTO =====

Run It es un torneo tipo "battle royale" donde los concursantes resuelven problemas de programación en rondas sucesivas. Cada concursante se representa como un caballo que avanza por una pista según el % de test cases que ha resuelto. Una ronda se cierra cuando se llena el cupo de clasificados o se acaba el tiempo, lo que ocurra primero. Los que no clasifican quedan eliminados y el torneo continúa hasta que queda un solo ganador.

===== ESTÉTICA VISUAL =====

Estilo limpio, plano, tipo SaaS moderno: sin gradientes ni sombras decorativas, bordes finos de 1px, esquinas redondeadas (8-12px), tipografía sans-serif, paleta neutra (blancos/grises) con acento en azul/negro. La pista de carrera usa un fondo tono tierra/arena para reforzar la metáfora hípica. Colores de "silks" (casaca) distintos por corredor: morado, verde azulado, coral, ámbar, azul, rosa. Estados semánticos: verde = resuelto/clasificado, azul claro = en curso, rojo = eliminado, gris = eliminado de rondas anteriores.

===== COMPONENTE 1: PISTA DE CARRERA (el corazón visual) =====

Un carril horizontal por participante, apilados verticalmente:

- Número de carril a la izquierda de cada fila

- Línea de pista con textura de tierra (surcos sutiles), no una barra de progreso genérica

- Meta a cuadros (patrón blanco/negro) al final de cada carril

- Ícono de caballo que se desplaza horizontalmente según % de avance, con animación de galope sutil (rebote/inclinación en su propio eje, independiente del desplazamiento) y una pequeña estela de polvo detrás

- Nombre del participante junto al caballo, fuente monoespaciada, con badge de color de "silk" distinto por carril

- Bandera 🏁 junto al nombre cuando el participante resuelve al 100%

- Participantes eliminados: gris, nombre tachado, sin animación, detenidos en 0%

- El movimiento entre posiciones se anima con transición suave (~0.5-0.6s), nunca saltos instantáneos

- Header de la pista: nombre/número de ronda, nombre del problema, timer regresivo grande (MM:SS) a la derecha, contador "X de Y cupos ocupados"

===== COMPONENTE 2: PANEL DE ADMINISTRADOR =====

Layout de dos columnas (70/30).

Columna izquierda:

- Tarjeta "Control de la ronda actual": nombre del problema + timer grande, tres mini-tarjetas de estadística (Cupo, Ya resolvieron, Activos), y dos botones: "Pausar ronda" (secundario) y "Forzar cierre" (acento rojo, acción de emergencia)

- Tarjeta "Participantes en esta ronda": buscador + tabla con columnas Nombre / Avance % / Intentos / Estado (badges de color)

Columna derecha (sidebar):

- Tarjeta "Configurar ronda": dropdown de Problema, dropdown de Dificultad (Fácil/Medio/Difícil), input numérico de Cupo de clasificación, input numérico de Tiempo límite, botón "Guardar y aplicar a próxima ronda"

- Tarjeta "Progreso del torneo": lista compacta ronda por ronda mostrando cuántos concursantes entraron y cuántos avanzaron (ej. "Ronda 1: 200 → 100"), ronda activa resaltada, futuras en gris

===== COMPONENTE 3: VISTA DEL PARTICIPANTE =====

Header: ronda y cupo a la izquierda, nombre del problema como título, timer grande a la derecha.

Barra de progreso personal ancho completo debajo del header: ícono de caballo + barra delgada con etiqueta "tú" sobre la posición actual + porcentaje.

Dos columnas (50/50):

- Izquierda: tarjeta "Enunciado" (descripción + bloques de Entrada/Salida en fuente monoespaciada sobre fondo gris), tarjeta "Resultados de tus tests" con chips por test case (verde check / rojo X / gris pendiente)

- Derecha: editor de código estilo VS Code dark — barra superior con selector de lenguaje, textarea con fondo oscuro y fuente monoespaciada, barra inferior con botones "Probar" (secundario) y "Enviar solución" (acento, acción principal)

===== DATOS Y EVENTOS EN TIEMPO REAL =====

Los datos llegan por WebSocket (Socket.io) con estos eventos — usa esta forma exacta como contrato de datos en el componente, con datos mock mientras no haya backend conectado:

- round:started -> { round_id, ends_at, problem, capacity }

- participant:progress -> { participant_id, test_cases_passed, test_cases_total, solved: bool }

- round:closing_soon -> { seconds_remaining }

- round:closed -> { ranking: [{ participant_id, final_rank, final_status }] }

- tournament:winner -> { participant_id }

El timer se calcula a partir de `ends_at` (timestamp del servidor), nunca del reloj local del navegador. Estructura el código para que sea fácil reemplazar los datos mock por una conexión real de socket.io-client después.

===== ENTREGABLE =====

Genera los tres componentes como archivos React separados y reutilizables (RaceTrack.jsx, AdminPanel.jsx, ParticipantView.jsx), con datos de ejemplo hardcodeados para poder visualizarlos de inmediato sin backend.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6bc0d733-2915-4a9e-866a-a57839456a9d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
