import { useEffect, useRef, useState } from "react";

import {
  ProjectedTrack,
  type Entry,
  type FeedEvent,
  type TrackRound,
} from "@/components/ProjectedTrack";
import { useServerClockOffset } from "@/hooks/use-round-timer";
import { getActiveRound, getRoundLeaderboard } from "@/lib/api";
import { createSocketFeed } from "@/lib/runit";

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

/**
 * Datos en vivo de la pista proyectada: la ronda activa, el ranking del
 * servidor (se relee con los eventos y cada 5 s) y el feed armado con los
 * eventos del socket. Al cerrar la ronda se conserva con su resultado (podio)
 * hasta que empiece otra.
 */
export function ProjectedRace() {
  const [load, setLoad] = useState<"loading" | "none" | "error" | "ready">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [round, setRound] = useState<(TrackRound & { id: string }) | null>(null);
  const [board, setBoard] = useState<Entry[]>([]);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const serverOffsetMs = useServerClockOffset();
  const roundRef = useRef(round);
  roundRef.current = round;
  const boardRef = useRef(board);
  boardRef.current = board;
  const eventId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    getActiveRound()
      .then((active) => {
        if (cancelled) return;
        if (!active) {
          if (!roundRef.current) setLoad("none");
          return;
        }
        // round_number viene en r.*; el tipo de api.ts no lo declara.
        const extra = active as { round_number?: number };
        if (roundRef.current?.id !== active.id) setEvents([]);
        setRound({
          id: active.id,
          number: extra.round_number ?? 0,
          problem: active.problem_name,
          capacity: active.capacity,
          startsAt: active.starts_at ? new Date(active.starts_at).getTime() : 0,
          endsAt: new Date(active.ends_at).getTime(),
          closed: false,
        });
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

  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fetchBoard = () =>
      void getRoundLeaderboard(roundId)
        .then((rows) => {
          if (!cancelled) setBoard(rows as Entry[]);
        })
        .catch(() => undefined);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(fetchBoard, 300);
    };
    const push = (event: Omit<FeedEvent, "id" | "at">) =>
      setEvents((list) =>
        [{ ...event, id: ++eventId.current, at: Date.now() }, ...list].slice(0, 40),
      );

    fetchBoard();
    const poll = setInterval(fetchBoard, 5000);
    // Sin unirse a la sala: participant:progress también sale a todos, y con
    // las dos vías cada evento llegaría dos veces al feed.
    const feed = createSocketFeed("");
    feed?.on("feed:connected", fetchBoard);
    feed?.on("participant:progress", (event) => {
      const entry = boardRef.current.find((e) => e.participant_id === event.participant_id);
      // Solo los de esta ronda; después de resolver los envíos no cuentan.
      if (!entry || entry.solved_at) return;
      const base = { name: entry.display_name, character: entry.character ?? 0 };
      if (event.solved) {
        const arrival = boardRef.current.filter((e) => e.solved_at).length + 1;
        push({ ...base, kind: "solved", arrival });
      } else {
        const pct = Math.round(
          (event.test_cases_passed / Math.max(1, event.test_cases_total)) * 100,
        );
        push({
          ...base,
          kind: pct > Number(entry.best_pass_percentage) ? "progress" : "fail",
          passed: event.test_cases_passed,
          total: event.test_cases_total,
        });
      }
      refresh();
    });
    feed?.on("participant:joined", (event) => {
      if (event.round_id !== roundId) return;
      push({ kind: "joined", name: event.name, character: 0 });
      refresh();
    });
    feed?.on("round:started", (event) => {
      if (event.round_id !== roundId) setReloadKey((key) => key + 1);
    });
    feed?.on("round:closed", (event) => {
      if (event.round_id && event.round_id !== roundId) return;
      setRound((current) => (current ? { ...current, closed: true } : current));
      refresh();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(poll);
      feed?.disconnect();
    };
  }, [roundId]);

  // Sin ronda (o sin socket) igual se entera de la siguiente.
  useEffect(() => {
    if (load === "ready" && !round?.closed) return;
    const id = setInterval(() => setReloadKey((key) => key + 1), 5000);
    return () => clearInterval(id);
  }, [load, round?.closed]);

  if (load !== "ready" || !round) {
    return (
      <div
        className="grid h-dvh place-items-center bg-background px-6 text-center"
        aria-busy={load === "loading"}
      >
        <div>
          <p className="text-[clamp(1.2rem,3vw,3rem)] text-primary" style={PIXEL}>
            Run&nbsp;It
          </p>
          <p className="mt-4 text-[clamp(0.9rem,1.6vw,1.6rem)] text-foreground">
            {load === "loading"
              ? "Cargando la pista…"
              : load === "error"
                ? "No se pudo conectar con el servidor"
                : "Todavía no hay una ronda activa"}
          </p>
          {load !== "loading" && (
            <p className="mt-2 text-[clamp(0.75rem,1.1vw,1.1rem)] text-muted-foreground">
              {load === "error"
                ? "La pista no muestra datos hasta recuperar la conexión."
                : "Se actualiza sola cuando el organizador inicie una ronda."}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <ProjectedTrack round={round} board={board} events={events} serverOffsetMs={serverOffsetMs} />
  );
}

export default ProjectedRace;
