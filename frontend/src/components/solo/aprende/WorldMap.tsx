import { useEffect, useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import { PLAYER } from "@/components/solo/account/useAccount";
import { getSelectedCharacter } from "@/lib/session";

import { WORLDS, type Topic } from "./content";
import { CheckeredFlag, MapBackdrop, Track } from "./MapScene";
import { topicState, type Solved, type TopicState } from "./useProgress";

// Mapa de mundos: tres islas flotantes en pixel art (MapScene) unidas por la
// pista de carreras. Cada tema es una parada; tu personaje espera en el tema que
// toca. Un tema se desbloquea al resolver al menos un ejercicio del anterior y
// se completa al resolverlos todos. Los mundos sin temas se ven bloqueados como
// "próximamente". Coordenadas en un lienzo de 1000 × 760 (el mismo de
// MapScene); en pantallas chicas el mapa se desplaza de lado dentro de su caja.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
const W = 1000;
const H = 760;

/** Paradas del mundo 1, en orden (x, y en el lienzo). */
const STOPS: [number, number][] = [
  [110, 650],
  [250, 690],
  [370, 610],
  [270, 520],
  [140, 450],
  [210, 340],
  [350, 300],
  [470, 390],
  [500, 520],
];
const SOON_2: [number, number][] = [
  [650, 470],
  [790, 560],
  [860, 420],
];
const BOSS: [number, number] = [775, 225];

export function WorldMap({
  solved,
  onOpen,
}: {
  solved: Solved;
  onOpen: (topicId: string) => void;
}) {
  const world = WORLDS[0]!;
  const topics = world.topics;
  const states = topics.map((_, i) => topicState(topics, i, solved));
  const firstOpen = states.findIndex((s) => s === "current");
  const here = firstOpen === -1 ? topics.length - 1 : firstOpen;
  const [selected, setSelected] = useState<number | "soon2" | "soon3">(here);
  const [character, setCharacter] = useState<number | null>(null);
  useEffect(() => setCharacter(getSelectedCharacter(PLAYER)), []);

  const done = states.filter((s) => s === "done").length;
  const [px, py] = STOPS[here]!;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="overflow-x-auto rounded-xl border-2 border-[#2a2440] bg-[#07040d] shadow-[0_0_24px_color-mix(in_oklch,var(--primary)_18%,transparent)]">
        <p className="px-3 pt-2 text-[11px] text-muted-foreground sm:hidden">
          Desliza el mapa de lado para ver los otros mundos.
        </p>
        <div className="relative min-w-[640px]" style={{ aspectRatio: `${W} / ${H}` }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <MapBackdrop />
            <Track points={[STOPS[STOPS.length - 1]!, ...SOON_2, BOSS]} progress={0} dim />
            <Track points={STOPS} progress={here + 1} />
            <CheckeredFlag x={62} y={668} />
            <CheckeredFlag x={812} y={250} />
          </svg>

          <Sign x={170} y={252} world={1} title={world.title} color="#5eead4" />
          <Sign x={660} y={326} world={2} title={WORLDS[1]!.title} color="#a5a3ff" />
          <Sign x={775} y={28} world={3} title={WORLDS[2]!.title} color="#ff7ab6" />

          {topics.map((topic, i) => {
            const [x, y] = STOPS[i]!;
            return (
              <Node
                key={topic.id}
                x={x}
                y={y}
                state={states[i]!}
                number={i + 1}
                label={topic.title}
                selected={selected === i}
                onClick={() => setSelected(i)}
              />
            );
          })}
          {SOON_2.map(([x, y], k) => (
            <Node
              key={k}
              x={x}
              y={y}
              state="locked"
              number={0}
              label={["Búsqueda binaria", "Grafos", "Prog. dinámica"][k]!}
              selected={selected === "soon2"}
              onClick={() => setSelected("soon2")}
            />
          ))}
          <Node
            x={BOSS[0]}
            y={BOSS[1]}
            state="locked"
            number={0}
            trophy
            label="Ronda final"
            selected={selected === "soon3"}
            onClick={() => setSelected("soon3")}
          />

          {character !== null && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full motion-safe:animate-bounce"
              style={{ left: `${((px + 34) / W) * 100}%`, top: `${((py - 18) / H) * 100}%` }}
              aria-hidden="true"
            >
              <Sprite index={character} state="idle" scale={0.5} />
            </div>
          )}
        </div>
      </div>

      <aside className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        {typeof selected === "number" ? (
          <TopicPanel
            topic={topics[selected]!}
            index={selected}
            state={states[selected]!}
            solved={solved}
            previous={topics[selected - 1]}
            onOpen={() => onOpen(topics[selected]!.id)}
          />
        ) : (
          <SoonPanel world={selected === "soon2" ? 1 : 2} />
        )}
        <p className="mt-auto text-xs text-muted-foreground">
          Mundo 1: {done} de {topics.length} temas completos
        </p>
        <Legend />
      </aside>
    </div>
  );
}

/** Letrero pixel con el nombre del mundo. */
function Sign({
  x,
  y,
  world,
  title,
  color,
}: {
  x: number;
  y: number;
  world: number;
  title: string;
  color: string;
}) {
  return (
    <p
      className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap border-2 bg-[#07040d]/90 px-2.5 py-1.5 text-[9px] shadow-[3px_3px_0_0_rgb(0_0_0_/_0.6)]"
      style={{
        ...PIXEL,
        left: `${(x / W) * 100}%`,
        top: `${(y / H) * 100}%`,
        color,
        borderColor: color,
      }}
    >
      Mundo {world} · {title}
    </p>
  );
}

// Botones de arcade: cara redonda, brillo arriba y canto oscuro abajo.
const NODE: Record<TopicState, string> = {
  done: "bg-[#2dd4bf] text-[#04302b] shadow-[inset_0_-5px_0_0_#0f766e,0_4px_0_0_#04302b]",
  current:
    "bg-primary text-primary-foreground shadow-[inset_0_-5px_0_0_rgb(0_0_0_/_0.25),0_4px_0_0_rgb(0_0_0_/_0.6),0_0_22px_var(--primary)]",
  locked: "bg-[#1c1830] text-[#6b6488] shadow-[inset_0_-5px_0_0_#100d1d,0_4px_0_0_#05030a]",
};

function Node({
  x,
  y,
  state,
  number,
  label,
  selected,
  trophy = false,
  onClick,
}: {
  x: number;
  y: number;
  state: TopicState;
  number: number;
  label: string;
  selected: boolean;
  trophy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${label}: ${state === "done" ? "completado" : state === "current" ? "disponible" : "bloqueado"}`}
      className="group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
      style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
    >
      <span className="relative grid place-items-center">
        {state === "current" && (
          <span className="absolute inset-0 rounded-full bg-primary/40 motion-safe:animate-ping" />
        )}
        <span
          className={`relative grid h-14 w-14 place-items-center rounded-full border-2 border-black/60 transition-transform group-hover:-translate-y-0.5 ${NODE[state]} ${
            selected ? "outline outline-4 outline-offset-2 outline-white/85" : ""
          }`}
          style={PIXEL}
        >
          <span className="pointer-events-none absolute left-3 top-2 h-2 w-4 rounded-full bg-white/35" />
          {trophy ? (
            <PixelIcon name="trophy" className="h-7 w-7 text-[#fbbf24]" />
          ) : state === "done" ? (
            <PixelIcon name="check" className="h-6 w-6" />
          ) : state === "locked" ? (
            <Lock />
          ) : (
            <span className="text-base">{number}</span>
          )}
        </span>
      </span>
      <span
        className={`max-w-[9rem] rounded bg-[#07040d]/75 px-1.5 py-0.5 text-center text-[11px] leading-tight ${
          state === "current"
            ? "text-primary"
            : state === "done"
              ? "text-[#5eead4]"
              : "text-[#a29cc0]"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

function Lock() {
  return (
    <svg
      viewBox="0 0 8 8"
      width="20"
      height="20"
      shapeRendering="crispEdges"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M2 1h4v1H2zM1 2h1v2H1zM6 2h1v2H6zM1 4h6v4H1z" />
      <path d="M3 5h2v2H3z" fill="#1c1830" />
    </svg>
  );
}

const STATE_LABEL: Record<TopicState, [string, string]> = {
  done: ["Completado", "bg-success-soft text-success"],
  current: ["Disponible", "bg-primary/20 text-primary"],
  locked: ["Bloqueado", "bg-muted text-muted-foreground"],
};

function TopicPanel({
  topic,
  index,
  state,
  solved,
  previous,
  onOpen,
}: {
  topic: Topic;
  index: number;
  state: TopicState;
  solved: Solved;
  previous: Topic | undefined;
  onOpen: () => void;
}) {
  const count = topic.exercises.filter((e) => e.id in solved).length;
  const points = topic.exercises.reduce((sum, e) => sum + e.points, 0);
  const [label, chip] = STATE_LABEL[state];
  return (
    <>
      <p className="text-[10px] tracking-widest text-muted-foreground" style={PIXEL}>
        Mundo 1 · Tema {index + 1}
      </p>
      <h2 className="text-lg text-foreground" style={PIXEL}>
        {topic.title}
      </h2>
      <span className={`w-fit rounded-md px-2 py-1 text-xs font-medium ${chip}`}>{label}</span>
      <p className="text-sm leading-relaxed text-muted-foreground">{topic.summary}</p>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Ejercicios" value={String(topic.exercises.length)} />
        <Stat label="Resueltos" value={`${count}/${topic.exercises.length}`} />
        <Stat label="Botín" value={`+${points} XP`} accent />
      </div>
      {state === "locked" ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Resuelve un ejercicio de «{previous?.title}» para desbloquearlo.
        </p>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="login-start w-full bg-primary py-3 text-[11px] text-primary-foreground"
          style={PIXEL}
        >
          {state === "done" ? "Repasar el tema" : "Entrar al tema"}
        </button>
      )}
    </>
  );
}

function SoonPanel({ world }: { world: 1 | 2 }) {
  const info = WORLDS[world]!;
  return (
    <>
      <p className="text-[10px] tracking-widest text-muted-foreground" style={PIXEL}>
        Mundo {info.number} · {info.level}
      </p>
      <h2 className="text-lg text-foreground" style={PIXEL}>
        {info.title}
      </h2>
      <span className="w-fit rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
        Próximamente
      </span>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {world === 1
          ? "Búsqueda binaria, grafos, programación dinámica y más. Se abre cuando terminemos el mundo Principiante."
          : "Los temas avanzados y una ronda final para cerrar el mapa."}
      </p>
    </>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono text-sm font-semibold ${accent ? "text-silk-2" : "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

function Legend() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <i className="h-2.5 w-2.5 bg-[#5eead4]" /> Completado
      </span>
      <span className="flex items-center gap-1.5">
        <i className="h-2.5 w-2.5 bg-primary" /> Disponible
      </span>
      <span className="flex items-center gap-1.5">
        <i className="h-2.5 w-2.5 bg-[#3b3556]" /> Bloqueado
      </span>
    </p>
  );
}
