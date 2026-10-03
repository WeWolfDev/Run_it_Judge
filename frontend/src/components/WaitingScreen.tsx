import { useEffect } from "react";
import { Sprite } from "@/components/Sprite";
import { characterAt } from "@/lib/characters";
import { play } from "@/lib/sfx";

// pantalla de espera estilo CRT (la del flyer). Antes de que el
// organizador inicie la ronda muestra "RUN IT"; al iniciar, el título se va y
// aparece la cuenta regresiva de 10 segundos.
export function WaitingScreen({
  roundNumber,
  tournamentName,
  character,
  countdownMs,
  note,
}: {
  roundNumber: number | null;
  tournamentName?: string | undefined;
  character: number;
  /** null mientras se espera al organizador. */
  countdownMs: number | null;
  note?: string | undefined;
}) {
  const seconds = countdownMs === null ? null : Math.max(0, Math.ceil(countdownMs / 1000));
  const name = characterAt(character).name;

  // Un tic por segundo de la cuenta, y otro sonido al llegar a cero.
  useEffect(() => {
    if (seconds === null) return;
    play(seconds > 0 ? "tick" : "win");
  }, [seconds]);

  return (
    <section
      role={seconds === null ? "status" : "timer"}
      aria-live={seconds === null ? "polite" : "assertive"}
      className="rounded-[28px] border-8 border-[color-mix(in_oklch,var(--primary)_35%,var(--background))] bg-[color-mix(in_oklch,var(--background),black_20%)] p-4 shadow-2xl sm:p-6"
    >
      <div
        className="relative flex min-h-[26rem] flex-col items-center justify-center gap-3 overflow-hidden rounded-[22px] px-4 py-10 text-center text-[oklch(0.28_0.15_262)]"
        style={{
          background:
            "radial-gradient(ellipse at center, oklch(0.93 0.06 215) 0%, oklch(0.84 0.1 222) 55%, oklch(0.72 0.11 235) 100%)",
          boxShadow: "inset 0 0 60px rgb(0 0 0 / 0.45)",
        }}
      >
        {/* Líneas de barrido, brillo que recorre la pantalla y parpadeo. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "repeating-linear-gradient(0deg, rgb(0 0 0 / 0.12) 0 2px, transparent 2px 4px)",
          }}
        />
        <div aria-hidden="true" className="run-it-crt-sweep" />
        <p className="relative text-sm font-bold uppercase tracking-[0.3em]">
          {tournamentName ? `${tournamentName} · ` : ""}
          {roundNumber ? `Ronda ${roundNumber}` : "Próxima ronda"}
        </p>
        {seconds === null ? (
          <p
            className="animate-run-it-flicker relative text-7xl font-black italic leading-[0.9] tracking-tight sm:text-8xl"
            style={{ fontFamily: "'Press Start 2P', ui-monospace, monospace" }}
          >
            RUN
            <br />
            IT
          </p>
        ) : (
          <p
            key={seconds}
            className="animate-run-it-zoom relative text-8xl font-black tabular-nums sm:text-9xl"
            style={{ fontFamily: "'Press Start 2P', ui-monospace, monospace" }}
          >
            {seconds > 0 ? seconds : "¡YA!"}
          </p>
        )}
        <p className="relative text-base font-semibold">
          {seconds === null ? (
            <>
              {note || "Esperando que el organizador inicie la ronda"}
              {!note && <span className="animate-run-it-blink">…</span>}
            </>
          ) : (
            "¡Prepárate! El editor se abre al llegar a cero."
          )}
        </p>
        <div className="relative mt-2 flex flex-col items-center gap-1">
          <Sprite index={character} state={seconds === null ? "idle" : "run"} scale={0.75} />
          <span className="text-xs font-semibold">{name} en la línea de salida</span>
        </div>
      </div>
    </section>
  );
}

export default WaitingScreen;
