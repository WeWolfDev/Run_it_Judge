import { useEffect, useRef, useState } from "react";

import type { Entry, FeedEvent, TrackRound } from "@/components/ProjectedTrack";
import { CHARACTERS } from "@/lib/characters";

// Vista del público (/publico): la misma ronda que /pista, dibujada como un
// minijuego que se sortea para cada espectador. Nada de esto toca lo que juega
// el participante: todas las vistas reciben el ranking del servidor ya ordenado.

export const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
/** Tests de cada problema: el estándar del torneo son 30. */
export const TESTS = 30;
/** Niveles de las vistas (pisos, globos, goles): uno cada 6 tests (6, 12, 18, 24, 30). */
export const LEVELS = 5;
export const PER_LEVEL = TESTS / LEVELS;

export type ViewProps = {
  round: TrackRound;
  board: Entry[];
  events: FeedEvent[];
  /** Diferencia con el reloj del servidor (useServerClockOffset). */
  serverOffsetMs: number;
};

export type ViewInfo = {
  id: ViewId;
  name: string;
  /** La regla en una línea, para el cartel de presentación. */
  rule: string;
  /** Cómo se dice "resolvió" en esta vista, para el feed. */
  goal: string;
  /** Título del resumen de eliminados. */
  ending: string;
  /** Cómo se lee la vista, siempre a la vista: quien llega tarde no vio el cartel. */
  legend?: (capacity: number) => string[];
};

export type ViewId = "pista" | "torre" | "globos" | "futbol" | "bote";

/** Tests pasados, a partir del porcentaje del ranking (estándar de 30). */
export const passedOf = (entry: Entry) =>
  Math.round(((Number(entry.best_pass_percentage) || 0) / 100) * TESTS);
/** Nivel de 0 a 5: cuántos bloques de 6 tests completó. */
export const levelOf = (entry: Entry) => Math.floor(passedOf(entry) / PER_LEVEL);
export const characterOf = (entry: Entry) => entry.character ?? 0;

/** Estado de cada puesto respecto del cupo (igual que la pista). */
export function zoneOf(entry: Entry, rank: number, capacity: number, closed: boolean) {
  if (closed) return entry.final_status === "advanced" ? "in" : "out";
  if (rank > capacity) return "out";
  return entry.solved_at ? "in" : "zone";
}

// ---------------------------------------------------------------- vistas

export const VIEWS: ViewInfo[] = [
  {
    id: "pista",
    name: "La pista",
    rule: "La carrera de siempre: cada test resuelto es un tramo de pista. Clasifican los primeros en llegar a la meta.",
    goal: "llegó a la meta",
    ending: "terminó la carrera",
  },
  {
    id: "torre",
    name: "La torre de lava",
    rule: "Cada 6 tests resueltos suben un piso; con los 30 llegas a la cima. Al terminar el tiempo la lava sube hasta la cima: solo se salvan los que pasan el corte.",
    goal: "llegó a la cima",
    ending: "la lava llegó a la cima",
    legend: (capacity) => [
      "Cada 6 tests sube un piso (30 = la cima)",
      `Pasan ${capacity}: los mejores puestos`,
      "Al terminar, la lava sube hasta la cima",
    ],
  },
  {
    id: "globos",
    name: "Globos al cielo",
    rule: "Cada 6 tests resueltos suben tu globo un nivel; con los 30 llega a la nube dorada. Globo verde: dentro del cupo. Al terminar, los globos de afuera se pinchan.",
    goal: "llegó a la nube dorada",
    ending: "se pincharon los globos",
    legend: (capacity) => [
      "Cada 6 tests sube el globo un nivel (30 = la nube)",
      `Globo verde o dorado: dentro de los ${capacity} que pasan`,
      "Al terminar, los globos rojos se pinchan",
    ],
  },
  {
    id: "futbol",
    name: "Fútbol: el arco",
    rule: "Cada 6 tests resueltos son un gol: una pelota más en tu arco; con los 30, arco lleno. En la tribuna VIP entran los mejores puestos. Al sonar el silbato final, los de la cancha se van.",
    goal: "llenó su arco de goles",
    ending: "sonó el silbato final",
    legend: (capacity) => [
      "Cada 6 tests es un gol (30 = arco lleno)",
      `En la tribuna VIP entran ${capacity}: los mejores puestos`,
      "Al silbato final, los de la cancha se van",
    ],
  },
  {
    id: "bote",
    name: "El bote salvavidas",
    rule: "En el bote caben los del cupo: los mejores puestos van arriba. El resto nada en fila esperando un lugar. Al terminar el tiempo, el bote zarpa.",
    goal: "aseguró su lugar en el bote",
    ending: "el bote zarpó",
    legend: (capacity) => [
      `En el bote caben ${capacity}: los mejores puestos`,
      "Con salvavidas dorado = ya resolvió, nadie lo baja",
      "Al terminar el tiempo el bote zarpa",
    ],
  },
];

export const viewInfo = (id: ViewId) => VIEWS.find((view) => view.id === id)!;

const VIEW_KEY = "run-it-publico-vista";

/** Al azar para cada espectador, sin repetir la última que vio en este navegador. */
export function pickView(): ViewInfo {
  let last: string | null = null;
  try {
    last = window.localStorage.getItem(VIEW_KEY);
  } catch {
    // Sin almacenamiento: cualquiera vale.
  }
  const options = VIEWS.filter((view) => view.id !== last);
  const view = options[Math.floor(Math.random() * options.length)] ?? VIEWS[0]!;
  try {
    window.localStorage.setItem(VIEW_KEY, view.id);
  } catch {
    // Sin almacenamiento: se sortea igual.
  }
  return view;
}

// ---------------------------------------------------------------- hooks

/** Hora del servidor, corregida con el desfase del reloj local. */
export function useNow(serverOffsetMs = 0, ms = 250) {
  const [now, setNow] = useState(() => Date.now() + serverOffsetMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + serverOffsetMs), ms);
    return () => clearInterval(id);
  }, [ms, serverOffsetMs]);
  return now;
}

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * Pasos del final de ronda. -1 mientras la ronda corre; al cerrarse avanza solo
 * por cada duración y se queda en el último (el resumen).
 */
export function useFinale(closed: boolean, durations: number[]) {
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (!closed) {
      setStep(-1);
      return;
    }
    setStep(0);
    let at = 0;
    const timers = durations.map((ms, i) => {
      at += ms;
      return setTimeout(() => setStep(i + 1), at);
    });
    return () => timers.forEach(clearTimeout);
    // Las duraciones son constantes de cada vista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closed]);
  return step;
}

// ---------------------------------------------------------------- personajes

// Personajes del mismo tamaño visible en todas las vistas. Muchas hojas dejan
// margen transparente alrededor del dibujo: se mide el primer cuadro quieto una
// vez y se ajusta la escala (la misma idea que la pista proyectada).
type Bounds = { height: number; bottom: number };
const bounds = new Map<number, Bounds | "loading">();
const listeners = new Set<() => void>();

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
    listeners.forEach((listener) => listener());
  };
  img.src = anim.sheet;
}

/** Vuelve a dibujar cuando termina de medir a los personajes pedidos. */
export function useSpriteBounds(indexes: number[]) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  indexes.forEach(measure);
}

/** Escala entera de Sprite, ajuste fino con zoom y margen de abajo para apoyarlo. */
export function spriteFit(index: number, room: number) {
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
