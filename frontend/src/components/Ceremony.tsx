import { useEffect, useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import { useServerClockOffset } from "@/hooks/use-round-timer";
import type { Ceremony as CeremonyData, CeremonyAward } from "@/lib/api";
import { confetti } from "@/lib/confetti";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
/** Redoble antes de revelar al ganador de cada premio. */
const DRUMROLL_MS = 2400;

/**
 * Ceremonia del final del torneo en la pantalla CRT. La ven la pista
 * (proyector) y los participantes; el admin la avanza desde el panel.
 * Pasos (`step`): null ganador, 0 presentación, 1..N premios, N + 1 fin.
 */
export function Ceremony({
  ceremony,
  compact = false,
}: {
  ceremony: CeremonyData;
  /** Versión chica para la pantalla del participante. */
  compact?: boolean;
}) {
  const { step, awards, champion } = ceremony;
  const award = step !== null && step >= 1 && step <= awards.length ? awards[step - 1] : null;
  return (
    <div className={cn("cer-crt relative overflow-hidden", compact ? "cer-compact" : "h-full")}>
      <div className="cer-scan pointer-events-none absolute inset-0" />
      <div className="run-it-crt-sweep" />
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-[2.2vmin] px-[4vmin] py-[3vmin] text-center">
        {step === null && champion && (
          <Winner name={champion.display_name} character={champion.character} compact={compact} />
        )}
        {step === null && !champion && <Finished name={ceremony.tournament.name} />}
        {step === 0 && <Intro compact={compact} />}
        {award && step !== null && (
          <AwardReveal
            key={award.id}
            award={award}
            index={step - 1}
            total={awards.length}
            updatedAt={ceremony.updated_at}
            compact={compact}
          />
        )}
        {step !== null && step > awards.length && <End champion={champion} compact={compact} />}
      </div>
    </div>
  );
}

function Winner({
  name,
  character,
  compact,
}: {
  name: string;
  character: number;
  compact: boolean;
}) {
  useEffect(() => {
    confetti({ x: 0.5, y: 0.35 });
    play("win");
  }, [name]);
  return (
    <>
      <PixelIcon
        name="trophy"
        className="animate-run-it-pop h-[9vmin] w-[9vmin] text-[var(--gold)]"
      />
      <div className="animate-run-it-rise">
        <Sprite index={character} state="run" scale={compact ? 1.6 : 2.6} />
      </div>
      <p
        className="cer-title animate-run-it-zoom text-[clamp(1.4rem,6vmin,5.5rem)] leading-tight text-[var(--gold)]"
        style={PIXEL}
      >
        ¡{name} es el ganador!!
      </p>
      <p
        className="animate-run-it-blink text-[clamp(0.7rem,2vmin,1.6rem)] text-[var(--cer-ink)]"
        style={PIXEL}
      >
        Campeón del torneo
      </p>
    </>
  );
}

// Torneo cerrado a mano, sin un único ganador.
function Finished({ name }: { name: string }) {
  return (
    <p
      className="cer-title text-[clamp(1.2rem,4.6vmin,4rem)] leading-tight text-primary"
      style={PIXEL}
    >
      {name} terminó
    </p>
  );
}

function Intro({ compact }: { compact: boolean }) {
  return (
    <>
      <p
        className="animate-run-it-rise text-[clamp(0.8rem,2.6vmin,2rem)] text-[var(--cer-ink)]"
        style={PIXEL}
      >
        A continuación…
      </p>
      <p
        className="cer-title animate-run-it-zoom text-[clamp(1.3rem,5.4vmin,4.6rem)] leading-tight text-primary"
        style={PIXEL}
      >
        Los premios honoríficos
      </p>
      <div className="flex gap-[2vmin]">
        {(["trophy", "star", "zap"] as const).map((icon, i) => (
          <span
            key={icon}
            className="animate-run-it-blink"
            style={{ animationDelay: `${i * 0.25}s` }}
          >
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

// Primero el premio y qué reconoce, con redoble; después quién lo gana. El
// momento de revelar sale de cuándo avanzó el admin (hora del servidor): quien
// entra tarde lo ve ya revelado, sin repetir el redoble.
function AwardReveal({
  award,
  index,
  total,
  updatedAt,
  compact,
}: {
  award: CeremonyAward;
  index: number;
  total: number;
  updatedAt: string | null;
  compact: boolean;
}) {
  const offsetMs = useServerClockOffset();
  const revealAt = (updatedAt ? Date.parse(updatedAt) : 0) + DRUMROLL_MS;
  const [revealed, setRevealed] = useState(() => Date.now() + offsetMs >= revealAt);

  useEffect(() => {
    const wait = revealAt - (Date.now() + offsetMs);
    if (wait <= 0) {
      setRevealed(true);
      return;
    }
    setRevealed(false);
    const ticks = Array.from({ length: Math.floor(wait / 400) }, (_, i) =>
      setTimeout(() => play("tick"), i * 400),
    );
    const reveal = setTimeout(() => {
      setRevealed(true);
      confetti({ x: 0.5, y: 0.4 });
      play(index === total - 1 ? "win" : "coin");
    }, wait);
    return () => {
      ticks.forEach(clearTimeout);
      clearTimeout(reveal);
    };
  }, [revealAt, offsetMs, index, total]);

  const grand = award.id === "gma";
  const winner = revealed ? award.winner : undefined;
  return (
    <>
      <p className="text-[clamp(0.6rem,1.6vmin,1.2rem)] uppercase tracking-[0.3em] text-[var(--cer-ink)] opacity-80">
        Premio {index + 1} de {total}
      </p>
      <p
        className={cn(
          "cer-title text-[clamp(1.2rem,4.8vmin,4.2rem)] leading-tight",
          grand ? "text-[var(--gold)]" : "text-primary",
        )}
        style={PIXEL}
      >
        {award.title}
      </p>
      <p className="max-w-[70ch] text-[clamp(0.85rem,2.2vmin,1.8rem)] text-[var(--cer-ink)]">
        {award.description}
      </p>
      {winner ? (
        <div key="who" className="animate-run-it-zoom flex flex-col items-center gap-[1.2vmin]">
          <Sprite index={winner.character} state="run" scale={compact ? 1.5 : 2.4} />
          <p className="text-[clamp(1.1rem,4.4vmin,3.8rem)] text-[var(--gold)]" style={PIXEL}>
            {winner.display_name}
          </p>
          {award.detail && (
            <p className="cer-detail px-[1.5vmin] py-[0.8vmin] text-[clamp(0.8rem,2vmin,1.6rem)]">
              {award.detail}
            </p>
          )}
        </div>
      ) : (
        <p
          key="drum"
          className="animate-run-it-blink text-[clamp(0.8rem,2.4vmin,1.9rem)] text-accent"
          style={PIXEL}
        >
          Y el premio es para…
        </p>
      )}
    </>
  );
}

function End({ champion, compact }: { champion: CeremonyData["champion"]; compact: boolean }) {
  return (
    <>
      {champion && <Sprite index={champion.character} state="idle" scale={compact ? 1.4 : 2} />}
      <p
        className="cer-title text-[clamp(1.2rem,4.6vmin,4rem)] leading-tight text-primary"
        style={PIXEL}
      >
        ¡Gracias por correr!
      </p>
      {champion && (
        <p className="text-[clamp(0.8rem,2.2vmin,1.8rem)] text-[var(--cer-ink)]">
          Campeón: <b className="text-[var(--gold)]">{champion.display_name}</b> · Nos vemos en el
          próximo Run It
        </p>
      )}
    </>
  );
}

export default Ceremony;
