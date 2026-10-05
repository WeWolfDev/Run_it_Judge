import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { Entry } from "@/components/ProjectedTrack";
import { PIXEL, TESTS, characterOf, passedOf, useSize, useSpriteBounds, zoneOf } from "./model";
import { Figure } from "./Stage";

// Escena partida en dos, para las vistas de "adentro / afuera". A la
// izquierda un recinto con lugar para el cupo (los mejores puestos), a la
// derecha el resto en fila, el primero marcado como el siguiente en entrar.
// Cada jugador es una casilla con su dibujo de avance (planta, casa) y su personaje.

export type Cell = { entry: Entry; rank: number; passed: number; state: "in" | "zone" | "out" };

type Props = {
  board: Entry[];
  capacity: number;
  closed: boolean;
  /** Recinto: título del cartel y clase del fondo. */
  insideTitle: string;
  insideClass: string;
  outsideClass: string;
  /** Dibujo de avance de cada casilla, a `size` px. */
  drawing: (cell: Cell, size: number) => ReactNode;
  /** Clase extra de cada casilla de afuera (el final: helada, viento). */
  outsideCellClass?: string | undefined;
  /** Lo que se dibuja encima de la zona de afuera (copos, ráfagas). */
  outsideOverlay?: ReactNode | undefined;
  /** Fondo con piezas y decorado de cada zona (cerco, árboles, nubes). */
  insideStyle?: CSSProperties | undefined;
  outsideStyle?: CSSProperties | undefined;
  insideDecor?: ReactNode | undefined;
  outsideDecor?: ReactNode | undefined;
};

export function SplitScene(props: Props) {
  const { board, capacity, closed } = props;
  const [ref, size] = useSize<HTMLDivElement>();
  useSpriteBounds(board.map(characterOf));
  const cells: Cell[] = board.map((entry, i) => ({
    entry,
    rank: i + 1,
    passed: passedOf(entry),
    state: zoneOf(entry, i + 1, capacity, closed),
  }));
  const inside = cells.slice(0, capacity);
  const outside = cells.slice(capacity);
  const n = Math.max(1, board.length);
  const insideW = size.width * Math.min(0.56, Math.max(0.32, (capacity / n) * 1.25));
  const outsideW = size.width - insideW - size.width * 0.03;
  const bodyH = size.height * 0.84;

  return (
    <div ref={ref} className="relative flex h-full gap-[3%] overflow-hidden rounded-xl">
      <Zone
        cells={inside}
        slots={capacity}
        width={insideW}
        height={bodyH}
        className={props.insideClass}
        title={props.insideTitle}
        drawing={props.drawing}
        style={props.insideStyle}
        decor={props.insideDecor}
      />
      <Zone
        cells={outside}
        slots={outside.length}
        width={outsideW}
        height={bodyH}
        className={props.outsideClass}
        title={`Afuera · ${outside.length}`}
        drawing={props.drawing}
        cellClass={props.outsideCellClass}
        markNext={!closed}
        overlay={props.outsideOverlay}
        style={props.outsideStyle}
        decor={props.outsideDecor}
      />
    </div>
  );
}

function Zone({
  cells,
  slots,
  width,
  height,
  className,
  title,
  drawing,
  cellClass,
  markNext = false,
  overlay,
  style,
  decor,
}: {
  cells: Cell[];
  slots: number;
  width: number;
  height: number;
  className: string;
  title: string;
  drawing: Props["drawing"];
  cellClass?: string | undefined;
  markNext?: boolean;
  overlay?: ReactNode;
  style?: CSSProperties | undefined;
  decor?: ReactNode;
}) {
  const count = Math.max(1, slots);
  // Casillas un poco más altas que anchas: dibujo, personaje y nombre.
  const cols = Math.max(1, Math.ceil(Math.sqrt((count * width) / height / 0.85)));
  const rows = Math.ceil(count / cols);
  const cellW = width / cols;
  const cellH = height / Math.max(1, rows);
  const art = Math.max(18, Math.min(cellW * 0.62, cellH * 0.5, 72));
  const room = Math.max(14, Math.min(art * 0.55, 34));
  return (
    <section
      className={cn("pub-zone relative flex flex-col", className)}
      style={{ ...style, width }}
    >
      {decor}
      <p
        className="pub-zone-title relative z-[1] px-[0.8vw] py-[0.4vw] text-[clamp(0.55rem,0.85vw,1.15rem)]"
        style={PIXEL}
      >
        {title}
      </p>
      <div
        className="relative z-[1] grid flex-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, alignContent: "start" }}
      >
        {Array.from({ length: slots }, (_, i) => {
          const cell = cells[i];
          if (!cell) {
            // Lugar libre del recinto: nadie llegó todavía a este puesto.
            return (
              <div key={`free-${i}`} className="grid place-items-center" style={{ height: cellH }}>
                <span className="pub-free-slot" style={{ width: art * 0.8, height: art * 0.8 }} />
              </div>
            );
          }
          const next = markNext && i === 0;
          return (
            <div
              key={cell.entry.participant_id}
              className={cn("pub-cell flex flex-col items-center justify-end", cellClass)}
              style={{
                height: cellH,
                animationDelay: cellClass ? `${(i % 10) * 90}ms` : undefined,
              }}
            >
              <div key={cell.passed} className="animate-run-it-pop flex items-end">
                {drawing(cell, art)}
                <Figure
                  index={characterOf(cell.entry)}
                  room={room}
                  state={cellClass ? "out" : "idle"}
                />
              </div>
              <span
                className={cn(
                  "pub-name mt-[0.2vw] max-w-full truncate text-[clamp(0.5rem,0.65vw,0.9rem)]",
                  next ? "pub-next-tag" : cell.state === "out" ? "pub-name-out" : "pub-name-in",
                )}
                style={{ maxWidth: cellW * 0.95 }}
              >
                {next ? "▶ " : ""}
                {cell.rank}. {cell.entry.display_name}{" "}
                <span className="opacity-70">
                  {cell.passed}/{TESTS}
                </span>
              </span>
            </div>
          );
        })}
        {overlay}
      </div>
    </section>
  );
}
