import { useEffect, useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import { useCeremony } from "@/hooks/use-ceremony";
import { advanceCeremony, resetCeremony, type Ceremony } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Premios honoríficos en "Progreso del torneo": aparece cuando el último torneo
 * terminó. El admin inicia la ceremonia y avanza premio por premio; la pista y
 * los participantes la ven a la vez (ceremony:update).
 */
export function CeremonyPanel() {
  const latest = useCeremony();
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setCeremony(latest), [latest]);

  if (!ceremony) return null;
  const { step, awards, champion, tournament } = ceremony;
  const total = awards.length;
  const ended = step !== null && step > total;
  const now =
    step === null
      ? "Pantalla del ganador"
      : step === 0
        ? "Presentación de los premios"
        : ended
          ? "Ceremonia terminada"
          : `Premio ${step} de ${total}: ${awards[step - 1]?.title}`;
  const nextLabel =
    step === 0
      ? "Mostrar el primer premio"
      : step !== null && step < total
        ? `Siguiente premio (${step + 1}/${total})`
        : "Terminar ceremonia";

  const run = async (action: typeof advanceCeremony) => {
    setBusy(true);
    setError("");
    try {
      setCeremony(await action(tournament.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo avanzar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b>{tournament.name}</b>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Terminado
        </span>
      </div>
      {champion && (
        <p className="flex items-center gap-2">
          <PixelIcon name="trophy" className="h-4 w-4 text-[var(--gold)]" /> Ganador:{" "}
          <b>{champion.display_name}</b>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Premios honoríficos: se ven en la pista y en la pantalla de cada participante. Ahora:{" "}
        <b className="text-foreground">{now}</b>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || step !== null}
          onClick={() => void run(advanceCeremony)}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          Iniciar premios
        </button>
        <button
          type="button"
          disabled={busy || step === null || ended}
          onClick={() => void run(advanceCeremony)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40"
        >
          {nextLabel}
        </button>
        {step !== null && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(resetCeremony)}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Volver al ganador
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {total > 0 && (
        <ol className="space-y-1">
          {awards.map((award, i) => {
            const shown = step !== null && i < step;
            return (
              <li
                key={award.id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1",
                  step === i + 1 && "bg-primary/15",
                )}
              >
                <PixelIcon
                  name={shown ? "check" : "star"}
                  className={cn(
                    "h-4 w-4 shrink-0",
                    shown ? "text-success" : "text-muted-foreground",
                  )}
                />
                <span className="truncate">{award.title}</span>
                <span className="ml-auto truncate text-muted-foreground">
                  {shown ? award.winner?.display_name : "—"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default CeremonyPanel;
