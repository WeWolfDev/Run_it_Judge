import { TallyBars, VoteQr } from "@/components/hits/Grada";
import { PixelIcon } from "@/components/PixelIcon";
import { formatLeft, hitInfo, type HitId, type LiveHits } from "@/lib/hits";
import { cn } from "@/lib/utils";

// Votación de la grada en la vista del caster: los mismos datos que /pista
// (useHits), en un recuadro fijo con el QR, la cuenta regresiva, el recuento y
// la descripción de cada hit para poder narrarlo.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

export function CasterVote({ hits }: { hits: LiveHits }) {
  const { poll, phase } = hits;
  const voting = poll && (phase === "announced" || phase === "open");
  const timed = hits.active;
  const used = hits.state?.polls_used ?? 0;
  const max = hits.state?.max_polls ?? 2;

  return (
    <section
      className={cn("rounded-xl border bg-card p-5", voting ? "border-accent" : "border-border")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <PixelIcon name="zap" className="h-4 w-4 text-primary" /> Votación
        </h2>
        {hits.state && (
          <span className="text-xs text-muted-foreground">
            Votaciones en esta ronda: {used}/{max}
          </span>
        )}
      </div>

      {poll && voting && (
        <div className="mt-4 grid items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="mx-auto">
            <VoteQr size={180} />
            <p className="mt-2 text-center text-xs text-muted-foreground">QR para votar</p>
          </div>
          <div className="min-w-0">
            <p
              className={cn("text-sm text-accent", phase === "announced" && "animate-run-it-blink")}
              style={PIXEL}
            >
              {phase === "announced" ? "Votación próxima" : "¡Vota el hit!"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {phase === "announced"
                ? "Pide a la grada que saque el celular. La votación abre en"
                : "La grada está votando. Cierra en"}
            </p>
            <p className="mt-1 text-4xl tabular-nums text-accent" style={PIXEL}>
              {formatLeft(phase === "announced" ? hits.opensIn : hits.closesIn)}
            </p>
            {phase === "open" && (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  {poll.tally.good + poll.tally.bad} votos
                </p>
                <TallyBars poll={poll} good={hitInfo(poll.good)} bad={hitInfo(poll.bad)} />
              </>
            )}
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <HitCard id={poll.good} />
              <HitCard id={poll.bad} />
            </div>
          </div>
        </div>
      )}

      {poll?.winner && phase === "result" && hits.justDecided && (
        <div
          className={cn(
            "animate-run-it-pop mt-4 rounded-lg p-4",
            hitInfo(poll.winner).kind === "bueno"
              ? "bg-success-soft text-success"
              : "bg-danger-soft text-danger",
          )}
        >
          <p className="text-xs uppercase" style={PIXEL}>
            La grada eligió · hit {hitInfo(poll.winner).kind}
          </p>
          <p className="mt-2 text-2xl" style={PIXEL}>
            {hitInfo(poll.winner).name}
          </p>
          <p className="mt-2 text-sm">{hitInfo(poll.winner).text}</p>
          <p className="mt-1 text-xs opacity-80">
            Votos: {poll.tally.good} contra {poll.tally.bad}
          </p>
        </div>
      )}

      {!voting && !(phase === "result" && hits.justDecided) && (
        <div className="mt-4 flex items-center gap-4">
          <div className="opacity-30 grayscale">
            <VoteQr size={96} />
          </div>
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Sin votación en curso</p>
            <p className="mt-1">
              Cuando el organizador anuncie una votación aparecen acá el QR, la cuenta regresiva y
              el recuento en vivo.
            </p>
          </div>
        </div>
      )}

      {timed.length > 0 && !(phase === "result" && hits.justDecided) && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground" style={PIXEL}>
            Hits activos
          </p>
          {timed.map((hit) => (
            <p
              key={hit.id}
              className={cn(
                "mt-2 flex justify-between gap-3 text-sm",
                hitInfo(hit.hit).kind === "malo" ? "text-danger" : "text-success",
              )}
            >
              <span>
                <b>{hitInfo(hit.hit).name}</b>{" "}
                <span className="text-muted-foreground">· {hitInfo(hit.hit).scope}</span>
              </span>
              <span className="tabular-nums">
                {hit.ends_at === null ? "hasta el cierre" : formatLeft(hits.left(hit.hit))}
              </span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function HitCard({ id }: { id: HitId }) {
  const hit = hitInfo(id);
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        hit.kind === "bueno" ? "border-success/40" : "border-danger/40",
      )}
    >
      <p className={cn("font-semibold", hit.kind === "bueno" ? "text-success" : "text-danger")}>
        {hit.name} <span className="text-xs font-normal">· {hit.kind}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hit.text}</p>
    </div>
  );
}
