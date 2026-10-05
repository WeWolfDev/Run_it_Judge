import { useEffect, type ReactNode } from "react";

import type { Entry, FeedEvent, TrackRound } from "@/components/ProjectedTrack";
import { PixelIcon } from "@/components/PixelIcon";
import { Sprite, type SpriteState } from "@/components/Sprite";
import { formatClock } from "@/lib/runit";
import { cn } from "@/lib/utils";
import {
  PIXEL,
  TESTS,
  characterOf,
  passedOf,
  spriteFit,
  useNow,
  useSpriteBounds,
  type ViewInfo,
  type ViewProps,
} from "./model";

// Piezas comunes de las vistas del público: el marco con el encabezado, la
// leyenda, la burbuja y el feed, los carteles del final y el resumen.

// ---------------------------------------------------------------- marco

export function Stage({
  view,
  round,
  board,
  events,
  serverOffsetMs,
  step,
  summaryStep,
  children,
}: ViewProps & { view: ViewInfo; step: number; summaryStep: number; children: ReactNode }) {
  const now = useNow(serverOffsetMs);
  return (
    <div className="pub fixed inset-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <Header view={view} round={round} board={board} now={now} />
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(15rem,23vw)] gap-[1.2vw] px-[1.2vw] pb-[1.2vw]">
        <main className="flex min-h-0 flex-col gap-[0.6vw]">
          {view.legend && <Legend items={view.legend(round.capacity)} />}
          <div className="relative isolate min-h-0 flex-1">{children}</div>
        </main>
        <aside className="flex min-h-0 flex-col gap-[0.8vw]">
          <Bubble board={board} capacity={round.capacity} closed={round.closed} />
          <Live events={events} board={board} capacity={round.capacity} goal={view.goal} />
        </aside>
      </div>
      {step >= summaryStep && <Summary view={view} round={round} board={board} />}
    </div>
  );
}

// Franja de "cómo se lee": tres pasos numerados, cortos.
function Legend({ items }: { items: string[] }) {
  return (
    <ol className="pub-legend flex flex-wrap gap-x-[1.6vw] gap-y-[0.3vw] px-[1vw] py-[0.5vw] text-[clamp(0.7rem,0.95vw,1.3rem)]">
      {items.map((item, i) => (
        <li key={item} className="flex items-center gap-[0.5vw]">
          <span className="pub-legend-num grid shrink-0 place-items-center" style={PIXEL}>
            {i + 1}
          </span>
          {item}
        </li>
      ))}
    </ol>
  );
}

function Header({
  view,
  round,
  board,
  now,
}: {
  view: ViewInfo;
  round: TrackRound;
  board: Entry[];
  now: number;
}) {
  const waiting = now < round.startsAt;
  const left = waiting ? round.startsAt - now : round.endsAt - now;
  const hurry = !round.closed && !waiting && left <= 60_000;
  const solved = board.filter((e) => e.solved_at).length;
  return (
    <header className="flex min-w-0 items-center gap-[1.2vw] overflow-hidden px-[1.6vw] py-[0.9vw]">
      <span
        className="pub-logo shrink-0 text-[clamp(1rem,1.9vw,2.6rem)] text-primary"
        style={PIXEL}
      >
        Run&nbsp;It
      </span>
      <span
        className="shrink-0 whitespace-nowrap rounded-md border-2 border-border px-[0.8vw] py-[0.35vw] text-[clamp(0.6rem,0.85vw,1.15rem)]"
        style={PIXEL}
      >
        Ronda {round.number}
      </span>
      <span
        className="min-w-0 truncate text-[clamp(0.7rem,1.1vw,1.6rem)] uppercase tracking-[0.15em] text-muted-foreground"
        style={PIXEL}
      >
        {view.name}
      </span>
      {round.closed && (
        <span
          className="pub-tag-end animate-run-it-pop shrink-0 whitespace-nowrap px-[0.8vw] py-[0.4vw] text-[clamp(0.6rem,0.9vw,1.2rem)]"
          style={PIXEL}
        >
          {solved >= round.capacity ? "Cupo lleno" : "Tiempo"}
        </span>
      )}
      <div className="ml-auto shrink-0 whitespace-nowrap text-right">
        <p className="text-[clamp(0.55rem,0.75vw,1rem)] uppercase tracking-[0.25em] text-muted-foreground">
          Cupo
        </p>
        <p className="text-[clamp(0.7rem,1.15vw,1.6rem)]" style={PIXEL}>
          Pasan {round.capacity} de {board.length}
        </p>
      </div>
      <p
        className={cn(
          "shrink-0 text-[clamp(1.4rem,3vw,4.2rem)] leading-none tabular-nums",
          round.closed ? "text-danger" : hurry ? "animate-run-it-hurry text-danger" : "text-accent",
        )}
        style={PIXEL}
      >
        {round.closed ? "00:00" : formatClock(left)}
      </p>
    </header>
  );
}

// La burbuja: los puestos alrededor del corte, donde se decide la ronda.
function Bubble({
  board,
  capacity,
  closed,
}: {
  board: Entry[];
  capacity: number;
  closed: boolean;
}) {
  const from = Math.max(0, capacity - 3);
  const rows = board.slice(from, capacity + 3);
  useSpriteBounds(rows.map(characterOf));
  return (
    <div className="pub-card p-[0.9vw]">
      <p className="pub-card-title" style={PIXEL}>
        La burbuja
      </p>
      <ol className="mt-[0.5vw] space-y-[0.25vw] text-[clamp(0.7rem,0.85vw,1.15rem)]">
        {rows.map((entry, i) => {
          const rank = from + i + 1;
          return (
            <li key={entry.participant_id}>
              {rank === capacity + 1 && (
                <p
                  className="pub-cut-row my-[0.3vw] flex justify-between px-[0.5vw] py-[0.2vw]"
                  style={PIXEL}
                >
                  <span>Línea de corte</span>
                  <span>{closed ? "Pasaron" : "Arriba pasan"}</span>
                </p>
              )}
              <div className={cn("flex items-center gap-[0.5vw]", rank > capacity && "opacity-75")}>
                <b
                  className={cn(
                    "w-[2.2em] tabular-nums",
                    rank <= capacity ? "text-success" : "text-danger",
                  )}
                >
                  {rank}
                </b>
                <Figure index={characterOf(entry)} room={22} />
                <span className="min-w-0 flex-1 truncate font-semibold">{entry.display_name}</span>
                <span className="tabular-nums">
                  {passedOf(entry)}/{TESTS}
                </span>
                <span className="w-[4.2em] text-right tabular-nums text-muted-foreground">
                  {entry.solved_at
                    ? "listo"
                    : entry.failed_attempts_count
                      ? `${entry.failed_attempts_count} fallo${entry.failed_attempts_count > 1 ? "s" : ""}`
                      : "—"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Live({
  events,
  board,
  capacity,
  goal,
}: {
  events: FeedEvent[];
  board: Entry[];
  capacity: number;
  goal: string;
}) {
  return (
    <div className="pub-card flex min-h-0 flex-1 flex-col p-[0.9vw]">
      <p className="pub-card-title flex items-center gap-2" style={PIXEL}>
        <span className="animate-run-it-blink h-2 w-2 rounded-full bg-danger" /> En vivo
      </p>
      <ul className="mt-[0.5vw] min-h-0 flex-1 space-y-[0.4vw] overflow-hidden">
        {events.slice(0, 12).map((event) => (
          <li
            key={event.id}
            className={cn(
              "pub-fade flex gap-[0.5vw] rounded-md px-[0.4vw] py-[0.25vw] text-[clamp(0.68rem,0.8vw,1.1rem)] leading-snug",
              event.kind === "solved" && "bg-success-soft",
            )}
          >
            <PixelIcon
              name={
                event.kind === "solved"
                  ? "trophy"
                  : event.kind === "fail"
                    ? "close"
                    : event.kind === "joined"
                      ? "users"
                      : "zap"
              }
              className={cn(
                "mt-[0.1em] h-[1.1em] w-[1.1em] shrink-0",
                event.kind === "fail"
                  ? "text-danger"
                  : event.kind === "solved"
                    ? "text-success"
                    : "text-accent",
              )}
            />
            <span className="min-w-0">{narrate(event, board, capacity, goal)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// El feed en tono de relato: dónde queda cada uno respecto del corte.
function narrate(event: FeedEvent, board: Entry[], capacity: number, goal: string) {
  const index = board.findIndex((e) => e.display_name === event.name);
  const rank = index + 1;
  const name = <b>{event.name}</b>;
  switch (event.kind) {
    case "solved":
      return (
        <>
          {name} {goal}: lugar {event.arrival} de {capacity}
        </>
      );
    case "progress":
      return (
        <>
          {name} ya pasa {event.passed}/{TESTS}
          {rank > 0 &&
            (rank <= capacity
              ? " y está dentro del corte"
              : ` y queda a ${rank - capacity} del corte`)}
        </>
      );
    case "fail": {
      const fails = board[index]?.failed_attempts_count ?? 1;
      return (
        <>
          {name} falló el envío{fails > 1 ? `: tropiezo n.º ${fails}` : ""}
        </>
      );
    }
    default:
      return <>{name} entró a la ronda</>;
  }
}

// ---------------------------------------------------------------- final

/** Cartel grande del final de ronda ("¡TIEMPO!", "PASAN 12"). */
export function Banner({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: "accent" | "danger" | "success";
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[3000] grid place-items-center">
      <p
        className={cn(
          "pub-banner animate-run-it-zoom px-[2.4vw] py-[1.2vw] text-center max-w-[90%] text-[clamp(1.2rem,3vw,3.8rem)] leading-tight",
          `pub-banner-${tone}`,
        )}
        style={PIXEL}
      >
        {children}
      </p>
    </div>
  );
}

/** Último paso del final: GAME OVER con los caídos y quiénes pasan. */
function Summary({ view, round, board }: { view: ViewInfo; round: TrackRound; board: Entry[] }) {
  const fallen = board.filter((e) => e.final_status === "eliminated");
  const advanced = board.filter((e) => e.final_status === "advanced");
  useSpriteBounds(board.map(characterOf));
  const room = fallen.length > 30 ? 28 : 38;
  return (
    <div className="pub-summary animate-run-it-rise absolute inset-0 z-50 flex flex-col px-[3vw] py-[2vw]">
      <div className="flex items-center justify-between">
        <span className="pub-logo text-[clamp(1rem,1.9vw,2.6rem)] text-primary" style={PIXEL}>
          Run&nbsp;It
        </span>
        <span className="text-[clamp(0.65rem,1vw,1.4rem)] uppercase" style={PIXEL}>
          Ronda {round.number}: {view.ending}
        </span>
      </div>
      <p
        className="pub-gameover mt-[1.5vh] text-center text-[clamp(2rem,6.5vw,8rem)] leading-none text-danger"
        style={PIXEL}
      >
        Game Over
      </p>
      <p className="mt-[2vh] text-center text-[clamp(0.75rem,1.2vw,1.6rem)]" style={PIXEL}>
        {fallen.length} caídos en la ronda {round.number}
      </p>
      <div className="mt-[2vh] grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(8.4vw,1fr))] gap-[0.6vw] overflow-hidden">
        {fallen.map((entry, i) => (
          <div
            key={entry.participant_id}
            className="pub-fallen animate-run-it-rise flex flex-col items-center px-[0.3vw] py-[0.5vw]"
            style={{ animationDelay: `${Math.min(i, 40) * 40}ms` }}
          >
            <Figure index={characterOf(entry)} room={room} state="out" />
            <b className="mt-[0.2vw] max-w-full truncate text-[clamp(0.7rem,0.9vw,1.2rem)]">
              {entry.display_name}
            </b>
            <span className="text-[clamp(0.6rem,0.75vw,1rem)] tabular-nums text-muted-foreground">
              {entry.final_rank}.º · {passedOf(entry)}/{TESTS}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-[1.5vh] flex items-center gap-[1vw] border-t-2 border-danger/40 pt-[1.2vh]">
        <span className="shrink-0 text-[clamp(0.6rem,0.95vw,1.3rem)] text-success" style={PIXEL}>
          {advanced.length} pasan a la ronda {round.number + 1}
        </span>
        <div
          className="flex min-w-0 flex-1 flex-wrap gap-[0.2vw] overflow-hidden"
          style={{ maxHeight: 44 }}
        >
          {advanced.map((entry) => (
            <Figure key={entry.participant_id} index={characterOf(entry)} room={34} state="run" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Cartel de presentación de la vista: quien llega sabe qué está mirando. */
export function Intro({ view, onDone }: { view: ViewInfo; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 3400);
    return () => clearTimeout(id);
  }, [onDone]);
  return (
    <div
      className="pub-intro fixed inset-0 z-[65] grid place-items-center px-[6vw] text-center"
      onClick={onDone}
    >
      <div className="animate-run-it-zoom">
        <p className="text-[clamp(0.7rem,1.1vw,1.5rem)] uppercase tracking-[0.3em] text-muted-foreground">
          Hoy la ronda se ve como
        </p>
        <p
          className="pub-intro-title mt-[2vh] text-[clamp(1.6rem,5vw,6.5rem)] leading-tight text-primary"
          style={PIXEL}
        >
          {view.name}
        </p>
        <p className="mx-auto mt-[3vh] max-w-[60vw] text-[clamp(0.9rem,1.6vw,2.2rem)]">
          {view.rule}
        </p>
      </div>
    </div>
  );
}

/**
 * Personaje en una casilla de ancho fijo, con los pies en el borde de abajo.
 * `room` es la altura visible del dibujo en px.
 */
export function Figure({
  index,
  room,
  state = "idle",
  flip = false,
  speed,
  className = "",
}: {
  index: number;
  room: number;
  state?: SpriteState;
  flip?: boolean;
  speed?: number;
  className?: string;
}) {
  const fit = spriteFit(index, room);
  return (
    <span
      className={`flex shrink-0 items-end justify-center ${className}`}
      style={{ width: room * 1.05, height: room * 1.1 }}
    >
      <span
        className="pub-sprite block"
        style={{
          marginBottom: -fit.lift,
          transform: `scale(${flip ? -fit.zoom : fit.zoom}, ${fit.zoom})`,
        }}
      >
        <Sprite index={index} state={state} scale={fit.scale} {...(speed ? { speed } : {})} />
      </span>
    </span>
  );
}
