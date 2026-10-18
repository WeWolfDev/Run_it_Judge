import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { Hit, Score, Section } from "./audio";

// Director de un tráiler: reproduce las escenas en orden, con un corte animado
// entre cada una, y deja saltar a cualquiera para grabar clips sueltos.
// Teclas: Espacio reproducir/pausar el avance · ← → escena · 1-9, 0 · R desde
// el inicio · F pantalla completa · H ocultar controles.
//
// "Vista celular 9:16" abre el mismo tráiler dentro de un recuadro vertical:
// el iframe tiene su propio viewport, así que las escenas se arman igual que en
// un celular de verdad y se puede grabar esa porción de la pantalla del PC.

export type Scene = {
  id: string;
  label: string;
  ms: number;
  cut: "flash" | "glitch" | "boot" | "white";
  section: Section;
  render: () => ReactNode;
};

/** El golpe de sonido de cada tipo de corte. */
const CUT_HIT: Record<Scene["cut"], Hit> = {
  flash: "impact",
  glitch: "glitch",
  boot: "boot",
  white: "shimmer",
};

/** Nombre del iframe de la vista 9:16: adentro el director arranca embebido. */
const FRAME = "runit-cel";
const embedded = typeof window !== "undefined" && window.name === FRAME;

export function Director({
  scenes,
  score,
  eyebrow,
}: {
  scenes: Scene[];
  score: Score;
  eyebrow: string;
}) {
  const [started, setStarted] = useState(false);
  const [framed, setFramed] = useState(false);
  const [index, setIndex] = useState(0);
  const [take, setTake] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hud, setHud] = useState(true);
  const [muted, setMuted] = useState(false);
  const idle = useIdle();
  const scene = scenes[index]!;
  const total = scenes.reduce((sum, s) => sum + s.ms, 0);

  const go = useCallback(
    (next: number) => {
      setIndex(Math.max(0, Math.min(scenes.length - 1, next)));
      setTake((n) => n + 1);
    },
    [scenes.length],
  );

  // La vista 9:16 avisa que cargó; si no, el marco ofrece otra salida.
  useEffect(() => {
    (window as Window & { __runitReady?: boolean }).__runitReady = true;
  }, []);

  // Música: cada escena pone su sección y su corte suena.
  useEffect(() => {
    if (!started) return;
    score.setSection(scene.section, take <= 1);
    score.hit(CUT_HIT[scene.cut]);
  }, [started, index, take, scene.section, scene.cut, score]);
  useEffect(() => () => score.stop(), [score]);

  // Avance automático: cada escena dura lo suyo; la última se queda en negro.
  useEffect(() => {
    if (!started || !playing || index >= scenes.length - 1) return;
    const id = setTimeout(() => go(index + 1), scene.ms);
    return () => clearTimeout(id);
  }, [started, playing, index, take, scene.ms, scenes.length, go]);

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

  const begin = (fullscreen: boolean) => {
    score.start();
    if (fullscreen) toggleFullscreen(true);
    setStarted(true);
    go(0);
  };

  if (framed) return <PhoneFrame onExit={() => setFramed(false)} idle={idle} />;

  if (!started) {
    return (
      <div className="tr-start">
        <p className="tr-start-eyebrow">{eyebrow}</p>
        <h1 className="tr-start-title">
          {embedded ? "Vista celular 9:16" : "Reproducción para grabar clips"}
        </h1>
        <p className="tr-start-copy">
          {scenes.length} escenas, {Math.round(total / 1000)} s.{" "}
          {embedded
            ? "Así se ve en un celular en vertical. Los controles se esconden solos al dejar quieto el mouse."
            : "Graba en pantalla completa a 16:9 (1920×1080), o abre la vista celular para grabar el formato vertical (9:16) desde el PC."}
        </p>
        <div className="tr-start-actions">
          {embedded ? (
            <button
              type="button"
              className="tr-btn tr-btn-primary"
              onClick={() => begin(false)}
            >
              Reproducir
            </button>
          ) : (
            <>
              <button
                type="button"
                className="tr-btn tr-btn-primary"
                onClick={() => begin(true)}
              >
                Reproducir en pantalla completa
              </button>
              <button
                type="button"
                className="tr-btn"
                onClick={() => begin(false)}
              >
                Reproducir aquí
              </button>
              <button
                type="button"
                className="tr-btn tr-btn-cel"
                onClick={() => setFramed(true)}
              >
                Vista celular 9:16
              </button>
            </>
          )}
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
            <kbd>R</kbd> desde el inicio · <kbd>H</kbd> controles
            {!embedded && (
              <>
                {" "}
                · <kbd>F</kbd> pantalla completa
              </>
            )}
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
        <nav className="tr-hud" aria-label="Escenas">
          <button
            type="button"
            className="tr-hud-btn"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "Pausar" : "Seguir"}
          </button>
          <button
            type="button"
            className="tr-hud-btn"
            aria-pressed={!muted}
            onClick={() => {
              score.setMuted(!muted);
              setMuted(!muted);
            }}
          >
            Música: {muted ? "no" : "sí"}
          </button>
          {scenes.map((s, i) => (
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
          <button
            type="button"
            className="tr-hud-btn"
            onClick={() => go(index - 1)}
          >
            ◀
          </button>
          <button
            type="button"
            className="tr-hud-btn"
            onClick={() => go(index + 1)}
          >
            ▶
          </button>
          <button type="button" className="tr-hud-btn" onClick={() => go(0)}>
            Desde el inicio
          </button>
        </nav>
      )}
    </div>
  );
}

/**
 * El tráiler en un recuadro 9:16 al alto de la pantalla, para grabarlo desde el
 * PC. Es la misma página dentro de un iframe (srcdoc): mismos estilos y mismo
 * script, con su propio viewport vertical.
 */
function PhoneFrame({ onExit, idle }: { onExit: () => void; idle: boolean }) {
  const [srcDoc] = useState(buildSrcDoc);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      const child = frame.current?.contentWindow as
        | (Window & { __runitReady?: boolean })
        | null
        | undefined;
      try {
        if (!child?.__runitReady) setFailed(true);
      } catch {
        setFailed(true);
      }
    }, 6000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const measure = () => {
      const box = frame.current?.getBoundingClientRect();
      if (!box) return;
      const dpr = window.devicePixelRatio || 1;
      setSize(
        `${Math.round(box.width * dpr)}×${Math.round(box.height * dpr)} px`,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div className={cn("tr-rec", idle && "tr-rec-idle")}>
      <iframe
        ref={frame}
        name={FRAME}
        title="Tráiler en vista de celular 9:16"
        className="tr-rec-frame"
        srcDoc={srcDoc}
        allow="autoplay; fullscreen"
      />
      <aside className="tr-rec-bar">
        <p className="tr-rec-title">Vista celular 9:16</p>
        <p className="tr-rec-size">Recuadro: {size}</p>
        <div className="tr-rec-actions">
          <button
            type="button"
            className="tr-btn"
            onClick={() => toggleFullscreen()}
          >
            Pantalla completa
          </button>
          <button type="button" className="tr-btn" onClick={onExit}>
            Salir
          </button>
        </div>
        <div className="tr-rec-help">
          <p>
            <b>Para grabar:</b> dale a Reproducir dentro del recuadro y graba
            solo esa zona.
          </p>
          <p>
            <b>Mac:</b> <kbd>⇧</kbd> <kbd>⌘</kbd> <kbd>5</kbd> → “Grabar parte
            de la pantalla” y ajusta el rectángulo al recuadro.
          </p>
          <p>
            <b>Windows:</b> Recortes (<kbd>Win</kbd> <kbd>⇧</kbd>{" "}
            <kbd>R</kbd>) y selecciona el recuadro.
          </p>
          <p>
            El sonido sale del recuadro: activa “grabar audio del sistema” si
            quieres la música en el video.
          </p>
        </div>
        {failed && (
          <p className="tr-rec-fail" role="alert">
            Este navegador no abrió la vista. Alternativa en Chrome: F12 → ícono
            de celular (<kbd>Ctrl</kbd> <kbd>⇧</kbd> <kbd>M</kbd>) → elige un
            celular y recarga.
          </p>
        )}
      </aside>
    </div>
  );
}

/** La misma página para el iframe: hojas de estilo y módulos, sin el contenido. */
function buildSrcDoc() {
  const styles = [
    ...document.querySelectorAll<HTMLElement>(
      "style, link[rel='stylesheet'], link[rel='preconnect']",
    ),
  ]
    .map((node) => node.outerHTML)
    .join("");
  const scripts = [
    ...document.querySelectorAll<HTMLScriptElement>(
      "script[type='module'][src]",
    ),
  ]
    .map((node) => `<script type="module" src="${node.src}"></script>`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body style="margin:0;background:#000"><div id="root"></div>${scripts}</body></html>`;
}

/** Los controles y el cursor se esconden solos para grabar limpio. */
function useIdle() {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 1800);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("pointerdown", wake);
    };
  }, []);
  return idle;
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
