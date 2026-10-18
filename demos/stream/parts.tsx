import type { CSSProperties } from "react";

import { TallyBars, VoteQr } from "@/components/hits/Grada";
import { Sprite } from "@/components/Sprite";
import { CHARACTERS } from "@/lib/characters";
import { formatLeft, hitInfo, type HitId, type HitPoll } from "@/lib/hits";
import { formatClock } from "@/lib/runit";
import { cn } from "@/lib/utils";

// Piezas del tráiler del livestream: la transmisión con el recuadro del voto y
// el celular con /votar (el mismo flujo y los mismos estilos de la app real).
// Las escenas las manejan con el paso del voto (index) y el tiempo dentro del
// paso (t).

export const PIXEL: CSSProperties = {
  fontFamily: "'Press Start 2P', ui-monospace, monospace",
};

// El primer par real de run-it-backend/hits.js: Minuto extra contra Niebla.
export const GOOD: HitId = "extra";
export const BAD: HitId = "niebla";

/** Personajes con licencia libre (Tiny Heroes de CraftPix), como en el tráiler. */
export const LICENSED = ["Monstruo Rosa", "Búho", "Dude"].map((name) =>
  Math.max(
    0,
    CHARACTERS.findIndex((c) => c.name === name),
  ),
);

/** Los pasos del voto, con su duración en el ciclo animado. */
export const STEPS = [
  {
    id: "scan",
    ms: 3600,
    title: "Escanea el QR",
    text: "Aparece en la transmisión y en la pantalla del evento.",
  },
  {
    id: "soon",
    ms: 3600,
    title: "Votación próxima",
    text: "Tienes 15 segundos para ver las dos opciones.",
  },
  {
    id: "vote",
    ms: 5600,
    title: "Elige el hit",
    text: "Un hit bueno contra uno malo. Toca el que quieras.",
  },
  {
    id: "result",
    ms: 4200,
    title: "Cae sobre la ronda",
    text: "El más votado afecta a todos los jugadores en vivo.",
  },
] as const;

/** Recuento simulado: sube mientras la votación está abierta. */
export function pollAt(
  index: number,
  t: number,
): HitPoll & { mine: "good" | "bad" | null } {
  const open = index === 2 ? t / STEPS[2].ms : index === 3 ? 1 : 0;
  const good = Math.round(open * 41);
  const bad = Math.round(open * 26);
  const iso = new Date().toISOString();
  return {
    id: "demo",
    good: GOOD,
    bad: BAD,
    announced_at: iso,
    opens_at: iso,
    closes_at: iso,
    status: index === 3 ? "closed" : "open",
    winner: index === 3 ? GOOD : null,
    tally: { good, bad },
    mine: (index === 2 && t > 2200) || index === 3 ? "good" : null,
  };
}

/** La transmisión: la pista de fondo y el recuadro del voto con el QR. */
export function StreamScreen({
  index,
  t,
  poll,
}: {
  index: number;
  t: number;
  poll: HitPoll;
}) {
  const voting = index === 1 || index === 2;
  const lanes = [
    { name: "Leo", pct: 88 },
    { name: "Misa", pct: 74 },
    { name: "Andy", pct: 61 },
    { name: "Dani", pct: 47 },
  ];
  return (
    <div className="sp-screen" aria-label="Así se ve la transmisión">
      <div className="sp-screen-top">
        <span className="sp-live">● En vivo</span>
        <span className="sp-screen-title" style={PIXEL}>
          Run It · Ronda 3
        </span>
        <span className="sp-screen-clock" style={PIXEL}>
          {formatClock(8 * 60_000 + 49_000 - (index * 4000 + t))}
        </span>
      </div>
      <div className="sp-lanes">
        {lanes.map((lane, i) => (
          <div
            key={lane.name}
            className={cn("sp-lane", index === 3 && "sp-lane-boost")}
          >
            <span className="sp-lane-name">{lane.name}</span>
            <span className="sp-lane-runner" style={{ left: `${lane.pct}%` }}>
              <MiniSprite index={LICENSED[i % LICENSED.length]!} px={34} />
            </span>
          </div>
        ))}
      </div>
      <div
        className={cn(
          "vot-card sp-grada",
          index === 3 && "vot-bueno",
          voting && "sp-grada-on",
        )}
      >
        {index === 3 ? (
          <>
            <p className="sp-grada-label" style={PIXEL}>
              La grada eligió · hit bueno
            </p>
            <p className="sp-grada-winner" style={PIXEL}>
              {hitInfo(GOOD).name}
            </p>
            <p className="sp-grada-text">{hitInfo(GOOD).text}</p>
          </>
        ) : (
          <>
            <p className="sp-grada-label text-accent" style={PIXEL}>
              {index === 1 ? "Votación próxima" : "¡Vota el hit!"}
            </p>
            <div className="sp-grada-row">
              <VoteQr size={64} />
              <p className="sp-grada-count" style={PIXEL}>
                {formatLeft(
                  index === 1
                    ? 15_000 - t * 4
                    : index === 2
                      ? 40_000 - t * 7
                      : 15_000,
                )}
              </p>
            </div>
            {index === 2 ? (
              <TallyBars poll={poll} good={hitInfo(GOOD)} bad={hitInfo(BAD)} />
            ) : (
              <p className="sp-grada-text">
                <b className="text-[#ffd34d]">{hitInfo(GOOD).name}</b> contra{" "}
                <b className="text-[#f08a4b]">{hitInfo(BAD).name}</b>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** El celular con /votar: escanear, votación próxima, votar y resultado. */
export function Phone({
  index,
  t,
  poll,
}: {
  index: number;
  t: number;
  poll: HitPoll & { mine: "good" | "bad" | null };
}) {
  const tapping = index === 2 && t > 1700 && t < 2400;
  return (
    <div className="sp-phone" aria-label="Así se vota desde el celular">
      <div className="sp-phone-notch" aria-hidden="true" />
      <div className="sp-phone-screen">
        {index === 0 ? (
          <div className="sp-scan">
            <p className="sp-scan-hint">Cámara</p>
            <div className="sp-scan-frame">
              <VoteQr size={128} />
              <span className="sp-scan-line" aria-hidden="true" />
            </div>
            <p className={cn("sp-scan-link", t > 2000 && "sp-scan-link-on")}>
              Abrir <b>runit · /votar</b>
            </p>
          </div>
        ) : (
          <div className="sp-votar">
            <div className="flex items-center justify-between">
              <span className="text-sm text-primary" style={PIXEL}>
                Run It
              </span>
              <span
                className="rounded border-2 border-[#3a2f55] px-2 py-1 text-[0.55rem]"
                style={PIXEL}
              >
                En vivo
              </span>
            </div>
            {index === 1 && (
              <>
                <p className="mt-4 text-base leading-tight" style={PIXEL}>
                  Votación próxima
                </p>
                <p className="mt-1 text-xs text-[#b9acd6]">
                  Mira las opciones: en unos segundos podrás votar.
                </p>
                <PhoneTimer label="Abre en" ms={15_000 - t * 4} blink />
                <div className="mt-3 space-y-2 opacity-70">
                  <PhoneOption id={BAD} />
                  <PhoneOption id={GOOD} />
                </div>
              </>
            )}
            {index === 2 && (
              <>
                <p className="mt-4 text-base leading-tight" style={PIXEL}>
                  Elige el hit
                </p>
                <PhoneTimer label="Cierra en" ms={40_000 - t * 7} />
                <div className="mt-3 space-y-2">
                  <div className={cn(poll.mine && "opacity-50")}>
                    <PhoneOption id={BAD} />
                  </div>
                  <div
                    className={cn(
                      "relative",
                      poll.mine === "good" && "sp-picked",
                    )}
                  >
                    <PhoneOption id={GOOD} />
                    <span
                      className={cn("sp-finger", tapping && "sp-finger-tap")}
                      aria-hidden="true"
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-[#b9acd6]" role="status">
                  {poll.mine
                    ? "¡Listo! Tu voto ya cuenta."
                    : "Toca una opción para votar."}
                </p>
                <p
                  className="mt-2 text-[0.5rem] uppercase text-[#b9acd6]"
                  style={PIXEL}
                >
                  Así va la grada
                </p>
                <TallyBars
                  poll={poll}
                  good={hitInfo(GOOD)}
                  bad={hitInfo(BAD)}
                />
              </>
            )}
            {index === 3 && (
              <>
                <p className="mt-4 text-xs text-[#b9acd6]">La grada eligió</p>
                <div className="mt-2 animate-run-it-pop">
                  <PhoneOption id={GOOD} />
                </div>
                <p className="mt-2 text-xs tabular-nums" style={PIXEL}>
                  +1:00 al reloj
                </p>
                <p className="mt-3 text-xs">Votaste por este hit.</p>
                <TallyBars
                  poll={poll}
                  good={hitInfo(GOOD)}
                  bad={hitInfo(BAD)}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Sprite a tamaño real achicado con transform hasta entrar en la casilla. */
export function MiniSprite({ index, px }: { index: number; px: number }) {
  const character = CHARACTERS[index]!;
  const width = character.gif ? character.gif.width : character.fw;
  const height = character.gif ? character.gif.height : character.fh;
  return (
    <span className="sp-mini" style={{ width: px, height: px }}>
      <span
        className="sp-mini-inner"
        style={{
          width,
          height,
          transform: `translateX(-50%) scale(${(px / Math.max(height, width * 0.8)) * 1.3})`,
        }}
      >
        <Sprite index={index} state="run" scale={0.01} />
      </span>
    </span>
  );
}

export function PhoneOption({ id }: { id: HitId }) {
  const hit = hitInfo(id);
  return (
    <span className={cn("vot-option block p-3", `vot-option-${hit.kind}`)}>
      <span className="text-[0.5rem] uppercase opacity-80" style={PIXEL}>
        Hit {hit.kind}
      </span>
      <span className="mt-1 block text-sm leading-tight" style={PIXEL}>
        {hit.name}
      </span>
      <span className="mt-1 block text-[0.7rem]">{hit.text}</span>
    </span>
  );
}

export function PhoneTimer({
  label,
  ms,
  blink = false,
}: {
  label: string;
  ms: number;
  blink?: boolean;
}) {
  return (
    <div className="vot-timer mt-3 flex items-center justify-between px-3 py-2">
      <span className="text-[0.55rem]" style={PIXEL}>
        {label}
      </span>
      <span
        className={cn(
          "text-lg tabular-nums text-[#ffd34d]",
          blink && "animate-run-it-blink",
        )}
        style={PIXEL}
      >
        {formatLeft(Math.max(0, ms))}
      </span>
    </div>
  );
}
