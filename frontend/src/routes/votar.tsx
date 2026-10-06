import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { TallyBars } from "@/components/hits/Grada";
import { formatLeft, hitInfo, useHits, voteHit, type HitPoll } from "@/lib/hits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/votar")({
  component: VotePage,
  head: () => ({
    meta: [
      { title: "Vota el hit | Run It" },
      { name: "description", content: "Elige el hit que cae sobre la ronda en vivo de Run It." },
    ],
  }),
});

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

// Lo que abre el QR de la pantalla del público. Sin cuenta: un token anónimo
// del navegador deja un voto por persona y por votación.
function VotePage() {
  const hits = useHits();
  const { poll, phase } = hits;
  return (
    <main className="flex min-h-dvh justify-center bg-[#0b0814] px-4 py-6 text-[#f4ecff]">
      <div className="flex w-full max-w-[420px] flex-col">
        <div className="flex items-center justify-between">
          <span className="text-lg text-primary" style={PIXEL}>
            Run It
          </span>
          {hits.state && (
            <span className="rounded border-2 border-[#3a2f55] px-2 py-1 text-xs" style={PIXEL}>
              En vivo
            </span>
          )}
        </div>
        {poll && phase === "announced" ? (
          <Soon poll={poll} opensIn={hits.opensIn} />
        ) : poll && phase === "open" ? (
          <Vote poll={poll} closesIn={hits.closesIn} onVoted={hits.setMine} />
        ) : poll?.winner && phase === "result" ? (
          <Result poll={poll} active={hits.isOn(poll.winner)} left={hits.left(poll.winner)} />
        ) : (
          <div className="flex flex-1 flex-col justify-center py-16 text-center">
            <p className="text-sm text-accent" style={PIXEL}>
              {hits.state ? "Espera la votación" : "No hay ronda en curso"}
            </p>
            <p className="mt-4 text-sm text-[#b9acd6]">
              Cuando el organizador anuncie una votación, acá vas a poder elegir el hit. Deja esta
              página abierta.
            </p>
          </div>
        )}
        <p className="mt-auto pt-8 text-xs text-[#b9acd6]">
          Un voto por persona y por votación. El hit cae sobre todos por igual: por regla, no por
          nombre. Los participantes no votan.
        </p>
      </div>
    </main>
  );
}

function Soon({ poll, opensIn }: { poll: HitPoll; opensIn: number }) {
  return (
    <>
      <p className="mt-6 text-xl leading-tight" style={PIXEL}>
        Votación próxima
      </p>
      <p className="mt-2 text-sm text-[#b9acd6]">
        Mira las opciones: en unos segundos podrás votar.
      </p>
      <Timer label="Abre en" ms={opensIn} blink />
      <div className="mt-4 space-y-3 opacity-70">
        {[poll.bad, poll.good].map((id) => (
          <Option key={id} id={id} />
        ))}
      </div>
    </>
  );
}

function Vote({
  poll,
  closesIn,
  onVoted,
}: {
  poll: HitPoll;
  closesIn: number;
  onVoted: (choice: "good" | "bad") => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const choose = (choice: "good" | "bad") => {
    if (poll.mine || sending) return;
    setSending(true);
    setError("");
    void voteHit(poll.id, choice)
      .then(() => onVoted(choice))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo votar"))
      .finally(() => setSending(false));
  };
  const options = [
    { side: "bad" as const, id: poll.bad },
    { side: "good" as const, id: poll.good },
  ];
  return (
    <>
      <p className="mt-6 text-xl leading-tight" style={PIXEL}>
        Elige el hit
      </p>
      <p className="mt-2 text-sm text-[#b9acd6]">
        La opción más votada cae sobre la ronda en vivo.
      </p>
      <Timer label="Cierra en" ms={closesIn} />
      <div className="mt-4 space-y-3">
        {options.map(({ side, id }) => (
          <button
            key={side}
            type="button"
            disabled={Boolean(poll.mine) || sending}
            onClick={() => choose(side)}
            className={cn(
              "block w-full text-left",
              poll.mine === side && "vot-option-picked",
              poll.mine && poll.mine !== side && "opacity-50",
            )}
          >
            <Option id={id} />
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-[#b9acd6]" role="status">
        {error || (poll.mine ? "¡Listo! Tu voto ya cuenta." : "Toca una opción para votar.")}
      </p>
      <p className="mt-6 text-[0.65rem] uppercase text-[#b9acd6]" style={PIXEL}>
        Así va la grada
      </p>
      <TallyBars poll={poll} good={hitInfo(poll.good)} bad={hitInfo(poll.bad)} />
    </>
  );
}

function Result({ poll, active, left }: { poll: HitPoll; active: boolean; left: number }) {
  const winner = poll.winner!;
  const mine = poll.mine ? (poll.mine === "good" ? poll.good : poll.bad) : null;
  return (
    <>
      <p className="mt-6 text-sm text-[#b9acd6]">La grada eligió</p>
      <div className="mt-3">
        <Option id={winner} />
      </div>
      {active && left > 0 && (
        <p className="mt-2 text-sm tabular-nums" style={PIXEL}>
          Activo · {formatLeft(left)}
        </p>
      )}
      <p className="mt-4 text-sm">
        {!mine
          ? "No votaste en esta votación."
          : mine === winner
            ? "Votaste por este hit."
            : "Esta vez ganó la otra opción."}
      </p>
      <TallyBars poll={poll} good={hitInfo(poll.good)} bad={hitInfo(poll.bad)} />
    </>
  );
}

function Option({ id }: { id: string }) {
  const hit = hitInfo(id);
  return (
    <span className={cn("vot-option block p-4", `vot-option-${hit.kind}`)}>
      <span className="text-[0.6rem] uppercase opacity-80" style={PIXEL}>
        Hit {hit.kind}
      </span>
      <span className="mt-2 block text-lg leading-tight" style={PIXEL}>
        {hit.name}
      </span>
      <span className="mt-2 block text-sm">{hit.text}</span>
    </span>
  );
}

function Timer({ label, ms, blink = false }: { label: string; ms: number; blink?: boolean }) {
  return (
    <div className="vot-timer mt-4 flex items-center justify-between px-4 py-3">
      <span className="text-xs" style={PIXEL}>
        {label}
      </span>
      <span
        className={cn("text-2xl tabular-nums text-[#ffd34d]", blink && "animate-run-it-blink")}
        style={PIXEL}
      >
        {formatLeft(ms)}
      </span>
    </div>
  );
}
