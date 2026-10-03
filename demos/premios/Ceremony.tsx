import { useEffect, useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import { confetti } from "@/lib/confetti";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import type { Award } from "./awards";

// DEMO: ceremonia del final del torneo, en la pantalla CRT. La ven la pista
// (proyector) y los participantes; el admin la avanza paso a paso.
//   winner -> intro -> premio 1 … premio N (el último es el GMA) -> end

export type Phase =
  | { kind: "winner" }
  | { kind: "intro" }
  | { kind: "award"; index: number }
  | { kind: "end" };

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

export function Ceremony({
  phase,
  awards,
  compact = false,
}: {
  phase: Phase;
  awards: Award[];
  /** Versión chica para la vista del participante. */
  compact?: boolean;
}) {
  const champion = awards[awards.length - 1]?.winner;
  return (
    <div className={cn("cer-crt relative overflow-hidden", compact ? "cer-compact" : "h-full")}>
      <div className="cer-scan pointer-events-none absolute inset-0" />
      <div className="run-it-crt-sweep" />
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-[2.2vmin] px-[4vmin] py-[3vmin] text-center">
        {phase.kind === "winner" && champion && <Winner name={champion.display_name} character={champion.character} compact={compact} />}
        {phase.kind === "intro" && <Intro compact={compact} />}
        {phase.kind === "award" && awards[phase.index] && (
          <AwardReveal key={phase.index} award={awards[phase.index]!} index={phase.index} total={awards.length} compact={compact} />
        )}
        {phase.kind === "end" && champion && <End name={champion.display_name} character={champion.character} compact={compact} />}
      </div>
    </div>
  );
}

function useBurst(deps: unknown[]) {
  useEffect(() => {
    confetti({ x: 0.5, y: 0.35 });
    play("win");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function Winner({ name, character, compact }: { name: string; character: number; compact: boolean }) {
  useBurst([name]);
  return (
    <>
      <PixelIcon name="trophy" className="animate-run-it-pop h-[9vmin] w-[9vmin] text-[var(--gold)]" />
      <div className="animate-run-it-rise">
        <Sprite index={character} state="run" scale={compact ? 1.6 : 2.6} />
      </div>
      <p className="cer-title animate-run-it-zoom text-[clamp(1.4rem,6vmin,5.5rem)] leading-tight text-[var(--gold)]" style={PIXEL}>
        ¡{name} es el ganador!!
      </p>
      <p className="animate-run-it-blink text-[clamp(0.7rem,2vmin,1.6rem)] text-[var(--cer-ink)]" style={PIXEL}>
        Campeón del torneo
      </p>
    </>
  );
}

function Intro({ compact }: { compact: boolean }) {
  return (
    <>
      <p className="animate-run-it-rise text-[clamp(0.8rem,2.6vmin,2rem)] text-[var(--cer-ink)]" style={PIXEL}>
        A continuación…
      </p>
      <p className="cer-title animate-run-it-zoom text-[clamp(1.3rem,5.4vmin,4.6rem)] leading-tight text-primary" style={PIXEL}>
        Los premios honoríficos
      </p>
      <div className="flex gap-[2vmin]">
        {(["trophy", "star", "zap"] as const).map((icon, i) => (
          <span key={icon} className="animate-run-it-blink" style={{ animationDelay: `${i * 0.25}s` }}>
            <PixelIcon name={icon} className="h-[6vmin] w-[6vmin] text-accent" />
          </span>
        ))}
      </div>
      {!compact && (
        <p className="text-[clamp(0.7rem,1.8vmin,1.4rem)] text-[var(--cer-ink)] opacity-80">
          Esperando al organizador…
        </p>
      )}
    </>
  );
}

// Primero el premio y qué reconoce, con redoble; después se revela quién lo gana.
function AwardReveal({ award, index, total, compact }: { award: Award; index: number; total: number; compact: boolean }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed(false);
    const ticks = [0, 400, 800, 1200, 1600, 2000].map((ms) => setTimeout(() => play("tick"), ms));
    const reveal = setTimeout(() => {
      setRevealed(true);
      confetti({ x: 0.5, y: 0.4 });
      play(index === total - 1 ? "win" : "coin");
    }, 2400);
    return () => {
      ticks.forEach(clearTimeout);
      clearTimeout(reveal);
    };
  }, [award.id, index, total]);
  const grand = award.id === "gma";
  return (
    <>
      <p className="text-[clamp(0.6rem,1.6vmin,1.2rem)] uppercase tracking-[0.3em] text-[var(--cer-ink)] opacity-80">
        Premio {index + 1} de {total}
      </p>
      <p
        className={cn("cer-title text-[clamp(1.2rem,4.8vmin,4.2rem)] leading-tight", grand ? "text-[var(--gold)]" : "text-primary")}
        style={PIXEL}
      >
        {award.title}
      </p>
      <p className="max-w-[70ch] text-[clamp(0.85rem,2.2vmin,1.8rem)] text-[var(--cer-ink)]">{award.description}</p>
      {revealed ? (
        <div key="who" className="animate-run-it-zoom flex flex-col items-center gap-[1.2vmin]">
          <Sprite index={award.winner.character} state="run" scale={compact ? 1.5 : 2.4} />
          <p className="text-[clamp(1.1rem,4.4vmin,3.8rem)] text-[var(--gold)]" style={PIXEL}>
            {award.winner.display_name}
          </p>
          <p className="cer-detail px-[1.5vmin] py-[0.8vmin] text-[clamp(0.8rem,2vmin,1.6rem)]">{award.detail}</p>
        </div>
      ) : (
        <p key="drum" className="animate-run-it-blink text-[clamp(0.8rem,2.4vmin,1.9rem)] text-accent" style={PIXEL}>
          Y el premio es para…
        </p>
      )}
    </>
  );
}

function End({ name, character, compact }: { name: string; character: number; compact: boolean }) {
  return (
    <>
      <Sprite index={character} state="idle" scale={compact ? 1.4 : 2} />
      <p className="cer-title text-[clamp(1.2rem,4.6vmin,4rem)] leading-tight text-primary" style={PIXEL}>
        ¡Gracias por correr!
      </p>
      <p className="text-[clamp(0.8rem,2.2vmin,1.8rem)] text-[var(--cer-ink)]">
        Campeón: <b className="text-[var(--gold)]">{name}</b> · Nos vemos en el próximo Run It
      </p>
    </>
  );
}
