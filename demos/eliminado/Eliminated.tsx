import { useEffect, useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import { play } from "@/lib/sfx";

// DEMO: pantalla del participante que no clasificó. Primero la animación de
// eliminado (temblor, destello rojo, derrota del personaje y GAME OVER) y
// después la pantalla CRT de despedida con el botón para salir al login.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
/** Cuánto dura la animación de eliminado antes de pasar a la pantalla CRT. */
const OUT_MS = 4800;
/** La derrota se ve más lenta que en la pista, para que se aprecie. */
const DEFEAT_SPEED = 0.4;

export type EliminatedProps = {
  name: string;
  character: number;
  roundNumber: number;
  rank: number;
  total: number;
  capacity: number;
  /** Mejor resultado en la ronda: tests pasados de los totales. */
  passed: number;
  tests: number;
  fails: number;
  onExit: () => void;
  onSpectate?: () => void;
};

export function Eliminated(props: EliminatedProps) {
  const [phase, setPhase] = useState<"out" | "crt">("out");
  useEffect(() => {
    play("over");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = setTimeout(() => setPhase("crt"), reduced ? 800 : OUT_MS);
    return () => clearTimeout(id);
  }, []);
  return phase === "out" ? <GameOver {...props} /> : <Farewell {...props} />;
}

function GameOver({ character, roundNumber }: EliminatedProps) {
  return (
    <section className="elim-stage animate-run-it-shake relative grid min-h-[28rem] place-items-center overflow-hidden rounded-xl">
      {/* Destello rojo al cerrarse la ronda. */}
      <div className="animate-run-it-flash pointer-events-none absolute inset-0 bg-danger" />
      <div className="relative z-10 flex flex-col items-center gap-6 text-center">
        <div className="elim-fall">
          <Sprite index={character} state="out" scale={2} speed={DEFEAT_SPEED} />
        </div>
        <p className="elim-glitch text-[clamp(1.4rem,4vw,3rem)] leading-none text-danger" style={PIXEL} data-text="GAME OVER">
          GAME OVER
        </p>
        <p className="animate-run-it-rise text-sm text-foreground sm:text-base" style={{ animationDelay: "0.9s" }}>
          Quedaste fuera en la ronda {roundNumber}
        </p>
      </div>
    </section>
  );
}

function Farewell({
  name,
  character,
  roundNumber,
  rank,
  total,
  capacity,
  passed,
  tests,
  fails,
  onExit,
  onSpectate,
}: EliminatedProps) {
  return (
    <section className="elim-crt relative overflow-hidden">
      <div className="elim-scan pointer-events-none absolute inset-0" />
      <div className="run-it-crt-sweep" />
      <div className="animate-run-it-flicker relative z-10 flex min-h-[28rem] flex-col items-center justify-center gap-5 px-6 py-10 text-center">
        <Sprite index={character} state="out" scale={2.6} />
        <p className="elim-title text-[clamp(1.2rem,4vw,2.6rem)] leading-tight text-danger" style={PIXEL}>
          Fin del camino
        </p>
        <p className="max-w-xl text-base text-foreground sm:text-lg">
          {name}, quedaste <b>{rank}.º de {total}</b> en la ronda {roundNumber}. Clasificaban {capacity}.
        </p>
        <div className="flex flex-wrap justify-center gap-2 text-sm">
          <span className="elim-chip">
            <PixelIcon name="check" className="h-4 w-4 text-success" /> Mejor envío: {passed}/{tests} tests
          </span>
          <span className="elim-chip">
            <PixelIcon name="close" className="h-4 w-4 text-danger" /> Envíos fallidos: {fails}
          </span>
        </div>
        <p className="animate-run-it-blink text-xs text-muted-foreground sm:text-sm" style={PIXEL}>
          ¡Gracias por correr!
        </p>
        <div className="mt-2 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => {
              play("click");
              onExit();
            }}
            className="elim-exit bg-primary px-6 py-3 text-xs text-primary-foreground sm:text-sm"
            style={PIXEL}
          >
            Salir al login
          </button>
          {onSpectate && (
            <button type="button" onClick={onSpectate} className="text-xs text-muted-foreground underline hover:text-foreground">
              Seguir mirando la pista
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
