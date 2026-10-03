import { useEffect, useRef, useState } from "react";
import { createSocketFeed, formatClock } from "@/lib/runit";
import { useRoundTimer, useServerClockOffset } from "@/hooks/use-round-timer";
import { getActiveRound, getRoundLeaderboard } from "@/lib/api";
import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";

type Entry = Awaited<ReturnType<typeof getRoundLeaderboard>>[number] & { character?: number };

type TrackRound = {
  id: string;
  number: number | null;
  problem: string;
  capacity: number;
  endsAt: number;
  startsAt: number;
};

// Altura de un carril en px: la pista se reordena moviendo cada carril a su
// posición en el ranking.
const LANE_HEIGHT = 80;

// Qué separa a un participante del siguiente en el ranking. Es el mismo orden
// del servidor (GET /rounds/:id/leaderboard): completó, por orden de llegada;
// después más tests; después menos fallos.
function decidedBy(a: Entry, b: Entry) {
  if (Boolean(a.solved_at) !== Boolean(b.solved_at)) return "completó";
  if (a.solved_at && b.solved_at) return "llegó antes";
  if (Number(a.best_pass_percentage) !== Number(b.best_pass_percentage)) return "tests";
  if (a.penalty_seconds !== b.penalty_seconds) return "fallos";
  return "empate";
}

/**
 * Pista en vivo: cada participante corre con su personaje, avanza según los
 * tests que pasa y los carriles se ordenan con el ranking del servidor. Al
 * cerrar la ronda, los eliminados caen con su animación de derrota.
 */
export function RaceTrack() {
  const [load, setLoad] = useState<"loading" | "none" | "error" | "ready">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [round, setRound] = useState<TrackRound | null>(null);
  const [board, setBoard] = useState<Entry[]>([]);
  const [closed, setClosed] = useState(false);
  const roundIdRef = useRef<string | undefined>(undefined);
  roundIdRef.current = round?.id;
  const serverOffsetMs = useServerClockOffset();
  const remaining = useRoundTimer(round?.endsAt ?? 0, serverOffsetMs);
  const untilStart = useRoundTimer(round?.startsAt ?? 0, serverOffsetMs);
  const countingDown = !closed && untilStart > 0;

  useEffect(() => {
    let cancelled = false;
    getActiveRound()
      .then((active) => {
        if (cancelled) return;
        if (!active) {
          // Sin ronda activa se conserva la que cerró, con su resultado.
          if (!roundIdRef.current) setLoad("none");
          return;
        }
        // round_number viene en r.*; el tipo de api.ts no lo declara.
        const extra = active as { round_number?: number };
        setRound({
          id: active.id,
          number: extra.round_number ?? null,
          problem: active.problem_name,
          capacity: active.capacity,
          endsAt: new Date(active.ends_at).getTime(),
          startsAt: active.starts_at ? new Date(active.starts_at).getTime() : 0,
        });
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

  const roundId = round?.id;

  // El ranking manda: posición, avance y estado salen de la base. Se relee con
  // los eventos (agrupados) y cada 5 s por si el socket se perdió alguno.
  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void getRoundLeaderboard(roundId)
        .then((rows) => {
          if (!cancelled) setBoard(rows as Entry[]);
        })
        .catch(() => undefined);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    };
    load();
    const poll = setInterval(load, 5000);
    const feed = createSocketFeed(roundId);
    feed?.on("feed:connected", () => {
      load();
      // round:started sale una sola vez: si el socket estaba caído cuando
      // empezó otra ronda, la reconexión solo repide la vieja.
      void getActiveRound()
        .then((active) => {
          if (!cancelled && active && active.id !== roundIdRef.current) {
            setReloadKey((key) => key + 1);
          }
        })
        .catch(() => undefined);
    });
    feed?.on("participant:progress", refresh);
    feed?.on("participant:joined", (event) => {
      if (event.round_id === roundIdRef.current) refresh();
    });
    feed?.on("round:started", (event) => {
      if (event.round_id !== roundIdRef.current) setReloadKey((key) => key + 1);
    });
    feed?.on("round:closed", (event) => {
      if (event.round_id && event.round_id !== roundIdRef.current) return;
      setClosed(true);
      refresh();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(poll);
      feed?.disconnect();
    };
  }, [roundId]);

  // Sin socket (desarrollo sin VITE_SOCKET_URL) igual se entera de la ronda nueva.
  useEffect(() => {
    if (load !== "none") return;
    const id = setInterval(() => setReloadKey((key) => key + 1), 5000);
    return () => clearInterval(id);
  }, [load]);

  if (load !== "ready" || !round) {
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
          <p className="mt-2 text-sm text-muted-foreground">
            {load === "error"
              ? "La pista no muestra datos hasta recuperar la conexión."
              : "La pista se actualiza sola cuando el organizador inicie una ronda."}
          </p>
        )}
      </section>
    );
  }

  const solvedCount = board.filter((entry) => entry.solved_at).length;
  let arrivals = 0;
  const arrivalOf = new Map(
    board
      .filter((entry) => entry.solved_at)
      .map((entry) => [entry.participant_id, (arrivals += 1)]),
  );
  const hurry = !closed && !countingDown && remaining <= 10_000;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            <PixelIcon name="flag" className="h-4 w-4 text-primary" />
            {round.number ? `Ronda ${round.number}` : "Ronda en curso"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">{round.problem}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {solvedCount} de {round.capacity} cupos ocupados
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {closed ? "Ronda finalizada" : countingDown ? "Empieza en" : "Tiempo restante"}
          </p>
          <p
            className={`flex items-center justify-end gap-2 font-mono text-4xl font-semibold tabular-nums ${
              hurry
                ? "animate-run-it-hurry text-danger"
                : !closed && remaining <= 60_000
                  ? "text-danger"
                  : "text-foreground"
            }`}
          >
            <PixelIcon name="clock" className="h-7 w-7" />
            {formatClock(
              closed ? 0 : countingDown ? Math.ceil(untilStart / 1000) * 1000 : remaining,
            )}
          </p>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground">
            Avanzan según los tests que pasan. El orden es el del ranking: completó (por orden de
            llegada), después más tests, después menos fallos. La línea roja marca el último que
            clasifica.
          </p>
          {board.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Todavía no entró ningún participante.
            </p>
          ) : (
            <div className="relative mt-4" style={{ height: board.length * LANE_HEIGHT }}>
              {board.map((entry, index) => {
                const character = entry.character ?? 0;
                const out = entry.final_status === "eliminated";
                const pct = Math.min(100, Number(entry.best_pass_percentage));
                const state = out
                  ? "out"
                  : entry.solved_at || closed || countingDown
                    ? "idle"
                    : "run";
                const cut = index === round.capacity - 1;
                return (
                  <div
                    key={entry.participant_id}
                    className={`absolute inset-x-0 border-b-2 ${cut ? "border-danger" : "border-dashed border-border"}`}
                    style={{
                      top: index * LANE_HEIGHT,
                      height: LANE_HEIGHT,
                      transition: "top 0.6s steps(6, end)",
                    }}
                  >
                    <span className="absolute left-1 top-1 z-10 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <b className="font-mono text-foreground">{index + 1}.º</b>
                      <span
                        className={`h-2.5 w-2.5 rounded-sm bg-silk-${character % 10}`}
                        aria-hidden="true"
                      />
                      <span className={out ? "line-through" : "text-foreground"}>
                        {entry.display_name}
                      </span>
                      {entry.solved_at && (
                        <span className="font-semibold text-success">
                          · completó ({arrivalOf.get(entry.participant_id)}.º en llegar)
                        </span>
                      )}
                      {out && <span className="font-semibold text-danger">· eliminado</span>}
                    </span>
                    {/* Meta a cuadros. */}
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 right-0 top-0 w-2 opacity-60"
                      style={{
                        background:
                          "repeating-linear-gradient(0deg, var(--foreground) 0 6px, var(--background) 6px 12px)",
                      }}
                    />
                    <div
                      className="absolute bottom-0 flex items-end"
                      style={{
                        left: `calc((100% - 6rem) * ${pct / 100})`,
                        transition: "left 0.7s steps(6, end)",
                      }}
                    >
                      <Sprite index={character} state={state} scale={0.5} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="overflow-x-auto rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <PixelIcon name="trophy" className="h-4 w-4 text-primary" /> Tabla
          </h3>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Participante</th>
                <th className="pb-2 font-medium">Tests</th>
                <th className="pb-2 font-medium">Fallos</th>
                <th className="pb-2 font-medium">Sobre el siguiente por</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {board.map((entry, index) => {
                const next = board[index + 1];
                return (
                  <tr
                    key={entry.participant_id}
                    className={entry.final_status === "eliminated" ? "opacity-50" : ""}
                  >
                    <td className="py-1.5 font-mono tabular-nums">{index + 1}</td>
                    <td className="py-1.5 font-mono text-foreground">
                      {entry.display_name}
                      {entry.solved_at && (
                        <span className="ml-1 text-xs text-success">
                          ✓ {arrivalOf.get(entry.participant_id)}.º
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 font-mono tabular-nums">
                      {Math.round(Number(entry.best_pass_percentage))}%
                    </td>
                    <td className="py-1.5 font-mono tabular-nums text-muted-foreground">
                      {entry.failed_attempts_count}
                      {entry.penalty_seconds ? ` (+${entry.penalty_seconds}s)` : ""}
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {next ? (
                        <b className="font-medium text-primary">{decidedBy(entry, next)}</b>
                      ) : (
                        "—"
                      )}
                      {index === round.capacity - 1 && " · último clasificado"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

export default RaceTrack;
