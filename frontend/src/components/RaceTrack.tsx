import { useEffect, useMemo, useState } from "react";
import {
  createMockFeed,
  createSocketFeed,
  formatClock,
  MOCK_PARTICIPANTS,
  MOCK_ROUND,
  type Participant,
  type RoundStartedEvent,
} from "@/lib/runit";
import { useRoundTimer } from "@/hooks/use-round-timer";
import { getActiveRound } from "@/lib/api";

interface RaceTrackProps {
  round?: RoundStartedEvent;
  participants?: Participant[];
  /** Cuando es false no se conecta el feed mock (útil si el padre inyecta datos). */
  live?: boolean;
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

export function RaceTrack({ round = MOCK_ROUND, participants = MOCK_PARTICIPANTS, live = true }: RaceTrackProps) {
  const [runners, setRunners] = useState<Participant[]>(participants);
  const [remoteRound, setRemoteRound] = useState<RoundStartedEvent | null>(null);
  const displayedRound = remoteRound || round;
  const remaining = useRoundTimer(displayedRound.ends_at);

  useEffect(() => {
    getActiveRound().then((active) => {
      if (!active) return;
      setRemoteRound({
        round_id: active.id,
        ends_at: new Date(active.ends_at).getTime(),
        problem: active.problem_name,
        capacity: active.capacity,
      });
      setRunners(active.participants.map((participant: { participant_id: string; name: string; best_pass_percentage: number; solved_at: string | null }, index: number) => ({
        participant_id: participant.participant_id,
        name: participant.name,
        lane: index + 1,
        silk: index % 6,
        test_cases_passed: participant.best_pass_percentage === 100 ? 1 : 0,
        test_cases_total: 1,
        attempts: 0,
        solved: Boolean(participant.solved_at),
        status: participant.solved_at ? "solved" : "racing",
      })));
    }).catch(() => undefined);
  }, []);

  useEffect(() => setRunners(participants), [participants]);

  useEffect(() => {
    if (!live) return;
    const feed = createSocketFeed() ?? createMockFeed(participants);
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
    return () => feed.disconnect();
  }, [live, participants]);

  const solvedCount = useMemo(() => runners.filter((r) => r.solved).length, [runners]);
  const closingSoon = remaining <= 60_000;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Ronda {displayedRound.round_id}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{displayedRound.problem}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {solvedCount} de {round.capacity} cupos ocupados
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Tiempo restante
          </p>
          <p
            className={`font-mono text-4xl font-semibold tabular-nums ${closingSoon ? "text-danger" : "text-foreground"}`}
          >
            {formatClock(remaining)}
          </p>
        </div>
      </header>

      <div className="divide-y divide-border">
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
                <span className={`h-3 w-3 shrink-0 rounded-full bg-silk-${p.silk} ${out ? "opacity-30" : ""}`} />
                <span
                  className={`truncate font-mono text-sm ${out ? "text-muted-foreground line-through" : "text-foreground"}`}
                >
                  {p.name}
                </span>
                {p.solved && <span aria-label="clasificado">🏁</span>}
                <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default RaceTrack;
