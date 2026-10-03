import { useEffect, useRef, useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import { CHARACTERS } from "@/lib/characters";
import { confetti } from "@/lib/confetti";
import { formatClock } from "@/lib/runit";
import { cn } from "@/lib/utils";
export type Entry = {
  participant_id: string;
  display_name: string;
  character?: number;
  final_rank: number | null;
  final_status: "advanced" | "eliminated" | null;
  best_pass_percentage: number;
  failed_attempts_count: number;
  solved_at: string | null;
  penalty_seconds: number;
};

export type FeedEvent = {
  id: number;
  at: number;
  kind: "joined" | "progress" | "fail" | "solved";
  name: string;
  character: number;
  passed?: number;
  total?: number;
  /** Orden de llegada entre los que resolvieron (1 = el primero). */
  arrival?: number;
};

export type TrackRound = {
  number: number;
  problem: string;
  capacity: number;
  /** Fin de la cuenta regresiva y fin de la ronda, en ms (hora del servidor). */
  startsAt: number;
  endsAt: number;
  closed: boolean;
};

// Pista para proyectar (/pista). Ocupa la pantalla entera sin scroll:
// arriba la ronda y el reloj, a la izquierda la carrera de los primeros puestos
// y el resto del pelotón, a la derecha el cupo y los eventos en vivo. Encima,
// anuncios cuando alguien clasifica y el podio al cerrar.
// Solo dibuja: recibe la ronda, el ranking ya ordenado y los eventos.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
/** Carriles que entran en la pista; el resto va al pelotón. Con más los
    personajes quedan muy chicos para verse de lejos (se probó con 15 y 20). */
const DEFAULT_LANES = 10;
/** Cuánto tarda un corredor en llegar a su nueva posición: se lo ve correr. */
const MOVE_MS = 3000;
/** Franja de arriba para la bandera de meta y las marcas de avance. */
const TRACK_TOP = 26;
const MEDALS = ["gold", "silver", "bronze"] as const;
// Recortes CC0 de Kenney Pixel Platformer (public/pista/LICENSE.txt), tiles de 18 px.
const TILE = 18;
const SPRITES = {
  flag: "url(/pista/flag.png)",
  coin: "url(/pista/coin.png)",
  digits: "url(/pista/digits.png)",
};

type Props = {
  round: TrackRound;
  board: Entry[];
  events: FeedEvent[];
  /** Diferencia con el reloj del servidor (useServerClockOffset). */
  serverOffsetMs?: number;
  /** Cuántos corredores van en la pista; con más, los carriles son más delgados. */
  laneCount?: number;
};

export function ProjectedTrack({
  round,
  board,
  events,
  laneCount = DEFAULT_LANES,
  serverOffsetMs = 0,
}: Props) {
  const now = useNow() + serverOffsetMs;
  const lanes = board.slice(0, laneCount);
  const rest = board.slice(laneCount);
  const solved = board.filter((e) => e.solved_at).length;
  return (
    <div className="proj fixed inset-0 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <Header round={round} now={now} />
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(15rem,23vw)] gap-[1.2vw] px-[1.2vw] pb-[1.2vw]">
        <section className="flex min-h-0 flex-col gap-[0.8vw]">
          <Track
            lanes={lanes}
            capacity={round.capacity}
            closed={round.closed}
            total={board.length}
          />
          {rest.length > 0 && <Peloton rest={rest} offset={laneCount} capacity={round.capacity} />}
        </section>
        <aside className="flex min-h-0 flex-col gap-[0.8vw]">
          <Quota solved={solved} capacity={round.capacity} participants={board.length} />
          <Feed events={events} />
        </aside>
      </div>
      {!round.closed && <Announcements events={events} />}
      {round.closed && <Podium board={board} round={round} />}
      <FullscreenButton />
    </div>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Header({ round, now }: { round: TrackRound; now: number }) {
  const waiting = now < round.startsAt;
  const left = waiting ? round.startsAt - now : round.endsAt - now;
  const hurry = !round.closed && !waiting && left <= 60_000;
  return (
    <header className="flex items-center gap-[2vw] px-[1.6vw] py-[1vw]">
      <span className="proj-logo text-[clamp(1rem,1.9vw,2.6rem)] text-primary" style={PIXEL}>
        Run&nbsp;It
      </span>
      <div className="min-w-0">
        <p className="text-[clamp(0.7rem,0.9vw,1.2rem)] uppercase tracking-[0.25em] text-muted-foreground">
          Ronda {round.number}
        </p>
        <p className="truncate text-[clamp(1rem,1.7vw,2.4rem)] font-bold">{round.problem}</p>
      </div>
      <span
        className={cn(
          "ml-auto rounded-md border-2 px-[0.8vw] py-[0.3vw] text-[clamp(0.6rem,0.8vw,1.1rem)]",
          round.closed
            ? "border-muted-foreground text-muted-foreground"
            : waiting
              ? "border-accent text-accent"
              : "border-success text-success",
        )}
        style={PIXEL}
      >
        {round.closed ? "Terminada" : waiting ? "Por empezar" : "En curso"}
      </span>
      <div className="text-right">
        <p className="text-[clamp(0.6rem,0.8vw,1.1rem)] uppercase tracking-[0.25em] text-muted-foreground">
          {waiting ? "Empieza en" : "Tiempo"}
        </p>
        <p
          className={cn(
            "text-[clamp(1.6rem,3.6vw,5rem)] leading-none tabular-nums",
            hurry ? "animate-run-it-hurry text-danger" : "text-foreground",
          )}
          style={PIXEL}
        >
          {round.closed ? "00:00" : formatClock(left)}
        </p>
      </div>
    </header>
  );
}

// Estado de cada puesto respecto del cupo. Quien resolvió dentro del cupo ya no
// puede perder el lugar (los que resuelvan después quedan detrás).
function zone(entry: Entry, rank: number, capacity: number, closed: boolean) {
  if (closed) return entry.final_status === "advanced" ? "in" : "out";
  if (rank > capacity) return "out";
  return entry.solved_at ? "in" : "zone";
}

function Track({
  lanes,
  capacity,
  closed,
  total,
}: {
  lanes: Entry[];
  capacity: number;
  closed: boolean;
  total: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry?.contentRect.height ?? 600));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const rows = Math.max(lanes.length, 6);
  // Con muchos carriles se juntan un poco más para no perder alto.
  const gap = rows > 12 ? 4 : 8;
  const laneH = (height - TRACK_TOP - gap * rows) / rows;
  const moving = useMoving(lanes);
  useSpriteBounds(lanes.map((entry) => entry.character ?? 0));
  return (
    <div ref={ref} className="proj-track relative min-h-0 flex-1 overflow-hidden rounded-xl">
      {/* Marcas de 25, 50 y 75 % y meta a cuadros. */}
      <div className="proj-runway pointer-events-none absolute inset-y-0">
        {[25, 50, 75].map((mark) => (
          <span key={mark} className="proj-mark" style={{ left: `${mark}%` }}>
            {mark}%
          </span>
        ))}
        <span className="proj-finish" />
        <span
          className="proj-flag"
          style={{ "--k": 1, backgroundImage: SPRITES.flag } as React.CSSProperties}
        />
      </div>
      {lanes.map((entry, i) => {
        const rank = i + 1;
        const state = zone(entry, rank, capacity, closed);
        const medal = MEDALS[i];
        const pct = Math.min(100, Number(entry.best_pass_percentage) || 0);
        return (
          <div
            key={entry.participant_id}
            className={cn(
              "proj-lane absolute inset-x-0",
              `proj-lane-${state}`,
              medal && `proj-medal-${medal}`,
            )}
            style={{ top: TRACK_TOP + i * (laneH + gap), height: laneH }}
          >
            <span className="proj-rank">
              {medal ? (
                <PixelMedal metal={medal} rank={rank} size={Math.min(laneH * 0.8, 64)} />
              ) : (
                <PixelNumber value={rank} height={Math.min(laneH * 0.42, 30)} />
              )}
            </span>

            <div className="proj-runway absolute inset-y-0">
              <div
                className="absolute flex items-end gap-[0.4vw]"
                style={{
                  bottom: 4,
                  left: `${pct}%`,
                  transform: `translateX(-${pct}%)`,
                  transition: `left ${MOVE_MS}ms linear, transform ${MOVE_MS}ms linear`,
                }}
              >
                {(() => {
                  const fit = spriteFit(entry.character ?? 0, laneH * 0.8);
                  return (
                    // Casilla del mismo ancho para todos: arrancan y avanzan desde
                    // la misma línea aunque cada personaje tenga otro tamaño.
                    <span
                      className="flex shrink-0 items-end justify-center"
                      style={{ width: laneH * 0.9, height: laneH * 0.9 }}
                    >
                      {/* El margen transparente de abajo queda bajo el piso del carril. */}
                      <span
                        className="proj-sprite block"
                        style={{ marginBottom: -fit.lift, transform: `scale(${fit.zoom})` }}
                      >
                        <Sprite
                          index={entry.character ?? 0}
                          state={
                            state === "out" && closed
                              ? "out"
                              : moving.has(entry.participant_id)
                                ? "run"
                                : "idle"
                          }
                          scale={fit.scale}
                        />
                      </span>
                    </span>
                  );
                })()}
                <span
                  className="proj-tag mb-[0.4em] whitespace-nowrap"
                  style={{ fontSize: Math.max(11, Math.min(laneH * 0.3, 24)) }}
                >
                  <b>{entry.display_name}</b> <span className="opacity-75">{pct}%</span>
                </span>
              </div>
            </div>
            {state !== "out" && (
              <span
                className={cn(
                  "proj-status",
                  state === "in" ? "proj-status-in" : "proj-status-zone",
                )}
                style={{ width: Math.min(laneH * 0.5, 30), height: Math.min(laneH * 0.5, 30) }}
                title={state === "in" ? "Clasificado" : "En zona de clasificación"}
              >
                {state === "in" && <PixelIcon name="check" className="h-[70%] w-[70%]" />}
              </span>
            )}
          </div>
        );
      })}
      {capacity < lanes.length && (
        <div
          className="proj-cut absolute inset-x-0"
          style={{ top: TRACK_TOP + capacity * (laneH + gap) - gap / 2 }}
        >
          <span style={PIXEL}>Corte · clasifican {capacity}</span>
        </div>
      )}
      {total === 0 && (
        <p className="absolute inset-0 grid place-items-center text-muted-foreground" style={PIXEL}>
          Esperando corredores…
        </p>
      )}
    </div>
  );
}

const METAL: Record<(typeof MEDALS)[number], [string, string, string]> = {
  // [cara, borde, brillo]
  gold: ["#ffd34d", "#b8860b", "#fff3b0"],
  silver: ["#d9dee8", "#8a93a6", "#ffffff"],
  bronze: ["#e39552", "#9a5a26", "#ffd1a3"],
};

// Medalla pixel propia: cinta en V y disco con el puesto. Grilla de 16×18.
function PixelMedal({
  metal,
  rank,
  size,
}: {
  metal: (typeof MEDALS)[number];
  rank: number;
  size: number;
}) {
  const [face, rim, shine] = METAL[metal];
  return (
    <svg
      viewBox="0 0 16 18"
      width={size * (16 / 18)}
      height={size}
      shapeRendering="crispEdges"
      aria-label={`Puesto ${rank}`}
    >
      <path d="M3 0h4v6h-1v1h-1v-1h-1v-1h-1z" fill="var(--primary)" />
      <path d="M9 0h4v5h-1v1h-1v1h-1v-1h-1z" fill="var(--secondary)" />
      <path d="M5 6h6v1h2v2h1v6h-1v2h-2v1h-6v-1h-2v-2h-1v-6h1v-2h2z" fill="#1a1206" />
      <path d="M5 7h6v1h1v1h1v6h-1v1h-1v1h-6v-1h-1v-1h-1v-6h1v-1h1z" fill={rim} />
      <path d="M5 8h6v1h1v6h-1v1h-6v-1h-1v-6h1z" fill={face} />
      <path d="M5 9h2v1h-1v2h-1z" fill={shine} />
      <text
        x="8"
        y="14.4"
        textAnchor="middle"
        fontSize="6"
        fontFamily="'Press Start 2P', monospace"
        fill="#1a1206"
      >
        {rank}
      </text>
    </svg>
  );
}

// Número con los dígitos pixel de Kenney (digits.png: 0-9 en fila).
function PixelNumber({ value, height }: { value: number; height: number }) {
  const k = height / TILE;
  return (
    <span className="flex" aria-label={String(value)}>
      {String(value)
        .split("")
        .map((digit, i) => (
          <span
            key={i}
            className="proj-digit"
            style={{
              backgroundImage: SPRITES.digits,
              width: TILE * k * 0.82,
              height: TILE * k,
              backgroundSize: `${TILE * 10 * k}px ${TILE * k}px`,
              backgroundPosition: `${-Number(digit) * TILE * k - TILE * k * 0.09}px 0`,
            }}
          />
        ))}
    </span>
  );
}

// Quién avanzó hace poco: corre mientras dura el desplazamiento y después se
// queda quieto.
function useMoving(lanes: Entry[]) {
  const last = useRef(new Map<string, { pct: number; at: number }>());
  const now = Date.now();
  const moving = new Set<string>();
  for (const entry of lanes) {
    const pct = Number(entry.best_pass_percentage) || 0;
    const prev = last.current.get(entry.participant_id);
    if (!prev || prev.pct !== pct)
      last.current.set(entry.participant_id, { pct, at: prev ? now : 0 });
    const at = last.current.get(entry.participant_id)!.at;
    if (now - at < MOVE_MS + 200) moving.add(entry.participant_id);
  }
  return moving;
}

// Contorno real de cada personaje: muchas hojas dejan mucho margen transparente
// alrededor del dibujo, así que escalar por el tamaño del cuadro los deja de
// tamaños muy distintos. Se mide el primer cuadro quieto una vez y se guarda.
type Bounds = { height: number; bottom: number };
const bounds = new Map<number, Bounds | "loading">();
const boundsListeners = new Set<() => void>();

function measure(index: number) {
  const character = CHARACTERS[index];
  const anim = character?.anims?.idle;
  if (!character || !anim || bounds.has(index)) return;
  bounds.set(index, "loading");
  const img = new Image();
  img.onload = () => {
    const { fw, fh } = character;
    const cols = Math.max(1, Math.floor(img.naturalWidth / fw));
    const frame = anim.col0 ?? 0;
    const canvas = document.createElement("canvas");
    canvas.width = fw;
    canvas.height = fh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(
      img,
      (frame % cols) * fw,
      (anim.row + Math.floor(frame / cols)) * fh,
      fw,
      fh,
      0,
      0,
      fw,
      fh,
    );
    const alpha = ctx.getImageData(0, 0, fw, fh).data;
    let top = fh;
    let last = -1;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        if (alpha[(y * fw + x) * 4 + 3]! > 0) {
          top = Math.min(top, y);
          last = y;
          break;
        }
      }
    }
    bounds.set(
      index,
      last < 0 ? { height: fh, bottom: 0 } : { height: last - top + 1, bottom: fh - 1 - last },
    );
    boundsListeners.forEach((listener) => listener());
  };
  img.src = anim.sheet;
}

function useSpriteBounds(indexes: number[]) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    boundsListeners.add(listener);
    return () => {
      boundsListeners.delete(listener);
    };
  }, []);
  indexes.forEach(measure);
}

// Tamaño para que el dibujo visible mida `room` px en todos los personajes:
// `scale` es la escala entera de Sprite (nítida) y `zoom` el ajuste fino que
// falta, aplicado con CSS sin suavizado. `lift` es el margen transparente de
// abajo, para apoyarlo en el piso del carril.
function spriteFit(index: number, room: number) {
  const character = CHARACTERS[index];
  if (!character) return { scale: 1, zoom: 1, lift: 0 };
  const [visible, own] = character.gif
    ? [{ height: character.gif.height * 0.8, bottom: 0 }, character.gif.scale]
    : [
        (() => {
          const measured = bounds.get(index);
          return measured && measured !== "loading"
            ? measured
            : { height: character.fh * 0.6, bottom: 0 };
        })(),
        character.scale,
      ];
  const total = room / visible.height;
  const factor = Math.max(1, Math.round(total));
  return { scale: factor / own, zoom: total / factor, lift: visible.bottom * total };
}

function spriteScale(index: number, room: number) {
  return spriteFit(index, room).scale;
}

// Puestos que no entran en la pista: se muestran por páginas que rotan solas.
function Peloton({ rest, offset, capacity }: { rest: Entry[]; offset: number; capacity: number }) {
  const PAGE = 10;
  const pages = Math.ceil(rest.length / PAGE);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pages), 6000);
    return () => clearInterval(id);
  }, [pages]);
  const current = page % pages;
  const slice = rest.slice(current * PAGE, current * PAGE + PAGE);
  const first = offset + current * PAGE + 1;
  return (
    <div className="rounded-xl border-2 border-border bg-card/70 px-[1vw] py-[0.6vw]">
      <p className="mb-[0.4vw] flex items-center gap-2 text-[clamp(0.6rem,0.75vw,1rem)] uppercase tracking-[0.2em] text-muted-foreground">
        Pelotón · puestos {first}–{first + slice.length - 1} de {offset + rest.length}
        {pages > 1 && (
          <span className="ml-auto normal-case tracking-normal">
            página {current + 1}/{pages}
          </span>
        )}
      </p>
      <div
        key={current}
        className="animate-run-it-rise grid grid-cols-5 gap-x-[0.8vw] gap-y-[0.5vw]"
      >
        {slice.map((entry, i) => {
          const rank = first + i;
          return (
            <span
              key={entry.participant_id}
              className={cn(
                "flex items-center gap-[0.4vw] truncate rounded-md border px-[0.5vw] py-[0.25vw] text-[clamp(0.7rem,0.85vw,1.15rem)]",
                rank <= capacity ? "border-success/70 bg-success-soft" : "border-border",
              )}
            >
              <b className="tabular-nums text-muted-foreground">{rank}</b>
              <span className="truncate">{entry.display_name}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                {Number(entry.best_pass_percentage)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Quota({
  solved,
  capacity,
  participants,
}: {
  solved: number;
  capacity: number;
  participants: number;
}) {
  return (
    <div className="rounded-xl border-2 border-border bg-card p-[1vw]">
      <p className="text-[clamp(0.6rem,0.8vw,1.1rem)] uppercase tracking-[0.25em] text-muted-foreground">
        Clasificados
      </p>
      <p
        className="mt-[0.3vw] text-[clamp(1.4rem,2.6vw,3.6rem)] leading-none text-success"
        style={PIXEL}
      >
        {solved}
        <span className="text-[0.5em] text-muted-foreground"> / {capacity}</span>
      </p>
      <div className="mt-[0.6vw] flex flex-wrap gap-[0.25vw]">
        {Array.from({ length: capacity }, (_, i) => (
          <span
            key={i}
            className={cn("proj-coin", i >= solved && "proj-coin-empty")}
            style={{ backgroundImage: SPRITES.coin }}
          />
        ))}
      </div>
      <div className="mt-[0.7vw] flex flex-wrap gap-x-[1vw] gap-y-[0.3vw] text-[clamp(0.65rem,0.8vw,1.05rem)] text-muted-foreground">
        <span className="flex items-center gap-[0.4vw]">
          <span className="proj-status proj-status-in proj-status-legend">
            <PixelIcon name="check" className="h-[70%] w-[70%]" />
          </span>
          Clasificado
        </span>
        <span className="flex items-center gap-[0.4vw]">
          <span className="proj-status proj-status-zone proj-status-legend" />
          En zona
        </span>
        <span className="flex items-center gap-[0.4vw]">
          <span className="inline-block w-[1.6vw] border-t-[3px] border-dashed border-danger" />
          Corte
        </span>
      </div>
      <p className="mt-[0.4vw] text-[clamp(0.6rem,0.75vw,1rem)] text-muted-foreground">
        {participants} corredores · cierra al llenarse el cupo o al acabar el tiempo
      </p>
    </div>
  );
}

function Feed({ events }: { events: FeedEvent[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border-2 border-border bg-card p-[1vw]">
      <p className="mb-[0.5vw] flex items-center gap-2 text-[clamp(0.6rem,0.8vw,1.1rem)] uppercase tracking-[0.25em] text-muted-foreground">
        <span className="animate-run-it-blink h-2 w-2 rounded-full bg-danger" /> En vivo
      </p>
      <ul className="min-h-0 flex-1 space-y-[0.45vw] overflow-hidden">
        {events.slice(0, 14).map((event) => (
          <li
            key={event.id}
            className={cn(
              "proj-fade flex items-center gap-[0.5vw] rounded-md px-[0.5vw] py-[0.3vw] text-[clamp(0.75rem,0.95vw,1.3rem)]",
              event.kind === "solved" && "bg-success-soft text-success",
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
                "h-[1.1em] w-[1.1em] shrink-0",
                event.kind === "fail"
                  ? "text-danger"
                  : event.kind === "solved"
                    ? "text-success"
                    : "text-accent",
              )}
            />
            <span className="min-w-0 truncate">{describe(event)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function describe(event: FeedEvent) {
  switch (event.kind) {
    case "solved":
      return `¡${event.name} resolvió! ${event.arrival}.º en llegar`;
    case "progress":
      return `${event.name} pasa ${event.passed}/${event.total} tests`;
    case "fail":
      return `${event.name} falló un envío (+30 s)`;
    default:
      return `${event.name} entró a la pista`;
  }
}

// Cartel grande cuando alguien resuelve. Si llegan varios juntos, van en fila.
function Announcements({ events }: { events: FeedEvent[] }) {
  const seen = useRef<number>(events[0]?.id ?? 0);
  const [queue, setQueue] = useState<FeedEvent[]>([]);
  useEffect(() => {
    const fresh = events.filter((e) => e.id > seen.current && e.kind === "solved").reverse();
    if (events[0]) seen.current = Math.max(seen.current, events[0].id);
    // Si resuelven varios seguidos se muestran los últimos: anunciar tarde confunde.
    if (fresh.length) setQueue((q) => [...q, ...fresh].slice(-2));
  }, [events]);
  const current = queue[0];
  useSpriteBounds(current ? [current.character] : []);
  useEffect(() => {
    if (!current) return;
    confetti({ x: 0.5, y: 0.45 });
    const id = setTimeout(() => setQueue((q) => q.slice(1)), 2600);
    return () => clearTimeout(id);
  }, [current]);
  if (!current) return null;
  return (
    // Abajo, sobre el pelotón: arriba taparía a los primeros puestos.
    <div className="pointer-events-none absolute inset-x-0 bottom-[3vh] z-40 flex justify-center pr-[24vw]">
      <div
        key={current.id}
        className="animate-run-it-pop proj-announce flex items-center gap-[1.5vw] px-[2.5vw] py-[1.2vw]"
      >
        <Sprite index={current.character} state="run" scale={spriteScale(current.character, 90)} />
        <div>
          <p className="text-[clamp(1.1rem,2.6vw,3.6rem)] text-success" style={PIXEL}>
            ¡{current.name} clasifica!
          </p>
          <p className="mt-[0.6vw] text-[clamp(0.8rem,1.2vw,1.7rem)]" style={PIXEL}>
            {current.arrival}.º en resolver
          </p>
        </div>
      </div>
    </div>
  );
}

function Podium({ board, round }: { board: Entry[]; round: TrackRound }) {
  const [visible, setVisible] = useState(false);
  useSpriteBounds(board.slice(0, 3).map((entry) => entry.character ?? 0));
  useEffect(() => {
    const id = setTimeout(() => {
      setVisible(true);
      confetti({ x: 0.5, y: 0.3 });
    }, 1500);
    return () => clearTimeout(id);
  }, []);
  if (!visible) return null;
  const advanced = board.filter((e) => e.final_status === "advanced");
  const eliminated = board.length - advanced.length;
  // 2.º a la izquierda, 1.º al centro, 3.º a la derecha.
  const order = [1, 0, 2].map((i) => ({ entry: board[i], place: i })).filter((p) => p.entry);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-[2vw] bg-background/95 px-[3vw]">
      <p className="text-[clamp(1rem,2vw,2.8rem)] text-primary" style={PIXEL}>
        Ronda {round.number} terminada
      </p>
      <div className="flex items-end gap-[2vw]">
        {order.map(({ entry, place }) => (
          <div
            key={entry!.participant_id}
            className="animate-run-it-rise flex flex-col items-center"
          >
            <Sprite
              index={entry!.character ?? 0}
              state="idle"
              scale={spriteScale(entry!.character ?? 0, place === 0 ? 150 : 110)}
            />
            <p className="mt-[0.5vw] max-w-[16vw] truncate text-[clamp(0.9rem,1.5vw,2rem)] font-bold">
              {entry!.display_name}
            </p>
            <div
              className={cn(
                "proj-step mt-[0.5vw] grid w-[14vw] place-items-center",
                `proj-medal-${MEDALS[place]}`,
              )}
              style={{ height: ["22vh", "15vh", "10vh"][place] }}
            >
              <span className="text-[clamp(1.6rem,3.4vw,4.6rem)]" style={PIXEL}>
                {place + 1}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="max-w-[80vw] text-center">
        <p className="mb-[0.6vw] text-[clamp(0.8rem,1.1vw,1.5rem)] uppercase tracking-[0.2em] text-success">
          Pasan a la ronda {round.number + 1} · {advanced.length}
        </p>
        <div className="flex flex-wrap justify-center gap-[0.5vw]">
          {advanced.map((entry) => (
            <span
              key={entry.participant_id}
              className="rounded-md border border-success/70 bg-success-soft px-[0.6vw] py-[0.2vw] text-[clamp(0.75rem,1vw,1.35rem)]"
            >
              {entry.final_rank}. {entry.display_name}
            </span>
          ))}
        </div>
        <p className="mt-[1vw] text-[clamp(0.75rem,1vw,1.35rem)] text-muted-foreground">
          Quedan fuera {eliminated} corredores. ¡Gracias por correr!
        </p>
      </div>
    </div>
  );
}

// Para el proyector: pantalla completa con un clic; el botón se esconde si el
// mouse no se mueve.
function FullscreenButton() {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2500);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => {
      window.removeEventListener("mousemove", wake);
      clearTimeout(timer);
    };
  }, []);
  return (
    <button
      type="button"
      onClick={() =>
        document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen()
      }
      className={cn(
        "absolute bottom-3 left-3 z-[60] rounded-md border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground transition-opacity hover:text-foreground",
        idle && "pointer-events-none opacity-0",
      )}
    >
      Pantalla completa
    </button>
  );
}
