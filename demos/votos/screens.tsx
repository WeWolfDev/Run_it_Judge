import { useEffect, useState } from "react";

import { formatClock } from "@/lib/runit";
import { cn } from "@/lib/utils";
import type { Entry, SimRound } from "../proyeccion/sim";
import type { Game, Poll } from "./game";
import { HITS, MAX_POLLS, PAIRS, PIXEL, formatLeft, type Hit } from "./hits";
import { QR_PATH, QR_SIZE } from "./qr";

// DEMO: las pantallas del voto del público. La grada vota desde el celular
// (QR en la proyección); el admin abre la votación; el hit ganador cae sobre
// la ronda: pista proyectada y vista del participante.

export function useTick(ms = 250) {
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
}

const pct = (poll: Poll, side: "good" | "bad") => {
  const total = poll.votes.good + poll.votes.bad;
  return total ? Math.round((poll.votes[side] / total) * 100) : 50;
};

export function Qr({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} shapeRendering="crispEdges" aria-label="QR para votar">
      <path fill="#fff" d={`M0 0h${QR_SIZE}v${QR_SIZE}H0z`} />
      <path stroke="#000" d={QR_PATH} />
    </svg>
  );
}

// ---------------------------------------------------------------- proyección

/** Recuadro de la grada sobre la pista: QR y recuento, o el hit que cayó. */
export function GradaCard({ game }: { game: Game }) {
  useTick();
  const poll = game.poll();
  const recent = poll?.winner && Date.now() - poll.closesAt < 7000;
  const active = game.active();
  if (poll && game.announcing()) {
    const pair = PAIRS[poll.pair]!;
    return (
      <div className="vot-card vot-soon fixed bottom-[1.2vw] right-[1.2vw] z-[55] w-[min(23vw,26rem)] min-w-[15rem] p-[1vw]">
        <p className="animate-run-it-blink text-[clamp(0.6rem,0.9vw,1.2rem)] text-accent" style={PIXEL}>
          Votación próxima
        </p>
        <div className="mt-[0.6vw] flex items-center gap-[0.8vw]">
          <Qr size={110} />
          <div className="min-w-0 text-[clamp(0.65rem,0.8vw,1.05rem)]">
            <p>Saca tu celular y escanea: se abre en</p>
            <p className="mt-[0.4vw] text-[clamp(1.2rem,2.2vw,3rem)] tabular-nums text-accent" style={PIXEL}>
              {formatLeft(poll.opensAt - Date.now())}
            </p>
          </div>
        </div>
        <p className="mt-[0.7vw] text-[clamp(0.65rem,0.8vw,1.05rem)]">
          <b className="text-[#ffd34d]">{HITS[pair.good].name}</b> <span className="text-muted-foreground">contra</span>{" "}
          <b className="text-[#f08a4b]">{HITS[pair.bad].name}</b>
        </p>
      </div>
    );
  }
  if (poll && !poll.winner) {
    const pair = PAIRS[poll.pair]!;
    return (
      <div className="vot-card fixed bottom-[1.2vw] right-[1.2vw] z-[55] w-[min(23vw,26rem)] min-w-[15rem] p-[1vw]">
        <p className="text-[clamp(0.6rem,0.9vw,1.2rem)] text-accent" style={PIXEL}>
          ¡Vota el hit!
        </p>
        <div className="mt-[0.6vw] flex items-center gap-[0.8vw]">
          <Qr size={110} />
          <div className="min-w-0 text-[clamp(0.65rem,0.8vw,1.05rem)]">
            <p>Escanea con tu celular y elige.</p>
            <p className="mt-[0.4vw] text-[clamp(1.2rem,2.2vw,3rem)] tabular-nums text-accent" style={PIXEL}>
              {formatLeft(poll.closesAt - Date.now())}
            </p>
            <p className="text-muted-foreground">{poll.votes.good + poll.votes.bad} votos</p>
          </div>
        </div>
        <Bars poll={poll} good={HITS[pair.good]} bad={HITS[pair.bad]} />
      </div>
    );
  }
  if (recent && poll?.winner) {
    const hit = HITS[poll.winner];
    return (
      <div className={cn("vot-card animate-run-it-pop fixed bottom-[1.2vw] right-[1.2vw] z-[55] w-[min(23vw,26rem)] min-w-[15rem] p-[1vw]", `vot-${hit.kind}`)}>
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
  if (!active.length) return null;
  return (
    <div className="vot-card fixed bottom-[1.2vw] right-[1.2vw] z-[55] w-[min(23vw,26rem)] min-w-[15rem] p-[0.8vw]">
      <p className="text-[clamp(0.5rem,0.7vw,0.95rem)] text-muted-foreground" style={PIXEL}>
        Hits activos
      </p>
      {active.map((h) => (
        <p key={h.id} className={cn("mt-[0.4vw] flex justify-between text-[clamp(0.7rem,0.9vw,1.2rem)]", HITS[h.id].kind === "malo" ? "text-danger" : "text-success")}>
          <b>{HITS[h.id].name}</b>
          <span className="tabular-nums">{formatLeft(game.left(h.id))}</span>
        </p>
      ))}
    </div>
  );
}

function Bars({ poll, good, bad }: { poll: Poll; good: Hit; bad: Hit }) {
  const g = pct(poll, "good");
  return (
    <div className="mt-[0.7vw] flex h-[2.4em] overflow-hidden rounded-md text-[clamp(0.6rem,0.75vw,1rem)] font-semibold">
      <span className="vot-bar-bad flex items-center justify-between px-2" style={{ width: `${100 - g}%` }}>
        <span className="truncate">{bad.name}</span>
        <span>{100 - g}%</span>
      </span>
      <span className="vot-bar-good flex items-center justify-between px-2" style={{ width: `${g}%` }}>
        <span className="truncate">{good.name}</span>
        <span>{g}%</span>
      </span>
    </div>
  );
}

/** Apagón: la pantalla del público se queda a oscuras. */
export function Blackout({ game }: { game: Game }) {
  useTick();
  if (!game.isOn("apagon")) return null;
  return (
    <div className="vot-blackout fixed inset-0 z-[52] grid place-items-center">
      <div className="text-center">
        <p className="animate-run-it-flicker text-[clamp(1.4rem,4vw,5rem)] text-danger" style={PIXEL}>
          Apagón
        </p>
        <p className="mt-[2vh] text-[clamp(0.8rem,1.4vw,1.8rem)] text-muted-foreground">
          La grada cortó la luz · vuelve en {formatLeft(game.left("apagon"))}
        </p>
        <p className="mt-[1vh] text-[clamp(0.7rem,1vw,1.3rem)] text-muted-foreground">
          Los participantes siguen programando con normalidad.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- celular

export function Phone({ game, round }: { game: Game; round: SimRound }) {
  useTick();
  const poll = game.poll();
  const open = poll && !poll.winner;
  return (
    <div className="grid min-h-dvh place-items-center bg-[#0b0814] p-4">
      <div className="vot-phone flex w-[min(390px,100%)] flex-col p-5">
        <div className="flex items-center justify-between">
          <span className="text-lg text-primary" style={PIXEL}>
            Run It
          </span>
          <span className="rounded border-2 border-border px-2 py-1 text-xs" style={PIXEL}>
            Ronda {round.number}
          </span>
        </div>
        {open && poll && game.announcing() ? (
          <PhoneSoon poll={poll} />
        ) : open && poll ? (
          <PhoneVote game={game} poll={poll} />
        ) : poll?.winner ? (
          <PhoneResult game={game} poll={poll} />
        ) : (
          <div className="flex flex-1 flex-col justify-center py-16 text-center">
            <p className="text-sm text-accent" style={PIXEL}>
              Espera la votación
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Cuando el organizador abra la votación, acá vas a poder elegir el hit.
            </p>
          </div>
        )}
        <p className="mt-6 text-xs text-muted-foreground">
          Un voto por persona y por votación. El hit cae por regla, no por nombre.
        </p>
      </div>
    </div>
  );
}

// Anuncio en el celular: las dos opciones a la vista, todavía sin poder votar.
function PhoneSoon({ poll }: { poll: Poll }) {
  const pair = PAIRS[poll.pair]!;
  return (
    <>
      <p className="mt-6 text-xl leading-tight" style={PIXEL}>
        Votación próxima
      </p>
      <p className="mt-2 text-sm text-muted-foreground">Mira las opciones: en unos segundos podrás votar.</p>
      <div className="vot-timer mt-4 flex items-center justify-between px-4 py-3">
        <span className="text-xs" style={PIXEL}>
          Abre en
        </span>
        <span className="animate-run-it-blink text-2xl tabular-nums text-[#ffd34d]" style={PIXEL}>
          {formatLeft(poll.opensAt - Date.now())}
        </span>
      </div>
      <div className="mt-4 space-y-3 opacity-70">
        {[HITS[pair.bad], HITS[pair.good]].map((hit) => (
          <div key={hit.id} className={cn("vot-option p-4", `vot-option-${hit.kind}`)}>
            <span className="text-[0.6rem] uppercase opacity-80" style={PIXEL}>
              Hit {hit.kind}
            </span>
            <span className="mt-2 block text-lg leading-tight" style={PIXEL}>
              {hit.name}
            </span>
            <span className="mt-2 block text-sm">{hit.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function PhoneVote({ game, poll }: { game: Game; poll: Poll }) {
  const pair = PAIRS[poll.pair]!;
  const options = [
    { side: "bad" as const, hit: HITS[pair.bad] },
    { side: "good" as const, hit: HITS[pair.good] },
  ];
  return (
    <>
      <p className="mt-6 text-xl leading-tight" style={PIXEL}>
        Elige el hit
      </p>
      <p className="mt-2 text-sm text-muted-foreground">La opción más votada cae sobre la ronda en vivo.</p>
      <div className="vot-timer mt-4 flex items-center justify-between px-4 py-3">
        <span className="text-xs" style={PIXEL}>
          Cierra en
        </span>
        <span className="text-2xl tabular-nums text-[#ffd34d]" style={PIXEL}>
          {formatLeft(poll.closesAt - Date.now())}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {options.map(({ side, hit }) => (
          <button
            key={side}
            type="button"
            disabled={Boolean(poll.mine)}
            onClick={() => game.vote(side)}
            className={cn(
              "vot-option block w-full p-4 text-left",
              `vot-option-${hit.kind}`,
              poll.mine === side && "vot-option-picked",
              poll.mine && poll.mine !== side && "opacity-50",
            )}
          >
            <span className="text-[0.6rem] uppercase opacity-80" style={PIXEL}>
              Hit {hit.kind}
            </span>
            <span className="mt-2 block text-lg leading-tight" style={PIXEL}>
              {hit.name}
            </span>
            <span className="mt-2 block text-sm">{hit.text}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        {poll.mine ? "¡Listo! Tu voto ya cuenta." : "Toca una opción para votar."}
      </p>
      <p className="mt-6 text-[0.65rem] uppercase text-muted-foreground" style={PIXEL}>
        Así va la grada
      </p>
      <Bars poll={poll} good={HITS[pair.good]} bad={HITS[pair.bad]} />
    </>
  );
}

function PhoneResult({ game, poll }: { game: Game; poll: Poll }) {
  const hit = HITS[poll.winner!];
  const pair = PAIRS[poll.pair]!;
  return (
    <>
      <p className="mt-6 text-sm text-muted-foreground">La grada eligió</p>
      <div className={cn("vot-option mt-3 p-4", `vot-option-${hit.kind}`)}>
        <span className="text-[0.6rem] uppercase opacity-80" style={PIXEL}>
          Hit {hit.kind}
        </span>
        <span className="mt-2 block text-lg leading-tight" style={PIXEL}>
          {hit.name}
        </span>
        <span className="mt-2 block text-sm">{hit.text}</span>
        {game.isOn(hit.id) && (
          <span className="mt-2 block text-sm tabular-nums" style={PIXEL}>
            Activo · {formatLeft(game.left(hit.id))}
          </span>
        )}
      </div>
      <p className="mt-4 text-sm">
        {!poll.mine
          ? "No votaste en esta votación."
          : (poll.mine === "good" ? pair.good : pair.bad) === hit.id
            ? "Votaste por este hit."
            : "Esta vez ganó la otra opción."}
      </p>
      <Bars poll={poll} good={HITS[pair.good]} bad={HITS[pair.bad]} />
    </>
  );
}

// ---------------------------------------------------------------- participante

/** Vista del participante, resumida: los hits cambian el ranking, el reloj y los avisos, nunca el editor. */
export function Participant({ game, round, board, me }: { game: Game; round: SimRound; board: Entry[]; me: string }) {
  useTick();
  const rank = board.findIndex((e) => e.participant_id === me) + 1;
  const entry = board[rank - 1];
  const fog = game.isOn("niebla");
  const clockHidden = game.isOn("reloj-oculto");
  const left = round.endsAt - Date.now();
  const toast = game.toast();
  const showToast = toast && Date.now() - toast.at < 6000;
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex items-center gap-4 border-b border-border bg-card px-5 py-3">
        <span className="text-primary" style={PIXEL}>
          Run&nbsp;It
        </span>
        <span className="text-sm text-muted-foreground">Ronda {round.number} · Suma de dos números</span>
        <span className={cn("ml-auto text-2xl tabular-nums", clockHidden ? "text-muted-foreground" : "text-foreground")} style={PIXEL}>
          {round.closed ? "00:00" : clockHidden ? "??:??" : formatClock(left)}
        </span>
      </header>
      {showToast && (
        <div key={toast.id} className="vot-toast animate-run-it-pop mx-auto mt-3 w-fit px-4 py-2 text-sm" style={PIXEL}>
          {toast.text}
        </div>
      )}
      <div className="mx-auto grid max-w-6xl gap-4 p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Enunciado</h2>
            <p className="mt-2 text-sm text-muted-foreground">Lee dos enteros A y B e imprime A + B.</p>
            {game.hint() && (
              <p className="vot-hint mt-3 rounded-md p-3 text-sm">
                <b>Pista del organizador:</b> ojo con los números negativos y con valores muy grandes: usa enteros de 64 bits.
              </p>
            )}
          </section>
          <section className="relative overflow-hidden rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Tu carrera</h2>
            {fog && (
              <div className="proj-fog absolute inset-0 z-10 grid place-items-center">
                <p className="text-center text-xs" style={PIXEL}>
                  Niebla · el ranking vuelve en {formatLeft(game.left("niebla"))}
                </p>
              </div>
            )}
            <p className="mt-2 text-2xl" style={PIXEL}>
              {rank}.º <span className="text-sm text-muted-foreground">de {board.length}</span>
            </p>
            <p className="mt-1 text-sm">
              {rank <= round.capacity ? <span className="text-success">Dentro del cupo ({round.capacity})</span> : <span className="text-danger">A {rank - round.capacity} del corte ({round.capacity})</span>}
            </p>
            {entry && (
              <p className="mt-1 text-sm text-muted-foreground">
                {Math.round(Number(entry.best_pass_percentage) * 0.3)}/30 tests · {entry.failed_attempts_count} fallos · +{entry.penalty_seconds} s
              </p>
            )}
          </section>
          {(game.isOn("amnistia") || game.isOn("penal-doble")) && (
            <section className={cn("rounded-xl border-2 p-3 text-sm", game.isOn("amnistia") ? "border-success" : "border-danger")}>
              {game.isOn("amnistia") ? (
                <>
                  <b className="text-success">Amnistía</b>: tus envíos fallidos no suman penalización · {formatLeft(game.left("amnistia"))}
                </>
              ) : (
                <>
                  <b className="text-danger">Penalización doble</b>: cada envío fallido suma +60 s · {formatLeft(game.left("penal-doble"))}
                </>
              )}
            </section>
          )}
        </div>
        <section className="rounded-xl border border-border bg-[#0f0d18] p-4 font-mono text-sm">
          <p className="mb-3 text-xs text-muted-foreground">Editor · los hits nunca lo tocan</p>
          <pre className="text-[#cfe3ff]">{`a, b = map(int, input().split())
print(a + b)`}</pre>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- admin

export function Admin({ game, round }: { game: Game; round: SimRound }) {
  useTick(500);
  const [pair, setPair] = useState(0);
  const poll = game.poll();
  const polls = game.polls();
  const reason = game.blockReason(pair);
  return (
    <div className="min-h-dvh bg-background p-6 text-foreground">
      <section className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">Voto del público · Ronda {round.number}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Votaciones en esta ronda: <b className="text-foreground">{polls.length} de {MAX_POLLS}</b> (se recomienda 1). Sin
          votaciones en el primer minuto ni en los últimos 2.
        </p>
        <div className="mt-4 space-y-2">
          {PAIRS.map((p, i) => (
            <label key={i} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3", pair === i ? "border-primary" : "border-border")}>
              <input type="radio" checked={pair === i} onChange={() => setPair(i)} />
              <span className="w-16 text-xs text-muted-foreground">Peso {p.weight}</span>
              <span className="flex-1 text-sm">
                <b className="text-success">{HITS[p.good].name}</b> <span className="text-muted-foreground">contra</span>{" "}
                <b className="text-danger">{HITS[p.bad].name}</b>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={Boolean(reason)}
            onClick={() => game.open(pair)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Anunciar votación (15 s + 40 s)
          </button>
          {poll && game.announcing() && (
            <button type="button" onClick={() => game.abort()} className="rounded-lg border border-border px-4 py-2 text-sm">
              Cancelar anuncio (abre en {formatLeft(poll.opensAt - Date.now())})
            </button>
          )}
          {poll && !poll.winner && !game.announcing() && (
            <button type="button" onClick={() => game.close()} className="rounded-lg border border-border px-4 py-2 text-sm">
              Cerrar ya ({formatLeft(poll.closesAt - Date.now())})
            </button>
          )}
          {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
        </div>

        {game.active().length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-semibold">Hits activos</p>
            {game.active().map((h) => (
              <p key={h.id} className="mt-2 flex items-center gap-3 text-sm">
                <b className={HITS[h.id].kind === "malo" ? "text-danger" : "text-success"}>{HITS[h.id].name}</b>
                <span className="text-muted-foreground">{HITS[h.id].scope}</span>
                <span className="ml-auto tabular-nums">{formatLeft(game.left(h.id))}</span>
                <button type="button" onClick={() => game.cancel(h.id)} className="rounded border border-border px-2 py-0.5 text-xs">
                  Cancelar
                </button>
              </p>
            ))}
          </div>
        )}
        {polls.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-semibold">Historial</p>
            {polls.map((p, i) => (
              <p key={i} className="mt-1 text-sm text-muted-foreground">
                Votación {i + 1}: {HITS[PAIRS[p.pair]!.good].name} {pct(p, "good")}% · {HITS[PAIRS[p.pair]!.bad].name} {pct(p, "bad")}% ·{" "}
                {p.winner ? <b className="text-foreground">ganó {HITS[p.winner].name}</b> : Date.now() < p.opensAt ? "anunciada" : "abierta"} ({p.votes.good + p.votes.bad} votos)
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
