import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { Entry } from "@/components/ProjectedTrack";
import {
  LEVELS,
  PER_LEVEL,
  PIXEL,
  TESTS,
  characterOf,
  levelOf,
  useFinale,
  useNow,
  useSize,
  useSpriteBounds,
  viewInfo,
  type ViewProps,
} from "./model";
import { Banner, Figure, Stage } from "./Stage";

// la torre. Un piso cada 6 tests pasados (0/30 abajo, la cima arriba con
// los 30): cada bloque de 6 tests sube al participante un piso. Al terminar la ronda los
// clasificados saltan a la cima y la lava sube piso por piso.

/** Final: ¡tiempo!, ascenso, lava piso por piso, pasan N y el resumen. */
const LAVA_FLOOR_MS = 700;
const FINALE = [1600, 2400, LAVA_FLOOR_MS * LEVELS + 1200, 2600];
const FLOORS = Array.from({ length: LEVELS + 1 }, (_, i) => LEVELS - i);

export function TowerView(props: ViewProps) {
  const { round, board } = props;
  const step = useFinale(round.closed, FINALE);
  const now = useNow(props.serverOffsetMs, 1000);
  const [ref, size] = useSize<HTMLDivElement>();
  const lava = useLavaFloors(step);
  const moved = useMoved(board, step);
  useSpriteBounds(board.map(characterOf));

  const floorH = size.height / FLOORS.length;
  const room = Math.max(18, Math.min(floorH * 0.42, 46));
  const slot = room * 1.25;
  const capacity = round.capacity;
  const ascended = step >= 1;
  const floorOf = (entry: Entry) =>
    ascended && entry.final_status === "advanced" ? LEVELS : levelOf(entry);
  const solved = board.filter((e) => e.solved_at).length;

  // Antes del final la lava asoma y crece con el tiempo: presión visual.
  const span = Math.max(1, round.endsAt - round.startsAt);
  const elapsed = Math.min(1, Math.max(0, (now - round.startsAt) / span));
  const lavaH = step >= 2 ? lava * floorH : floorH * (0.18 + 0.32 * elapsed);

  return (
    <Stage view={viewInfo("torre")} {...props} step={step} summaryStep={FINALE.length}>
      <div ref={ref} className="pub-tower relative h-full overflow-hidden rounded-xl">
        {FLOORS.map((floor, fi) => {
          const people = board
            .map((entry, i) => ({ entry, rank: i + 1 }))
            .filter(({ entry }) => floorOf(entry) === floor);
          const covered = step >= 2 && floor < LEVELS && floor < lava;
          const fits = Math.max(1, Math.floor((size.width * 0.66) / slot));
          const shown = people.slice(0, fits);
          const split = shown.filter((p) => p.rank <= capacity).length;
          const innerCut = !round.closed && floor < LEVELS && split > 0 && split < people.length;
          const isTop = floor === LEVELS;
          return (
            <div
              key={floor}
              className={cn(
                "pub-floor absolute inset-x-0 flex",
                isTop && "pub-floor-top",
                covered && "pub-floor-covered",
              )}
              style={{ top: fi * floorH, height: floorH }}
            >
              <div className="pub-floor-label grid w-[8vw] shrink-0 place-content-center text-center">
                <span className="text-[clamp(0.6rem,1.05vw,1.4rem)]" style={PIXEL}>
                  {floor * PER_LEVEL}/{TESTS}
                </span>
                {isTop && (
                  <span className="mt-[0.4vw] text-[clamp(0.5rem,0.7vw,0.95rem)]">CIMA</span>
                )}
              </div>
              <div className="relative flex min-w-0 flex-1 items-end gap-0 px-[0.8vw] pb-[0.35vw]">
                {shown.map(({ entry, rank }, i) => (
                  <PersonSlot
                    key={entry.participant_id}
                    entry={entry}
                    room={room}
                    slot={slot}
                    covered={covered}
                    moved={moved.has(entry.participant_id)}
                    dim={!round.closed && rank > capacity && floor < LEVELS}
                    cutBefore={innerCut && i === split}
                    showName={floorH > 70}
                  />
                ))}
                {people.length > shown.length && (
                  <span className="mb-[0.6vw] ml-[0.4vw] text-[clamp(0.7rem,0.9vw,1.2rem)] text-muted-foreground">
                    +{people.length - shown.length}
                  </span>
                )}
                {isTop && !round.closed && capacity > solved && (
                  <span className="ml-[0.6vw] flex items-end gap-[0.25vw] pb-[0.2vw]">
                    {Array.from(
                      { length: Math.min(capacity - solved, Math.max(0, fits - shown.length - 2)) },
                      (_, i) => (
                        <span
                          key={i}
                          className="pub-empty-slot"
                          style={{ width: room * 0.8, height: room * 0.9 }}
                        />
                      ),
                    )}
                  </span>
                )}
                <FloorCaption
                  floor={floor}
                  count={people.length}
                  closed={round.closed}
                  ascended={ascended}
                  free={capacity - solved}
                  capacity={capacity}
                  innerCut={innerCut}
                  covered={covered}
                />
              </div>
            </div>
          );
        })}
        <div
          className="pub-lava pointer-events-none absolute inset-x-0 bottom-0"
          style={{ height: lavaH }}
        >
          <span className="pub-lava-label" style={PIXEL}>
            {step >= 2
              ? lava >= LEVELS
                ? "La lava llegó a la cima"
                : "La lava sube"
              : "La lava sube al terminar la ronda"}
          </span>
        </div>
        {step === 0 && (
          <Banner tone="danger">{solved >= capacity ? "¡Cupo lleno!" : "¡Tiempo!"}</Banner>
        )}
        {step === 1 && <Banner tone="success">Los clasificados saltan a la cima</Banner>}
        {step === 3 && <Banner tone="success">Pasan {capacity}</Banner>}
      </div>
    </Stage>
  );
}

function PersonSlot({
  entry,
  room,
  slot,
  covered,
  moved,
  dim,
  cutBefore,
  showName,
}: {
  entry: Entry;
  room: number;
  slot: number;
  covered: boolean;
  moved: boolean;
  dim: boolean;
  cutBefore: boolean;
  showName: boolean;
}) {
  return (
    <>
      {cutBefore && (
        <span className="pub-inner-cut mx-[0.4vw] self-stretch" style={PIXEL}>
          <span>Corte</span>
        </span>
      )}
      <span
        className={cn(
          "flex flex-col items-center",
          moved && "animate-run-it-pop",
          dim && "opacity-80",
          covered && "pub-burnt",
        )}
        style={{ width: slot }}
      >
        {showName && (
          <span
            className="pub-name max-w-full truncate text-[clamp(0.55rem,0.7vw,0.95rem)]"
            style={{ maxWidth: slot }}
          >
            {entry.display_name}
          </span>
        )}
        <Figure
          index={characterOf(entry)}
          room={room}
          state={covered ? "out" : moved ? "run" : "idle"}
        />
      </span>
    </>
  );
}

function FloorCaption(props: {
  floor: number;
  count: number;
  closed: boolean;
  ascended: boolean;
  free: number;
  capacity: number;
  innerCut: boolean;
  covered: boolean;
}) {
  const { floor, count, closed, ascended, free, capacity, innerCut, covered } = props;
  let text = "";
  let tone = "text-muted-foreground";
  if (floor === LEVELS) {
    if (ascended) {
      text = "A salvo";
      tone = "text-accent";
    } else {
      text = free > 0 ? `Quedan ${free} lugar${free === 1 ? "" : "es"}` : `Cima llena: ${capacity}`;
      tone = "text-accent";
    }
  } else if (covered) {
    text = "";
  } else if (ascended && count === 0) {
    text = "Piso vacío";
  } else if (innerCut) {
    text = `${count} empatados en tests: desempata el tiempo`;
    tone = "text-accent";
  } else if (count > 0) {
    text =
      floor === LEVELS - 1 && !closed
        ? `${count} a menos de ${PER_LEVEL} tests de la cima`
        : `${count} jugador${count === 1 ? "" : "es"}`;
  }
  if (!text) return null;
  return (
    <span
      className={cn(
        "absolute right-[1vw] top-[0.6vw] max-w-[24%] text-right text-[clamp(0.6rem,0.85vw,1.15rem)]",
        tone,
      )}
      style={floor === LEVELS ? PIXEL : undefined}
    >
      {text}
    </span>
  );
}

// Cuántos pisos tapó la lava durante el paso 2 del final.
function useLavaFloors(step: number) {
  const [floors, setFloors] = useState(0);
  useEffect(() => {
    if (step < 2) {
      setFloors(0);
      return;
    }
    if (step > 2) {
      setFloors(LEVELS);
      return;
    }
    setFloors(1);
    const id = setInterval(() => setFloors((f) => Math.min(LEVELS, f + 1)), LAVA_FLOOR_MS);
    return () => clearInterval(id);
  }, [step]);
  return floors;
}

// Quién cambió de piso hace poco: salta y corre un momento.
function useMoved(board: Entry[], step: number) {
  const last = useRef(new Map<string, { floor: number; at: number }>());
  const now = Date.now();
  const moved = new Set<string>();
  for (const entry of board) {
    const floor = step >= 1 && entry.final_status === "advanced" ? LEVELS : levelOf(entry);
    const prev = last.current.get(entry.participant_id);
    if (!prev || prev.floor !== floor)
      last.current.set(entry.participant_id, { floor, at: prev ? now : 0 });
    if (now - last.current.get(entry.participant_id)!.at < 1600) moved.add(entry.participant_id);
  }
  return moved;
}
