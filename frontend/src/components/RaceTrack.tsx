import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSocketFeed,
  formatClock,
  SILK_COUNT,
  type Participant,
  type RoundStartedEvent,
} from "@/lib/runit";
import { useRoundTimer, useServerClockOffset } from "@/hooks/use-round-timer";
import { getActiveRound } from "@/lib/api";

interface RaceTrackProps {
  /** Valores iniciales opcionales. Sin ellos la pista se carga del backend. */
  round?: RoundStartedEvent;
  participants?: Participant[];
  /** Cuando es false no se conecta al socket (útil si el padre inyecta datos). */
  live?: boolean;
}

type ActiveRound = NonNullable<Awaited<ReturnType<typeof getActiveRound>>>;

// El avance se guarda como porcentaje sobre 100, igual que en el panel admin.
function toRunner(participant: ActiveRound["participants"][number], index: number): Participant {
  return {
    participant_id: participant.participant_id,
    name: participant.name,
    lane: index + 1,
    silk: index % SILK_COUNT,
    test_cases_passed: Number(participant.best_pass_percentage),
    test_cases_total: 100,
    attempts: participant.failed_attempts_count,
    solved: Boolean(participant.solved_at),
    status: participant.solved_at ? "solved" : "racing",
  };
}

function HorseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 46c0-9 5-14 12-17l4-9c1-3 4-6 8-7l6-2 3 5-4 3 2 4c4 2 6 6 6 11l4 3-3 4-4-2c-1 4-4 7-8 9l1 8h-5l-1-7-8 1-2 6h-5l1-7-4-1-3 4-3-2z"
      />
    </svg>
  );
}

export function RaceTrack({ round, participants, live = true }: RaceTrackProps) {
  const [load, setLoad] = useState<"loading" | "none" | "error" | "ready">(
    round ? "ready" : "loading",
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [runners, setRunners] = useState<Participant[]>(participants ?? []);
  const [displayedRound, setDisplayedRound] = useState<RoundStartedEvent | null>(round ?? null);
  const [closed, setClosed] = useState(false);
  const activeRoundId = displayedRound ? String(displayedRound.round_id) : undefined;
  const roundIdRef = useRef(activeRoundId);
  roundIdRef.current = activeRoundId;
  const runnersRef = useRef(runners);
  runnersRef.current = runners;
  const serverOffsetMs = useServerClockOffset();
  const remaining = useRoundTimer(displayedRound?.ends_at ?? 0, serverOffsetMs);

  useEffect(() => {
    let cancelled = false;
    getActiveRound()
      .then((active) => {
        if (cancelled) return;
        if (!active) {
          setDisplayedRound(null);
          setRunners([]);
          setLoad("none");
          return;
        }
        setDisplayedRound({
          round_id: active.id,
          ends_at: new Date(active.ends_at).getTime(),
          problem: active.problem_name,
          capacity: active.capacity,
        });
        setRunners(active.participants.map(toRunner));
        setClosed(false);
        setLoad("ready");
      })
      .catch(() => {
        if (!cancelled) setLoad("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!live) return;
    const feed = createSocketFeed(activeRoundId);
    if (!feed) return;
    feed.on("participant:progress", (e) => {
      setRunners((prev) =>
        prev.map((p) =>
          p.participant_id === e.participant_id
            ? {
                ...p,
                test_cases_passed: e.test_cases_passed,
                test_cases_total: e.test_cases_total,
                solved: e.solved,
                status: e.solved ? "solved" : p.status,
              }
            : p,
        ),
      );
    });
    // Se muestra apenas se inscribe, sin esperar a que envíe código.
    feed.on("participant:joined", (e) => {
      if (e.round_id !== roundIdRef.current) return;
      setRunners((prev) =>
        prev.some((p) => p.participant_id === e.participant_id)
          ? prev
          : [
              ...prev,
              {
                participant_id: e.participant_id,
                name: e.name,
                lane: prev.length + 1,
                silk: prev.length % SILK_COUNT,
                test_cases_passed: 0,
                test_cases_total: 100,
                attempts: 0,
                solved: false,
                status: "racing",
              },
            ],
      );
    });
    feed.on("round:started", (e) => {
      if (e.round_id !== roundIdRef.current) setReloadKey((key) => key + 1);
    });
    feed.on("round:closed", (e) => {
      const byId = new Map(e.ranking.map((entry) => [entry.participant_id, entry]));
      // round:closed no trae el id de la ronda: se reconoce por sus participantes.
      if (!runnersRef.current.some((p) => byId.has(p.participant_id))) return;
      setClosed(true);
      setRunners((prev) =>
        prev.map((p) =>
          byId.get(p.participant_id)?.final_status === "eliminated"
            ? { ...p, status: "eliminated" }
            : p,
        ),
      );
    });
    return () => feed.disconnect();
  }, [activeRoundId, live]);

  const solvedCount = useMemo(() => runners.filter((r) => r.solved).length, [runners]);
  const closingSoon = remaining <= 60_000;

  if (load !== "ready" || !displayedRound) {
    return (
      <section
        className="rounded-xl border border-border bg-card px-5 py-8 text-center"
        aria-busy={load === "loading"}
      >
        <h2 className="text-lg font-semibold text-foreground">
          {load === "loading"
            ? "Cargando la pista…"
            : load === "error"
              ? "No se pudo conectar con el servidor"
              : "Todavía no hay una ronda activa"}
        </h2>
        {load !== "loading" && (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              {load === "error"
                ? "La pista no muestra datos hasta recuperar la conexión."
                : "La pista se actualiza sola cuando el organizador inicie una ronda."}
            </p>
            <button
              type="button"
              onClick={() => {
                setLoad("loading");
                setReloadKey((key) => key + 1);
              }}
              className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              {load === "error" ? "Reintentar" : "Recargar"}
            </button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Ronda {displayedRound.round_id}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{displayedRound.problem}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {solvedCount} de {displayedRound.capacity} cupos ocupados
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {closed ? "Ronda finalizada" : "Tiempo restante"}
          </p>
          <p
            className={`font-mono text-4xl font-semibold tabular-nums ${closingSoon && !closed ? "text-danger" : "text-foreground"}`}
          >
            {formatClock(closed ? 0 : remaining)}
          </p>
        </div>
      </header>

      <div className="divide-y divide-border">
        {runners.length === 0 && (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">
            Todavía no entró ningún participante.
          </p>
        )}
        {runners.map((p) => {
          const pct =
            p.status === "eliminated" || p.status === "past"
              ? 0
              : Math.round((p.test_cases_passed / p.test_cases_total) * 100);
          const out = p.status === "eliminated" || p.status === "past";
          return (
            <div key={p.participant_id} className="flex items-center gap-3 px-5 py-3">
              <span className="w-7 shrink-0 text-center font-mono text-xs text-muted-foreground">
                {String(p.lane).padStart(2, "0")}
              </span>

              <div className="relative h-14 flex-1 overflow-hidden rounded-lg border border-border track-dirt">
                {/* meta a cuadros */}
                <div className="absolute inset-y-0 right-0 w-3 finish-flag" />

                <div
                  className="absolute inset-y-0 left-0 flex items-center"
                  style={{
                    transform: `translateX(calc(${Math.min(pct, 100)}% ))`,
                    width: "calc(100% - 3.25rem)",
                    transition: "transform 0.55s cubic-bezier(0.22,1,0.36,1)",
                  }}
                >
                  <div className="relative flex items-center gap-2 pl-1">
                    {!out && pct > 2 && <span className="dust-trail" aria-hidden="true" />}
                    <HorseIcon
                      className={`h-8 w-8 ${out ? "text-muted-foreground" : `text-silk-${p.silk} animate-gallop`}`}
                    />
                  </div>
                </div>
              </div>

              <div className="flex w-56 shrink-0 items-center gap-2">
                <span
                  className={`h-3 w-3 shrink-0 rounded-full bg-silk-${p.silk} ${out ? "opacity-30" : ""}`}
                />
                <span
                  className={`truncate font-mono text-sm ${out ? "text-muted-foreground line-through" : "text-foreground"}`}
                >
                  {p.name}
                </span>
                {p.solved && <span aria-label="clasificado">🏁</span>}
                <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default RaceTrack;
