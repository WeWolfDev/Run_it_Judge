import { useEffect, useMemo, useState } from "react";
import {
  formatClock,
  MOCK_PARTICIPANTS,
  MOCK_ROUND,
  MOCK_ROUNDS_PROGRESS,
  type Participant,
} from "@/lib/runit";
import { useRoundTimer } from "@/hooks/use-round-timer";
import {
  closeRound,
  createRound,
  createTournament,
  generateAccessCodes,
  getActiveRound,
  getProblems,
  getRoundLeaderboard,
  getRoundSubmissions,
  startRound,
  toggleRoundPause,
} from "@/lib/api";
import { createSocketFeed } from "@/lib/runit";

const STATUS_LABEL: Record<Participant["status"], string> = {
  racing: "En curso",
  solved: "Resuelto",
  eliminated: "Eliminado",
  past: "Fuera (ronda previa)",
};

const STATUS_CLASS: Record<Participant["status"], string> = {
  racing: "bg-info-soft text-info",
  solved: "bg-success-soft text-success",
  eliminated: "bg-danger-soft text-danger",
  past: "bg-muted text-muted-foreground",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function AdminPanel({
  participants = MOCK_PARTICIPANTS,
  round = MOCK_ROUND,
}: {
  participants?: Participant[];
  round?: typeof MOCK_ROUND;
}) {
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState("");
  const [codeCount, setCodeCount] = useState(10);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [problems, setProblems] = useState<Array<{ id: string; name: string; difficulty: string }>>([]);
  const [tournamentName, setTournamentName] = useState("Run It");
  const [selectedProblem, setSelectedProblem] = useState("");
  const [roundNumber, setRoundNumber] = useState(1);
  const [capacity, setCapacity] = useState(4);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(10);
  const [createdRoundId, setCreatedRoundId] = useState("");
  const [savingRound, setSavingRound] = useState(false);
  const [leaderboard, setLeaderboard] = useState<Array<{ participant_id: string; display_name: string; final_rank: number | null; best_pass_percentage: number; failed_attempts_count: number }>>([]);
  const [submissions, setSubmissions] = useState<Array<{ id: string; display_name: string; language: string; verdict: string; test_cases_passed: number; test_cases_total: number; submitted_at: string }>>([]);
  const [liveParticipants, setLiveParticipants] = useState<Participant[]>(participants);
  const [liveRound, setLiveRound] = useState(round);
  const displayedRound = liveRound;
  const remaining = useRoundTimer(displayedRound.ends_at);

  const filtered = useMemo(
    () => liveParticipants.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [liveParticipants, query],
  );
  const solved = liveParticipants.filter((p) => p.solved).length;
  const active = liveParticipants.filter((p) => p.status === "racing").length;

  useEffect(() => {
    void getProblems().then((items) => {
      setProblems(items);
      setSelectedProblem(items[0]?.id || "");
    }).catch(() => undefined);
    void getActiveRound().then((remote) => {
      if (!remote) return;
      setLiveRound({
        round_id: remote.id,
        ends_at: new Date(remote.ends_at).getTime(),
        problem: remote.problem_name,
        capacity: remote.capacity,
      });
      setLiveParticipants(remote.participants.map((participant, index) => ({
        participant_id: participant.participant_id,
        name: participant.name,
        lane: index + 1,
        silk: index % 6,
        test_cases_passed: Number(participant.best_pass_percentage),
        test_cases_total: 100,
        attempts: participant.failed_attempts_count,
        solved: Boolean(participant.solved_at),
        status: participant.solved_at ? "solved" : "racing",
      })));
      void getRoundLeaderboard(remote.id).then(setLeaderboard).catch(() => undefined);
      void getRoundSubmissions(remote.id).then(setSubmissions).catch(() => undefined);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const feed = createSocketFeed();
    if (!feed) return;
    feed.on("participant:progress", (progress) => {
      setLiveParticipants((current) => current.map((participant) => participant.participant_id === progress.participant_id
        ? {
            ...participant,
            test_cases_passed: progress.test_cases_passed,
            test_cases_total: progress.test_cases_total,
            solved: progress.solved,
            status: progress.solved ? "solved" : "racing",
          }
        : participant));
    });
    feed.on("round:paused", (roundState) => setPaused(Boolean(roundState.paused)));
    feed.on("round:closed", () => setMessage("La ronda se cerró"));
    return () => feed.disconnect();
  }, []);

  const saveRound = async () => {
    if (!selectedProblem || !tournamentName.trim()) {
      setMessage("Indica un nombre de torneo y un problema.");
      return;
    }
    setSavingRound(true);
    try {
      const tournament = await createTournament(tournamentName.trim());
      const created = await createRound(
        tournament.id,
        roundNumber,
        selectedProblem,
        capacity,
        timeLimitMinutes * 60,
      );
      setCreatedRoundId(created.id);
      setMessage("Ronda creada. Iníciala cuando estés listo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear la ronda");
    } finally {
      setSavingRound(false);
    }
  };

  const liveRoundId = String(displayedRound.round_id);

  return (
    <div className="grid gap-5 lg:grid-cols-[7fr_3fr]">
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Control de la ronda actual
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">{displayedRound.problem}</h2>
            </div>
            <p className="font-mono text-4xl font-semibold tabular-nums text-foreground">
              {formatClock(remaining)}
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat label="Cupo" value={displayedRound.capacity} />
            <Stat label="Ya resolvieron" value={solved} />
            <Stat label="Activos" value={active} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => {
                if (!liveRoundId.includes("-")) {
                  setPaused((value) => !value);
                  return;
                }
                void toggleRoundPause(liveRoundId)
                  .then(({ paused: nextPaused }) => setPaused(nextPaused))
                  .catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo pausar la ronda"));
              }}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {paused ? "Reanudar ronda" : "Pausar ronda"}
            </button>
            <button onClick={() => {
              if (!liveRoundId.includes("-")) {
                setMessage("Configura una ronda real para poder cerrarla.");
                return;
              }
              void closeRound(liveRoundId).then(() => setMessage("Ronda cerrada")).catch((error) => setMessage(error.message));
            }} className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-danger-foreground transition-opacity hover:opacity-90">
              Forzar cierre
            </button>
            {message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
            <h3 className="text-sm font-semibold text-foreground">Participantes en esta ronda</h3>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar participante…"
              className="w-56 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Nombre</th>
                <th className="px-5 py-3 font-medium">Avance</th>
                <th className="px-5 py-3 font-medium">Intentos</th>
                <th className="px-5 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((p) => {
                const pct = Math.round((p.test_cases_passed / p.test_cases_total) * 100);
                return (
                  <tr key={p.participant_id}>
                    <td className="px-5 py-3 font-mono text-foreground">{p.name}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full bg-silk-${p.silk}`}
                            style={{ width: `${pct}%`, transition: "width 0.55s ease" }}
                          />
                        </div>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono tabular-nums text-muted-foreground">{p.attempts}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[p.status]}`}
                      >
                        {STATUS_LABEL[p.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Ranking y resultados</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="pb-3">Pos.</th><th className="pb-3">Participante</th><th className="pb-3">Avance</th><th className="pb-3">Fallos</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leaderboard.map((entry, index) => (
                  <tr key={entry.participant_id}>
                    <td className="py-2 font-mono">{entry.final_rank ?? index + 1}</td>
                    <td className="py-2 font-mono">{entry.display_name}</td>
                    <td className="py-2">{entry.best_pass_percentage}%</td>
                    <td className="py-2">{entry.failed_attempts_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {leaderboard.length === 0 && <p className="text-xs text-muted-foreground">Aún no hay ranking disponible.</p>}
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Últimos envíos</p>
            <ul className="mt-2 space-y-2 text-xs">
              {submissions.slice(0, 8).map((submission) => (
                <li key={submission.id} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-foreground">{submission.display_name}</span>
                  <span className="text-muted-foreground">{submission.language} · {submission.verdict}</span>
                </li>
              ))}
            </ul>
            {submissions.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Aún no hay envíos.</p>}
          </div>
        </section>
      </div>

      <aside className="space-y-5">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Códigos de acceso</h3>
          <p className="mt-2 text-xs text-muted-foreground">Cada código puede registrarse una sola vez.</p>
          <div className="mt-4 flex gap-2">
            <input
              type="number"
              min={1}
              max={500}
              value={codeCount}
              onChange={(event) => setCodeCount(Number(event.target.value))}
              className="w-20 rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
              aria-label="Cantidad de códigos"
            />
            <button
              type="button"
              onClick={() => void generateAccessCodes(codeCount)
                .then(({ codes }) => {
                  setGeneratedCodes(codes);
                  setMessage(`${codes.length} códigos generados`);
                })
                .catch((error) => setMessage(error instanceof Error ? error.message : "No se pudieron generar los códigos"))}
              className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Generar
            </button>
          </div>
          {generatedCodes.length > 0 && (
            <textarea
              readOnly
              value={generatedCodes.join("\n")}
              className="mt-3 h-32 w-full resize-none rounded-lg border border-input bg-background p-3 font-mono text-xs text-foreground outline-none"
              aria-label="Códigos generados"
            />
          )}
          {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Configurar ronda</h3>
          <div className="mt-4 space-y-4">
            <label className="block text-sm">
              <span className="text-muted-foreground">Nombre del torneo</span>
              <input
                value={tournamentName}
                onChange={(event) => setTournamentName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Problema</span>
              <select value={selectedProblem} onChange={(event) => setSelectedProblem(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring">
                {problems.length === 0 && <option value="">No hay problemas disponibles</option>}
                {problems.map((problem) => <option key={problem.id} value={problem.id}>{problem.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Número de ronda</span>
              <input
                type="number"
                min={1}
                value={roundNumber}
                onChange={(event) => setRoundNumber(Number(event.target.value))}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Cupo</span>
              <input type="number" min={1} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring" />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Tiempo límite (minutos)</span>
              <input
                type="number"
                min={1}
                value={timeLimitMinutes}
                onChange={(event) => setTimeLimitMinutes(Number(event.target.value))}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
              />
            </label>
            <button type="button" onClick={() => void saveRound()} disabled={savingRound} className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
              {savingRound ? "Creando..." : "Crear ronda"}
            </button>
            {createdRoundId && <button type="button" onClick={() => void startRound(createdRoundId).then(() => setMessage("Ronda iniciada")).catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo iniciar la ronda"))} className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">Iniciar ronda creada</button>}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Progreso del torneo</h3>
          <ul className="mt-4 space-y-1">
            {MOCK_ROUNDS_PROGRESS.map((r) => (
              <li
                key={r.round}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                  r.state === "active"
                    ? "bg-info-soft font-medium text-foreground"
                    : r.state === "upcoming"
                      ? "text-muted-foreground"
                      : "text-foreground"
                }`}
              >
                <span>Ronda {r.round}</span>
                <span className="font-mono tabular-nums">
                  {r.entered} → {r.advanced ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

export default AdminPanel;
