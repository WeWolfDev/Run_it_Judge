import { useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";

import { WORLDS, type Topic } from "./content";
import { topicState, type Solved, type TopicState } from "./useProgress";

// Mapa de mundos: cada tema es una parada en el camino. Un tema se desbloquea
// al resolver al menos un ejercicio del anterior y se completa al resolverlos
// todos. Los mundos sin temas se ven bloqueados como "próximamente".
// Coordenadas en un lienzo de 1000 × 760; en pantallas chicas el mapa se
// desplaza de lado dentro de su caja.

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
  const [selected, setSelected] = useState<number | "soon2" | "soon3">(
    firstOpen === -1 ? topics.length - 1 : firstOpen,
  );

  const path = STOPS.map(([x, y]) => `${x},${y}`).join(" ");
  const done = states.filter((s) => s === "done").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="overflow-x-auto rounded-xl border border-border bg-[#0b0613]">
        <p className="px-3 pt-2 text-[11px] text-muted-foreground sm:hidden">
          Desliza el mapa de lado para ver los otros mundos.
        </p>
        <div className="relative min-w-[640px]" style={{ aspectRatio: `${W} / ${H}` }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {/* Estrellas fijas */}
            {Array.from({ length: 40 }, (_, k) => (
              <rect
                key={k}
                x={(k * 197) % W}
                y={(k * 89) % H}
                width="3"
                height="3"
                fill="white"
                opacity={0.15 + ((k * 7) % 5) / 20}
              />
            ))}
            <ellipse cx="310" cy="510" rx="290" ry="250" fill="#0f3a3a" opacity="0.85" />
            <ellipse cx="760" cy="500" rx="210" ry="190" fill="#2a2563" opacity="0.8" />
            <ellipse cx="770" cy="160" rx="150" ry="120" fill="#4a1636" opacity="0.85" />
            <polyline
              points={path}
              fill="none"
              stroke="#5eead4"
              strokeWidth="6"
              strokeDasharray="14 12"
              opacity="0.7"
            />
            <polyline
              points={`500,520 ${SOON_2.map(([x, y]) => `${x},${y}`).join(" ")} 770,190`}
              fill="none"
              stroke="#8b8aa8"
              strokeWidth="5"
              strokeDasharray="12 12"
              opacity="0.45"
            />
          </svg>

          <WorldLabel x={190} y={280} text={`Mundo 1 · ${world.title}`} color="text-[#5eead4]" />
          <WorldLabel
            x={760}
            y={330}
            text={`Mundo 2 · ${WORLDS[1]!.title}`}
            color="text-[#a5a3ff]"
          />
          <WorldLabel
            x={770}
            y={35}
            text={`Mundo 3 · ${WORLDS[2]!.title}`}
            color="text-[#ff7ab6]"
          />

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
            x={770}
            y={170}
            state="locked"
            number={0}
            trophy
            label="Ronda final"
            selected={selected === "soon3"}
            onClick={() => setSelected("soon3")}
          />
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

function WorldLabel({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  return (
    <p
      className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] ${color}`}
      style={{ ...PIXEL, left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
    >
      {text}
    </p>
  );
}

const NODE: Record<TopicState, string> = {
  done: "bg-[#5eead4] text-[#073b3a] border-[#99f6e4]",
  current: "bg-primary text-primary-foreground border-white",
  locked: "bg-[#1c1830] text-muted-foreground border-[#3b3556]",
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
      className="group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
      style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
    >
      <span
        className={`grid h-14 w-14 place-items-center rounded-xl border-2 shadow-[4px_4px_0_0_rgb(0_0_0_/_0.5)] transition-transform group-hover:-translate-y-0.5 ${NODE[state]} ${selected ? "ring-4 ring-white/80" : ""}`}
        style={PIXEL}
      >
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
      <span
        className={`max-w-[9rem] text-center text-[11px] leading-tight drop-shadow ${state === "current" ? "text-primary" : "text-foreground"}`}
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
