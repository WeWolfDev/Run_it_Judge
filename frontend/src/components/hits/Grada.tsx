import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import { confetti } from "@/lib/confetti";
import {
  formatLeft,
  hitInfo,
  percent,
  type HitInfo,
  type HitPoll,
  type LiveHits,
} from "@/lib/hits";
import { cn } from "@/lib/utils";

// Piezas del voto del público en las pantallas proyectadas (/pista, /publico):
// el QR para votar, el recuadro de la grada y el apagón.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

/** QR de /votar en este mismo sitio: sirve con cualquier dominio. */
export function VoteQr({ size }: { size: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    void QRCode.toString(`${window.location.origin}/votar`, { type: "svg", margin: 1 })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, []);
  return (
    <span
      role="img"
      aria-label="QR para votar"
      className="block shrink-0 bg-white [&_svg]:h-full [&_svg]:w-full"
      style={{ width: size, height: size }}
      // SVG generado acá por la biblioteca qrcode, no viene del servidor.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function TallyBars({ poll, good, bad }: { poll: HitPoll; good: HitInfo; bad: HitInfo }) {
  const g = percent(poll, "good");
  return (
    <div className="mt-3 flex h-[2.4em] overflow-hidden rounded-md text-[clamp(0.6rem,0.75vw,1rem)] font-semibold">
      <span
        className="vot-bar-bad flex min-w-0 items-center justify-between gap-1 px-2"
        style={{ width: `${100 - g}%` }}
      >
        <span className="truncate">{bad.name}</span>
        <span>{100 - g}%</span>
      </span>
      <span
        className="vot-bar-good flex min-w-0 items-center justify-between gap-1 px-2"
        style={{ width: `${g}%` }}
      >
        <span className="truncate">{good.name}</span>
        <span>{g}%</span>
      </span>
    </div>
  );
}

/** Recuadro de la grada sobre la pantalla del público: anuncio, votación, resultado o hits activos. */
export function GradaCard({ hits }: { hits: LiveHits }) {
  const { poll, phase } = hits;
  const box =
    "vot-card fixed bottom-[1.2vw] right-[1.2vw] z-[55] w-[min(23vw,26rem)] min-w-[15rem] p-[1vw]";
  if (poll && (phase === "announced" || phase === "open")) {
    const good = hitInfo(poll.good);
    const bad = hitInfo(poll.bad);
    const announced = phase === "announced";
    return (
      <div className={cn(box, announced && "vot-soon")}>
        <p
          className={cn(
            "text-[clamp(0.6rem,0.9vw,1.2rem)] text-accent",
            announced && "animate-run-it-blink",
          )}
          style={PIXEL}
        >
          {announced ? "Votación próxima" : "¡Vota el hit!"}
        </p>
        <div className="mt-[0.6vw] flex items-center gap-[0.8vw]">
          <VoteQr size={110} />
          <div className="min-w-0 text-[clamp(0.65rem,0.8vw,1.05rem)]">
            <p>
              {announced
                ? "Saca tu celular y escanea: se abre en"
                : "Escanea con tu celular y elige."}
            </p>
            <p
              className="mt-[0.4vw] text-[clamp(1.2rem,2.2vw,3rem)] tabular-nums text-accent"
              style={PIXEL}
            >
              {formatLeft(announced ? hits.opensIn : hits.closesIn)}
            </p>
            {!announced && (
              <p className="text-muted-foreground">{poll.tally.good + poll.tally.bad} votos</p>
            )}
          </div>
        </div>
        {announced ? (
          <p className="mt-[0.7vw] text-[clamp(0.65rem,0.8vw,1.05rem)]">
            <b className="text-[#ffd34d]">{good.name}</b>{" "}
            <span className="text-muted-foreground">contra</span>{" "}
            <b className="text-[#f08a4b]">{bad.name}</b>
          </p>
        ) : (
          <TallyBars poll={poll} good={good} bad={bad} />
        )}
      </div>
    );
  }
  if (poll?.winner && hits.justDecided) {
    const hit = hitInfo(poll.winner);
    return (
      <div className={cn(box, "animate-run-it-pop", `vot-${hit.kind}`)}>
        <p className="text-[clamp(0.55rem,0.75vw,1rem)] uppercase" style={PIXEL}>
          La grada eligió · hit {hit.kind}
        </p>
        <p className="mt-[0.5vw] text-[clamp(1rem,1.8vw,2.4rem)] leading-tight" style={PIXEL}>
          {hit.name}
        </p>
        <p className="mt-[0.4vw] text-[clamp(0.7rem,0.85vw,1.15rem)]">{hit.text}</p>
      </div>
    );
  }
  const timed = hits.active.filter((hit) => hit.ends_at);
  if (!timed.length) return null;
  return (
    <div className={cn(box, "p-[0.8vw]")}>
      <p className="text-[clamp(0.5rem,0.7vw,0.95rem)] text-muted-foreground" style={PIXEL}>
        Hits activos
      </p>
      {timed.map((hit) => (
        <p
          key={hit.id}
          className={cn(
            "mt-[0.4vw] flex justify-between text-[clamp(0.7rem,0.9vw,1.2rem)]",
            hitInfo(hit.hit).kind === "malo" ? "text-danger" : "text-success",
          )}
        >
          <b>{hitInfo(hit.hit).name}</b>
          <span className="tabular-nums">{formatLeft(hits.left(hit.hit))}</span>
        </p>
      ))}
    </div>
  );
}

/** Apagón: la pantalla del público se queda a oscuras. */
export function Blackout({ hits }: { hits: LiveHits }) {
  if (!hits.isOn("apagon")) return null;
  return (
    <div className="fixed inset-0 z-[52] grid place-items-center bg-black">
      <div className="text-center">
        <p
          className="animate-run-it-flicker text-[clamp(1.4rem,4vw,5rem)] text-danger"
          style={PIXEL}
        >
          Apagón
        </p>
        <p className="mt-[2vh] text-[clamp(0.8rem,1.4vw,1.8rem)] text-muted-foreground">
          La grada cortó la luz · vuelve en {formatLeft(hits.left("apagon"))}
        </p>
        <p className="mt-[1vh] text-[clamp(0.7rem,1vw,1.3rem)] text-muted-foreground">
          Los participantes siguen programando con normalidad.
        </p>
      </div>
    </div>
  );
}

/** Aliento de la grada en las pantallas del público: un cartel que dura lo que el hit. */
export function Cheer({ hits }: { hits: LiveHits }) {
  const on = hits.isOn("aliento");
  const was = useRef(false);
  useEffect(() => {
    if (on && !was.current) confetti({ x: 0.5, y: 0.3 });
    was.current = on;
  }, [on]);
  if (!on) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[12vh] z-[56] flex justify-center">
      <p
        className="vot-cheer animate-run-it-pop px-[2vw] py-[1vw] text-[clamp(1rem,2.4vw,3.2rem)]"
        style={PIXEL}
      >
        ¡La grada alienta a todos!
      </p>
    </div>
  );
}
