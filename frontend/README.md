# Run It — brief de diseño del frontend

Interfaz de "Run It": plataforma de torneos de programación competitiva por
eliminación, con estética de carrera de caballos, en React + Tailwind CSS.

## Contexto del producto

Run It es un torneo tipo "battle royale" donde los concursantes resuelven
problemas de programación en rondas sucesivas. Cada concursante se representa
como un caballo que avanza por una pista según el % de test cases que ha
resuelto. Una ronda se cierra cuando se llena el cupo de clasificados o se
acaba el tiempo, lo que ocurra primero. Los que no clasifican quedan
eliminados y el torneo continúa hasta que queda un solo ganador.

## Estética visual

Estilo limpio, plano, tipo SaaS moderno: sin gradientes ni sombras decorativas,
bordes finos de 1px, esquinas redondeadas (8-12px), tipografía sans-serif,
paleta neutra (blancos/grises) con acento en azul/negro. La pista de carrera
usa un fondo tono tierra/arena para reforzar la metáfora hípica. Colores de
"silks" (casaca) distintos por corredor: morado, verde azulado, coral, ámbar,
azul, rosa. Estados semánticos: verde = resuelto/clasificado, azul claro = en
curso, rojo = eliminado, gris = eliminado de rondas anteriores.

## Componente 1: pista de carrera (el corazón visual)

Un carril horizontal por participante, apilados verticalmente:

- Número de carril a la izquierda de cada fila
- Línea de pista con textura de tierra (surcos sutiles), no una barra de
  progreso genérica
- Meta a cuadros (patrón blanco/negro) al final de cada carril
- Ícono de caballo que se desplaza horizontalmente según % de avance, con
  animación de galope sutil (rebote/inclinación en su propio eje,
  independiente del desplazamiento) y una pequeña estela de polvo detrás
- Nombre del participante junto al caballo, fuente monoespaciada, con badge de
  color de "silk" distinto por carril
- Bandera 🏁 junto al nombre cuando el participante resuelve al 100%
- Participantes eliminados: gris, nombre tachado, sin animación, detenidos en 0%
- El movimiento entre posiciones se anima con transición suave (~0.5-0.6s),
  nunca saltos instantáneos
- Header de la pista: nombre/número de ronda, nombre del problema, timer
  regresivo grande (MM:SS) a la derecha, contador "X de Y cupos ocupados"

## Componente 2: panel de administrador

Layout de dos columnas (70/30).

Columna izquierda:

- Tarjeta "Control de la ronda actual": nombre del problema + timer grande,
  tres mini-tarjetas de estadística (Cupo, Ya resolvieron, Activos), y dos
  botones: "Pausar ronda" (secundario) y "Forzar cierre" (acento rojo, acción
  de emergencia)
- Tarjeta "Participantes en esta ronda": buscador + tabla con columnas Nombre
  / Avance % / Intentos / Estado (badges de color)

Columna derecha (sidebar):

- Tarjeta "Configurar ronda": dropdown de Problema, dropdown de Dificultad
  (Fácil/Medio/Difícil), input numérico de Cupo de clasificación, input
  numérico de Tiempo límite, botón "Guardar y aplicar a próxima ronda"
- Tarjeta "Progreso del torneo": lista compacta ronda por ronda mostrando
  cuántos concursantes entraron y cuántos avanzaron (ej. "Ronda 1: 200 →
  100"), ronda activa resaltada, futuras en gris

## Componente 3: vista del participante

Header: ronda y cupo a la izquierda, nombre del problema como título, timer
grande a la derecha.

Barra de progreso personal ancho completo debajo del header: ícono de caballo
+ barra delgada con etiqueta "tú" sobre la posición actual + porcentaje.

Dos columnas (50/50):

- Izquierda: tarjeta "Enunciado" (descripción + bloques de Entrada/Salida en
  fuente monoespaciada sobre fondo gris), tarjeta "Resultados de tus tests"
  con chips por test case (verde check / rojo X / gris pendiente)
- Derecha: editor de código estilo VS Code dark — barra superior con selector
  de lenguaje, textarea con fondo oscuro y fuente monoespaciada, barra
  inferior con botones "Probar" (secundario) y "Enviar solución" (acento,
  acción principal)

## Datos y eventos en tiempo real

Los datos llegan por WebSocket (Socket.io) con estos eventos; usa esta forma
exacta como contrato de datos en los componentes, con datos mock mientras no
haya backend conectado:

- round:started -> { round_id, ends_at, problem, capacity }
- participant:progress -> { participant_id, test_cases_passed, test_cases_total, solved: bool }
- round:closing_soon -> { seconds_remaining }
- round:closed -> { ranking: [{ participant_id, final_rank, final_status }] }
- tournament:winner -> { participant_id }

El timer se calcula a partir de `ends_at` (timestamp del servidor), nunca del
reloj local del navegador.

## Desarrollo

```sh
npm i
npm run dev
```

En producción el frontend se compila con `VITE_API_URL="" VITE_SOCKET_URL="/"`
y se sirve por SSR (preset node-server); ver `../RUN_IT.md`.

> Proyecto conectado a [Lovable](https://lovable.dev): no reescribir el
> historial publicado del repositorio (ver `AGENTS.md` en este directorio).