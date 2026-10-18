import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

import {
  AWARD_MS,
  AwardsScene,
  CodingScene,
  EventScene,
  IntroScene,
  OutroScene,
  TitleScene,
  TrackScene,
  WinnerScene,
} from "./scenes";

// Director del tráiler: reproduce las escenas en orden, con un corte animado
// entre cada una, y deja saltar a cualquiera para grabar clips sueltos.
// Teclas: Espacio reproducir/pausar el avance · ← → escena · 1-9, 0 · R desde
// el inicio · F pantalla completa · H ocultar controles.

type Scene = {
  id: string;
  label: string;
  ms: number;
  cut: string;
  render: () => ReactNode;
};

const SCENES: Scene[] = [
  {
    id: "intro",
    label: "Bienvenidos",
    ms: 4600,
    cut: "boot",
    render: () => <IntroScene />,
  },
  {
    id: "lema",
    label: "Solo uno en pie",
    ms: 5600,
    cut: "glitch",
    render: () => (
      <TitleScene
        text="Torneo de programación competitiva al estilo gamer donde solo uno queda en pie"
        accent={["gamer", "uno", "pie"]}
        size="md"
      />
    ),
  },
  {
    id: "pista",
    label: "La pista",
    ms: 14000,
    cut: "flash",
    render: () => <TrackScene />,
  },
  {
    id: "enfrentate",
    label: "Enfréntate",
    ms: 3800,
    cut: "glitch",
    render: () => (
      <TitleScene
        text="Enfréntate para ver quién es el vencedor"
        accent={["vencedor"]}
      />
    ),
  },
  {
    id: "codigo",
    label: "A programar",
    ms: 11800,
    cut: "flash",
    render: () => <CodingScene />,
  },
  {
    id: "ganador",
    label: "Un ganador",
    ms: 2800,
    cut: "glitch",
    render: () => (
      <TitleScene text="Un ganador" accent={["ganador"]} size="xl" />
    ),
  },
  {
    id: "campeon",
    label: "El campeón",
    ms: 7200,
    cut: "flash",
    render: () => <WinnerScene />,
  },
  {
    id: "premios-titulo",
    label: "Más premios",
    ms: 3400,
    cut: "glitch",
    render: () => (
      <TitleScene
        text="Más premios y regalos"
        accent={["premios", "regalos"]}
      />
    ),
  },
  {
    id: "premios",
    label: "Premios",
    ms: AWARD_MS * 3,
    cut: "flash",
    render: () => <AwardsScene />,
  },
  {
    id: "solo",
    label: "Solo en Run It",
    ms: 3000,
    cut: "glitch",
    render: () => (
      <TitleScene text="Solo en Run It" accent={["Run", "It"]} size="xl" />
    ),
  },
  {
    id: "animas",
    label: "¿Te animas?",
    ms: 3600,
    cut: "glitch",
    render: () => (
      <TitleScene text="¿Te animas a participar?" accent={["participar?"]} />
    ),
  },
  {
    id: "evento",
    label: "El evento",
    ms: 6800,
    cut: "boot",
    render: () => <EventScene />,
  },
  {
    id: "logos",
    label: "Logos",
    ms: 7000,
    cut: "white",
    render: () => <OutroScene />,
  },
];

const TOTAL_MS = SCENES.reduce((sum, scene) => sum + scene.ms, 0);

export function Trailer() {
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [take, setTake] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hud, setHud] = useState(true);
  const [idle, setIdle] = useState(false);
  const scene = SCENES[index]!;
  const done = useRef(false);

  const go = useCallback((next: number) => {
    done.current = false;
    setIndex(Math.max(0, Math.min(SCENES.length - 1, next)));
    setTake((n) => n + 1);
  }, []);

  // Avance automático: cada escena dura lo suyo; al terminar la última, negro.
  useEffect(() => {
    if (!started || !playing) return;
    const id = setTimeout(() => {
      if (index < SCENES.length - 1) go(index + 1);
      else done.current = true;
    }, scene.ms);
    return () => clearTimeout(id);
  }, [started, playing, index, take, scene.ms, go]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!started) return;
      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        setPlaying((p) => !p);
      } else if (key === "arrowright") go(index + 1);
      else if (key === "arrowleft") go(index - 1);
      else if (key === "r") go(0);
      else if (key === "h") setHud((v) => !v);
      else if (key === "f") toggleFullscreen();
      else if (/^[0-9]$/.test(key)) go(key === "0" ? 9 : Number(key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, index, go]);

  // Los controles y el cursor se esconden solos para grabar limpio.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 1800);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
    };
  }, []);

  if (!started) {
    return (
      <div className="tr-start">
        <p className="tr-start-eyebrow">Run It · tráiler</p>
        <h1 className="tr-start-title">Reproducción para grabar clips</h1>
        <p className="tr-start-copy">
          {SCENES.length} escenas, {Math.round(TOTAL_MS / 1000)} s. Graba la
          ventana en pantalla completa a 16:9 (1920×1080) para que la pista y
          los textos queden a escala.
        </p>
        <div className="tr-start-actions">
          <button
            type="button"
            className="tr-btn tr-btn-primary"
            onClick={() => {
              toggleFullscreen(true);
              setStarted(true);
              go(0);
            }}
          >
            Reproducir en pantalla completa
          </button>
          <button
            type="button"
            className="tr-btn"
            onClick={() => setStarted(true)}
          >
            Reproducir aquí
          </button>
        </div>
        <ul className="tr-keys">
          <li>
            <kbd>Espacio</kbd> pausa el avance
          </li>
          <li>
            <kbd>←</kbd> <kbd>→</kbd> escena anterior o siguiente
          </li>
          <li>
            <kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd> ir a una escena
          </li>
          <li>
            <kbd>R</kbd> desde el inicio · <kbd>H</kbd> controles · <kbd>F</kbd>{" "}
            pantalla completa
          </li>
        </ul>
      </div>
    );
  }

  return (
    <div className={cn("tr-root", idle && "tr-idle")}>
      <div
        key={`${index}-${take}`}
        className={cn("tr-scene", `tr-cut-${scene.cut}`)}
      >
        {scene.render()}
      </div>
      <div
        key={`cut-${index}-${take}`}
        className={cn("tr-cut", `tr-cut-overlay-${scene.cut}`)}
        aria-hidden="true"
      />
      {hud && (
        <nav className="tr-hud" aria-label="Escenas del tráiler">
          <button
            type="button"
            className="tr-hud-btn"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "Pausar" : "Seguir"}
          </button>
          {SCENES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => go(i)}
              className={cn("tr-hud-chip", i === index && "tr-hud-chip-on")}
              title={`${(s.ms / 1000).toFixed(1)} s`}
            >
              {i < 9 ? i + 1 : i === 9 ? 0 : "·"} {s.label}
            </button>
          ))}
          <button type="button" className="tr-hud-btn" onClick={() => go(0)}>
            Desde el inicio
          </button>
        </nav>
      )}
    </div>
  );
}

function toggleFullscreen(force?: boolean) {
  const doc = document as Document & { webkitFullscreenElement?: Element };
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => void;
  };
  if (force || !(document.fullscreenElement || doc.webkitFullscreenElement)) {
    (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.())?.catch?.(
      () => undefined,
    );
  } else {
    void document.exitFullscreen?.().catch(() => undefined);
  }
}
