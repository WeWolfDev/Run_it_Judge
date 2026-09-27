import { useEffect, useMemo, useState } from "react";
import { formatClock, SILK_COUNT, type Participant, type RoundStartedEvent } from "@/lib/runit";
import { useRoundTimer, useServerClockOffset } from "@/hooks/use-round-timer";
import { parseCodeforcesZip } from "@/lib/test-case-parser";
import { ProblemStatement } from "@/components/ProblemStatement";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  apiUrl,
  closeRound,
  createNextRound,
  createProblem,
  createRound,
  createTournament,
  finishTournament,
  generateAccessCodes,
  getActiveRound,
  getNextRound,
  getProblems,
  getRoundLeaderboard,
  getRoundSubmissions,
  getTournamentRounds,
  getTournaments,
  listAccessCodes,
  revokeAccessCodes,
  startRound,
  toggleRoundPause,
  type AccessCode,
  type NextRoundPreview,
} from "@/lib/api";
import { createSocketFeed } from "@/lib/runit";
import { getSessionToken } from "@/lib/session";

// GET /tournaments/:id/rounds agrega los conteos; el tipo de api.ts no los declara.
type TournamentRoundProgress = Awaited<ReturnType<typeof getTournamentRounds>>[number] & {
  participants_count: number;
  advanced_count: number;
};

const ROUND_STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  active: "En curso",
  closing: "Cerrando",
  closed: "Cerrada",
};

type QueueStats = { waiting: number; active: number; completed: number; failed: number };

type SubmissionRow = {
  id: string;
  display_name: string;
  language: string;
  verdict: string;
  test_cases_passed: number;
  test_cases_total: number;
  submitted_at: string;
};

// Lo emite POST /rounds/:id/submissions y el worker cuando un job falla.
type SubmissionQueuedEvent = {
  id: string;
  round_id: string;
  participant_id: string;
  display_name?: string;
  language?: string;
  submitted_at?: string;
  verdict: string;
};

async function fetchQueueStats(): Promise<QueueStats> {
  const token = getSessionToken();
  const response = await fetch(apiUrl("/queue/stats"), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error("No se pudo leer la cola");
  return response.json() as Promise<QueueStats>;
}

// Tiempo = solved_at - started_at + penalización, calculado por el backend.
function formatTotalTime(seconds: number | null | undefined, penalty: number | undefined) {
  if (seconds == null) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return penalty ? `${minutes}:${rest} (+${penalty}s)` : `${minutes}:${rest}`;
}

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

const CODE_STATUS_LABEL: Record<AccessCode["status"], string> = {
  unused: "Sin usar",
  claimed: "Canjeado",
  expired: "Invalidado",
};

const CODE_STATUS_CLASS: Record<AccessCode["status"], string> = {
  unused: "bg-info-soft text-info",
  claimed: "bg-success-soft text-success",
  expired: "bg-muted text-muted-foreground",
};

// Valor de la option que abre el formulario inline. No es un nombre de torneo.
const NEW_TOURNAMENT_OPTION = "__nuevo_torneo__";

function formatExpiry(iso: string) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "vencido";
  if (minutes < 60) return `en ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `en ${hours} h`;
  return new Date(iso).toLocaleDateString();
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function AdminPanel({
  participants,
  round,
}: {
  participants?: Participant[];
  round?: RoundStartedEvent;
}) {
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState("");
  const [codeCount, setCodeCount] = useState(10);
  const [codeTtlMinutes, setCodeTtlMinutes] = useState(240);
  const [codeTournamentId, setCodeTournamentId] = useState("");
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(false);
  const [busyCodes, setBusyCodes] = useState(false);
  const [tournaments, setTournaments] = useState<
    Array<{ id: string; name: string; status: string }>
  >([]);
  const [problemName, setProblemName] = useState("");
  const [problemStatement, setProblemStatement] = useState("");
  const [problemDifficulty, setProblemDifficulty] = useState<"easy" | "medium" | "hard">("easy");
  // is_sample marca los casos que ve el participante. Por defecto todo es privado.
  const [testCases, setTestCases] = useState<
    Array<{ stdin: string; expected: string; is_sample: boolean }>
  >([{ stdin: "", expected: "", is_sample: false }]);
  // Casos importados de un .zip que no se muestran en el editor, pero se envían.
  // Nunca son ejemplo: el admin no los ve, así que no puede decidir publicarlos.
  const [hiddenCases, setHiddenCases] = useState<
    Array<{ stdin: string; expected: string; is_sample: boolean }>
  >([]);
  const [savingProblem, setSavingProblem] = useState(false);
  const [problems, setProblems] = useState<Array<{ id: string; name: string; difficulty: string }>>(
    [],
  );
  // Arranca vacío: el select muestra "Sin torneo seleccionado". Con un nombre
  // por defecto, saveRound crearía un torneo que el select no refleja.
  const [tournamentName, setTournamentName] = useState("");
  const [creatingTournament, setCreatingTournament] = useState(false);
  const [newTournamentName, setNewTournamentName] = useState("");
  const [savingTournament, setSavingTournament] = useState(false);
  const [selectedProblem, setSelectedProblem] = useState("");
  const [roundNumber, setRoundNumber] = useState(1);
  const [capacity, setCapacity] = useState(4);
  const [nextRoundPreview, setNextRoundPreview] = useState<NextRoundPreview | null>(null);
  const [nextRoundCapacity, setNextRoundCapacity] = useState(0);
  const [savingNextRound, setSavingNextRound] = useState(false);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(10);
  const [createdRoundId, setCreatedRoundId] = useState("");
  const [savingRound, setSavingRound] = useState(false);
  const [leaderboard, setLeaderboard] = useState<
    Array<{
      participant_id: string;
      display_name: string;
      final_rank: number | null;
      best_pass_percentage: number;
      failed_attempts_count: number;
      penalty_seconds?: number;
      total_time_seconds?: number | null;
    }>
  >([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [queueError, setQueueError] = useState(false);
  const [liveParticipants, setLiveParticipants] = useState<Participant[]>(participants ?? []);
  // null = no hay ronda activa. Al cerrarse se conserva la última, para poder
  // crear la siguiente desde aquí.
  const [liveRound, setLiveRound] = useState<RoundStartedEvent | null>(round ?? null);
  const [liveTournamentId, setLiveTournamentId] = useState("");
  // Sube con cada round:closed para volver a pedir la vista previa y el progreso.
  const [closedVersion, setClosedVersion] = useState(0);
  const [roundsProgress, setRoundsProgress] = useState<TournamentRoundProgress[] | null>(null);
  const displayedRound = liveRound;
  const serverOffsetMs = useServerClockOffset(setMessage);
  const remaining = useRoundTimer(displayedRound?.ends_at ?? 0, serverOffsetMs);
  const liveRoundId = displayedRound ? String(displayedRound.round_id) : "";

  const filtered = useMemo(
    () => liveParticipants.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [liveParticipants, query],
  );
  const solved = liveParticipants.filter((p) => p.solved).length;
  const active = liveParticipants.filter((p) => p.status === "racing").length;

  const refreshCodes = useMemo(
    () => async () => {
      setLoadingCodes(true);
      try {
        setCodes(await listAccessCodes(codeTournamentId || null));
      } catch {
        setCodes([]);
      } finally {
        setLoadingCodes(false);
      }
    },
    [codeTournamentId],
  );

  const refreshTournaments = useMemo(
    () => async () => {
      try {
        setTournaments(await getTournaments());
      } catch {
        setTournaments([]);
      }
    },
    [],
  );

  useEffect(() => {
    void refreshTournaments();
  }, [refreshTournaments]);

  const refreshQueueStats = useMemo(
    () => () =>
      void fetchQueueStats()
        .then((stats) => {
          setQueueStats(stats);
          setQueueError(false);
        })
        .catch(() => setQueueError(true)),
    [],
  );

  useEffect(() => {
    refreshQueueStats();
  }, [refreshQueueStats]);

  useEffect(() => {
    void refreshCodes();
  }, [refreshCodes]);

  // La vista previa de la ronda siguiente se consulta siempre: si la ronda
  // está cerrada y hay clasificados, aparece el botón. Es la única forma de que
  // el panel ofrezca continuar el torneo sin que el admin cuente a mano.
  useEffect(() => {
    if (!liveRoundId || liveRoundId === "undefined" || liveRoundId === "null") {
      setNextRoundPreview(null);
      return;
    }
    let cancelled = false;
    void getNextRound(liveRoundId)
      .then((preview) => {
        if (cancelled) return;
        setNextRoundPreview(preview);
        // El cupo por defecto es "clasifican todos". El admin puede bajarlo
        // para eliminar más, nunca subirlo.
        setNextRoundCapacity(preview.advancingCount);
      })
      .catch(() => {
        if (!cancelled) setNextRoundPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [liveRoundId, closedVersion]);

  const loadActiveRound = useMemo(
    () => () =>
      void getActiveRound()
        .then((remote) => {
          if (!remote) return;
          // tournament_id y paused vienen en r.*; el tipo de api.ts no los declara.
          const extra = remote as { tournament_id?: string; paused?: boolean };
          setLiveTournamentId(extra.tournament_id ?? "");
          setPaused(Boolean(extra.paused));
          setLiveRound({
            round_id: remote.id,
            ends_at: new Date(remote.ends_at).getTime(),
            problem: remote.problem_name,
            capacity: remote.capacity,
          });
          setLiveParticipants(
            remote.participants.map((participant, index) => ({
              participant_id: participant.participant_id,
              name: participant.name,
              lane: index + 1,
              silk: index % SILK_COUNT,
              test_cases_passed: Number(participant.best_pass_percentage),
              test_cases_total: 100,
              attempts: participant.failed_attempts_count,
              solved: Boolean(participant.solved_at),
              status: participant.solved_at ? "solved" : "racing",
            })),
          );
          void getRoundLeaderboard(remote.id)
            .then(setLeaderboard)
            .catch(() => undefined);
          void getRoundSubmissions(remote.id)
            .then(setSubmissions)
            .catch(() => undefined);
        })
        .catch(() => setMessage("No se pudo cargar la ronda activa.")),
    [],
  );

  useEffect(() => {
    void getProblems()
      .then((items) => {
        setProblems(items);
        setSelectedProblem(items[0]?.id || "");
      })
      .catch(() => undefined);
    loadActiveRound();
  }, [loadActiveRound]);

  // Rondas reales del torneo en juego; si no hay ronda activa, las del torneo
  // elegido en el formulario.
  const progressTournamentId =
    liveTournamentId ||
    tournaments.find((t) => t.name === tournamentName.trim() && t.status !== "finished")?.id ||
    "";

  const refreshRoundsProgress = useMemo(
    () => () => {
      if (!progressTournamentId) {
        setRoundsProgress(null);
        return;
      }
      void getTournamentRounds(progressTournamentId)
        .then((rows) => setRoundsProgress(rows as TournamentRoundProgress[]))
        .catch(() => setRoundsProgress([]));
    },
    [progressTournamentId],
  );

  useEffect(() => {
    refreshRoundsProgress();
  }, [refreshRoundsProgress, closedVersion]);

  const socketRoundId = liveRound ? String(liveRound.round_id) : undefined;

  useEffect(() => {
    const roundId = socketRoundId ?? "";
    // Sin ronda el socket igual se conecta, para enterarse de round:started.
    const feed = createSocketFeed(socketRoundId);
    if (!feed) return;
    // RunItEvents (runit.ts) no declara submission:queued; se tipa aquí.
    const onAny = feed.on as unknown as (
      event: string,
      handler: (payload: unknown) => void,
    ) => void;
    onAny("submission:queued", (payload) => {
      const event = payload as SubmissionQueuedEvent;
      if (event.round_id !== roundId) return;
      setSubmissions((current) => {
        // El worker reemite el mismo id con verdict judge_error: se actualiza la fila.
        if (current.some((row) => row.id === event.id)) {
          return current.map((row) =>
            row.id === event.id ? { ...row, verdict: event.verdict } : row,
          );
        }
        const row: SubmissionRow = {
          id: event.id,
          display_name: event.display_name ?? event.participant_id.slice(0, 8),
          language: event.language ?? "",
          verdict: event.verdict,
          test_cases_passed: 0,
          test_cases_total: 0,
          submitted_at: event.submitted_at ?? new Date().toISOString(),
        };
        return [row, ...current];
      });
      refreshQueueStats();
    });
    feed.on("participant:progress", (progress) => {
      // El veredicto y la penalización solo se conocen al terminar el job.
      void getRoundSubmissions(roundId)
        .then(setSubmissions)
        .catch(() => undefined);
      void getRoundLeaderboard(roundId)
        .then(setLeaderboard)
        .catch(() => undefined);
      refreshQueueStats();
      setLiveParticipants((current) =>
        current.map((participant) =>
          participant.participant_id === progress.participant_id
            ? {
                ...participant,
                test_cases_passed: progress.test_cases_passed,
                test_cases_total: progress.test_cases_total,
                solved: progress.solved,
                status: progress.solved ? "solved" : "racing",
              }
            : participant,
        ),
      );
    });
    feed.on("participant:joined", (joined) => {
      if (joined.round_id !== roundId) return;
      setLiveParticipants((current) =>
        current.some((participant) => participant.participant_id === joined.participant_id)
          ? current
          : [
              ...current,
              {
                participant_id: joined.participant_id,
                name: joined.name,
                lane: current.length + 1,
                silk: current.length % SILK_COUNT,
                test_cases_passed: 0,
                test_cases_total: 100,
                attempts: 0,
                solved: false,
                status: "racing",
              },
            ],
      );
      void getRoundLeaderboard(roundId)
        .then(setLeaderboard)
        .catch(() => undefined);
    });
    feed.on("round:started", (started) => {
      if (started.round_id !== roundId) loadActiveRound();
    });
    feed.on("round:paused", (roundState) => setPaused(Boolean(roundState.paused)));
    feed.on("round:closed", () => {
      setMessage("La ronda se cerró");
      setPaused(false);
      setClosedVersion((version) => version + 1);
      if (!roundId) return;
      void getRoundLeaderboard(roundId)
        .then(setLeaderboard)
        .catch(() => undefined);
    });
    return () => feed.disconnect();
  }, [socketRoundId, refreshQueueStats, loadActiveRound]);

  const saveProblem = async () => {
    if (!problemName.trim() || !problemStatement.trim()) {
      setMessage("Completa el nombre y el enunciado.");
      return;
    }
    const allCases = [...testCases, ...hiddenCases];
    const incomplete = allCases.findIndex(
      (testCase) => !testCase.stdin.trim() || !testCase.expected.trim(),
    );
    if (incomplete !== -1) {
      setMessage(`Completa la entrada y la salida esperada del caso ${incomplete + 1}.`);
      return;
    }
    setSavingProblem(true);
    try {
      const created = await createProblem({
        name: problemName.trim(),
        statement: problemStatement.trim(),
        difficulty: problemDifficulty,
        testCases: allCases,
      });
      setProblems((current) => [created, ...current]);
      setSelectedProblem(created.id);
      setProblemName("");
      setProblemStatement("");
      setTestCases([{ stdin: "", expected: "", is_sample: false }]);
      setHiddenCases([]);
      setMessage(`Problema “${created.name}” creado y seleccionado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear el problema");
    } finally {
      setSavingProblem(false);
    }
  };

  const importTestCases = async (file: File) => {
    try {
      const parsed = await parseCodeforcesZip(file);
      if (parsed.length > 100) {
        setMessage(`El .zip tiene ${parsed.length} casos y el máximo es 100.`);
        return;
      }
      // Los dos primeros quedan visibles y editables; el resto se envía oculto.
      const imported = parsed.map((testCase) => ({ ...testCase, is_sample: false }));
      setTestCases(imported.slice(0, 2));
      setHiddenCases(imported.slice(2));
      setMessage(
        parsed.length > 2
          ? `Se importaron ${parsed.length} casos: 2 en el editor y ${parsed.length - 2} ocultos. Ninguno es ejemplo público hasta que lo marques.`
          : `Se importaron ${parsed.length} casos. Ninguno es ejemplo público hasta que lo marques.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `No se pudo leer el .zip: ${error.message}`
          : "No se pudo leer el .zip",
      );
    }
  };

  const clearTestCases = () => {
    setTestCases([{ stdin: "", expected: "", is_sample: false }]);
    setHiddenCases([]);
  };

  const saveRound = async () => {
    const name = tournamentName.trim();
    if (!selectedProblem || !name) {
      setMessage("Indica un nombre de torneo y un problema.");
      return;
    }
    setSavingRound(true);
    try {
      // Reusa el torneo con el mismo nombre mientras no esté finalizado. Antes
      // cada llamada creaba un torneo nuevo, y con UNIQUE(tournament_id,
      // round_number) eso hacía imposible armar un torneo de varias rondas desde
      // este control.
      const existing = tournaments.find((t) => t.name === name && t.status !== "finished");
      const tournament = existing ?? (await createTournament(name));
      const reused = Boolean(existing);

      // Si el número ya está usado dentro del torneo, salta al siguiente libre
      // en lugar de chocar contra el UNIQUE.
      let targetRound = roundNumber;
      if (reused) {
        const rounds = await getTournamentRounds(tournament.id);
        if (rounds.some((item) => item.round_number === roundNumber)) {
          targetRound = Math.max(...rounds.map((item) => item.round_number)) + 1;
          setRoundNumber(targetRound);
        }
      }

      const created = await createRound(
        tournament.id,
        targetRound,
        selectedProblem,
        capacity,
        timeLimitMinutes * 60,
      );
      setCreatedRoundId(created.id);
      void refreshTournaments();
      refreshRoundsProgress();
      setMessage(
        reused
          ? `Ronda ${targetRound} agregada a "${name}". Iníciala cuando estés listo.`
          : `Torneo "${name}" y ronda ${targetRound} creados. Iníciala cuando estés listo.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear la ronda");
    } finally {
      setSavingRound(false);
    }
  };

  // Crea el torneo desde "Configurar ronda" y lo deja elegido en el select. Solo
  // toca tournamentName: la resolución por nombre de saveRound sigue siendo la
  // única fuente de verdad, y el resto del formulario se conserva.
  const saveTournament = async () => {
    const name = newTournamentName.trim();
    if (!name) {
      setMessage("Indica un nombre para el torneo.");
      return;
    }
    const existing = tournaments.find((t) => t.name === name && t.status !== "finished");
    if (existing) {
      setTournamentName(existing.name);
      setNewTournamentName("");
      setCreatingTournament(false);
      setMessage(`El torneo "${name}" ya existe. Quedó seleccionado.`);
      return;
    }
    setSavingTournament(true);
    try {
      const created = await createTournament(name);
      // Se agrega ya a la lista para que el select tenga la option antes de que
      // vuelva el refresco.
      setTournaments((current) => [
        { id: created.id, name: created.name, status: "pending" },
        ...current,
      ]);
      setTournamentName(created.name);
      setNewTournamentName("");
      setCreatingTournament(false);
      setMessage(`Torneo "${created.name}" creado.`);
      void refreshTournaments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear el torneo");
    } finally {
      setSavingTournament(false);
    }
  };

  const saveNextRound = async () => {
    if (!selectedProblem) {
      setMessage("Elegí un problema para la ronda siguiente.");
      return;
    }
    setSavingNextRound(true);
    try {
      const created = await createNextRound(liveRoundId, {
        problemId: selectedProblem,
        capacity: nextRoundCapacity || null,
        timeLimitSeconds: timeLimitMinutes * 60,
      });
      setCreatedRoundId(created.round.id);
      setNextRoundPreview(null);
      refreshRoundsProgress();
      setMessage(
        `Ronda ${created.round.round_number} creada con ${created.participants} participantes. Iniciala cuando estés listo.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear la ronda siguiente");
    } finally {
      setSavingNextRound(false);
    }
  };

  return (
    <Tabs defaultValue="control">
      <TabsList>
        <TabsTrigger value="control">Control de ronda</TabsTrigger>
        <TabsTrigger value="rondas">Rondas</TabsTrigger>
        <TabsTrigger value="acceso">Acceso</TabsTrigger>
      </TabsList>

      <TabsContent value="control" className="space-y-5">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Control de la ronda actual
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">
                {displayedRound ? displayedRound.problem : "Sin ronda activa"}
              </h2>
            </div>
            <p className="font-mono text-4xl font-semibold tabular-nums text-foreground">
              {displayedRound ? formatClock(remaining) : "--:--"}
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat label="Cupo" value={displayedRound ? displayedRound.capacity : "—"} />
            <Stat label="Ya resolvieron" value={solved} />
            <Stat label="Activos" value={active} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              disabled={!liveRoundId}
              onClick={() => {
                void toggleRoundPause(liveRoundId)
                  .then(({ paused: nextPaused }) => setPaused(nextPaused))
                  .catch((error) =>
                    setMessage(
                      error instanceof Error ? error.message : "No se pudo pausar la ronda",
                    ),
                  );
              }}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {paused ? "Reanudar ronda" : "Pausar ronda"}
            </button>
            <button
              disabled={!liveRoundId}
              onClick={() => {
                void closeRound(liveRoundId)
                  .then(() => setMessage("Ronda cerrada"))
                  .catch((error) => setMessage(error.message));
              }}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-danger-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
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
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {pct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono tabular-nums text-muted-foreground">
                      {p.attempts}
                    </td>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Cola de evaluación</h3>
            {queueError ? (
              <span className="inline-flex rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger">
                Cola no disponible
              </span>
            ) : queueStats && queueStats.waiting === 0 ? (
              <span className="inline-flex rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
                Sin espera
              </span>
            ) : queueStats ? (
              <span className="inline-flex rounded-full bg-info-soft px-2.5 py-1 text-xs font-medium text-info">
                {queueStats.waiting} en espera
              </span>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Stat label="En espera" value={queueStats?.waiting ?? "—"} />
            <Stat label="Ejecutando" value={queueStats?.active ?? "—"} />
            <Stat label="Completados" value={queueStats?.completed ?? "—"} />
            <Stat label="Fallidos" value={queueStats?.failed ?? "—"} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Ranking y resultados</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-3">Pos.</th>
                  <th className="pb-3">Participante</th>
                  <th className="pb-3">Avance</th>
                  <th className="pb-3">Fallos</th>
                  <th className="pb-3">Tiempo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leaderboard.map((entry, index) => (
                  <tr key={entry.participant_id}>
                    <td className="py-2 font-mono">{entry.final_rank ?? index + 1}</td>
                    <td className="py-2 font-mono">{entry.display_name}</td>
                    <td className="py-2">{entry.best_pass_percentage}%</td>
                    <td className="py-2">{entry.failed_attempts_count}</td>
                    <td className="py-2 font-mono tabular-nums">
                      {formatTotalTime(entry.total_time_seconds, entry.penalty_seconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {leaderboard.length === 0 && (
              <p className="text-xs text-muted-foreground">Aún no hay ranking disponible.</p>
            )}
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Últimos envíos</p>
            <ul className="mt-2 space-y-2 text-xs">
              {submissions.slice(0, 8).map((submission) => (
                <li key={submission.id} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-foreground">{submission.display_name}</span>
                  <span className="text-muted-foreground">
                    {submission.language} · {submission.verdict}
                  </span>
                </li>
              ))}
            </ul>
            {submissions.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Aún no hay envíos.</p>
            )}
          </div>
        </section>
      </TabsContent>

      <TabsContent value="rondas" className="space-y-5">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Crear problema</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            Cada caso define una entrada y su salida esperada. Solo se acepta la solución que pasa
            todos los casos.
          </p>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProblem();
            }}
          >
            <label className="block text-sm">
              <span className="text-muted-foreground">Nombre</span>
              <input
                value={problemName}
                onChange={(event) => setProblemName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-ring"
                placeholder="Saludo"
                maxLength={120}
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Enunciado</span>
              <textarea
                value={problemStatement}
                onChange={(event) => setProblemStatement(event.target.value)}
                className="mt-1 min-h-20 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-ring"
                placeholder="Imprime el saludo solicitado."
                maxLength={4000}
              />
              <p className="mt-2 text-xs text-muted-foreground">Vista previa</p>
              <div className="mt-1 rounded-lg border border-border p-3">
                <ProblemStatement statement={problemStatement} />
              </div>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Dificultad</span>
              <select
                value={problemDifficulty}
                onChange={(event) =>
                  setProblemDifficulty(event.target.value as "easy" | "medium" | "hard")
                }
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-ring"
              >
                <option value="easy">Fácil</option>
                <option value="medium">Intermedio</option>
                <option value="hard">Difícil</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Importar casos (.zip)</span>
              <input
                type="file"
                accept=".zip"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Se limpia para poder volver a elegir el mismo archivo.
                  event.target.value = "";
                  if (file) void importTestCases(file);
                }}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-ring"
              />
            </label>
            {hiddenCases.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Hay {hiddenCases.length} casos ocultos además de los que se ven abajo. Se envían
                todos al crear el problema.
              </p>
            )}
            <button
              type="button"
              onClick={clearTestCases}
              disabled={savingProblem}
              className="rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger transition-opacity hover:opacity-70 disabled:opacity-50"
            >
              Limpiar todos los casos
            </button>
            <div className="space-y-2 text-sm">
              <span className="text-muted-foreground">Casos de prueba</span>
              {testCases.map((testCase, index) => (
                <div key={index} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">Caso {index + 1}</span>
                    <label className="ml-auto mr-3 flex items-center gap-1.5 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={testCase.is_sample}
                        onChange={(event) =>
                          setTestCases((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, is_sample: event.target.checked } : item,
                            ),
                          )
                        }
                        className="accent-primary"
                      />
                      Ejemplo público
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setTestCases((current) => current.filter((_, i) => i !== index))
                      }
                      disabled={testCases.length === 1}
                      className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </div>
                  <label className="block text-xs">
                    <span className="text-muted-foreground">Entrada (stdin)</span>
                    <textarea
                      value={testCase.stdin}
                      onChange={(event) =>
                        setTestCases((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, stdin: event.target.value } : item,
                          ),
                        )
                      }
                      className="mt-1 min-h-12 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-ring"
                      placeholder="Mundo"
                      maxLength={1000}
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="text-muted-foreground">Salida esperada</span>
                    <textarea
                      value={testCase.expected}
                      onChange={(event) =>
                        setTestCases((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, expected: event.target.value } : item,
                          ),
                        )
                      }
                      className="mt-1 min-h-12 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-ring"
                      placeholder="Hola Mundo"
                      maxLength={1000}
                    />
                  </label>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setTestCases((current) => [
                    ...current,
                    { stdin: "", expected: "", is_sample: false },
                  ])
                }
                disabled={testCases.length + hiddenCases.length >= 100}
                className="w-full rounded-lg border border-dashed border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
              >
                Agregar caso
              </button>
            </div>
            <button
              type="submit"
              disabled={savingProblem}
              className="w-full rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {savingProblem ? "Creando..." : "Crear y seleccionar"}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Configurar ronda</h3>
          <div className="mt-4 space-y-4">
            <label className="block text-sm">
              <span className="text-muted-foreground">Nombre del torneo</span>
              <select
                value={creatingTournament ? NEW_TOURNAMENT_OPTION : tournamentName}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === NEW_TOURNAMENT_OPTION) {
                    // Sin torneo elegido mientras se crea: si el admin guarda la
                    // ronda antes, saveRound pide el nombre en vez de usar el
                    // anterior en silencio.
                    setTournamentName("");
                    setCreatingTournament(true);
                    return;
                  }
                  setCreatingTournament(false);
                  setTournamentName(value);
                }}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
              >
                <option value="">
                  {tournaments.length === 0
                    ? "No hay torneos. Creá el primero para empezar."
                    : "Sin torneo seleccionado"}
                </option>
                {tournaments.map((tournament) =>
                  tournament.status === "finished" ? (
                    <option key={tournament.id} value={`finished:${tournament.id}`} disabled>
                      {tournament.name} (finalizado)
                    </option>
                  ) : (
                    <option key={tournament.id} value={tournament.name}>
                      {tournament.name}
                    </option>
                  ),
                )}
                <option value={NEW_TOURNAMENT_OPTION}>+ Crear nuevo torneo</option>
              </select>
            </label>
            {(creatingTournament || tournaments.length === 0) && (
              <div className="space-y-2">
                <input
                  value={newTournamentName}
                  onChange={(event) => setNewTournamentName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveTournament();
                  }}
                  placeholder="Nombre del nuevo torneo"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={savingTournament}
                    onClick={() => void saveTournament()}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-opacity hover:opacity-70 disabled:opacity-50"
                  >
                    {savingTournament ? "Creando..." : "Crear"}
                  </button>
                  <button
                    type="button"
                    disabled={savingTournament}
                    onClick={() => {
                      setNewTournamentName("");
                      setCreatingTournament(false);
                    }}
                    className="rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger transition-opacity hover:opacity-70 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            <label className="block text-sm">
              <span className="text-muted-foreground">Problema</span>
              <select
                value={selectedProblem}
                onChange={(event) => setSelectedProblem(event.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
              >
                {problems.length === 0 && <option value="">No hay problemas disponibles</option>}
                {problems.map((problem) => (
                  <option key={problem.id} value={problem.id}>
                    {problem.name}
                  </option>
                ))}
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
              <input
                type="number"
                min={1}
                value={capacity}
                onChange={(event) => setCapacity(Number(event.target.value))}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
              />
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
            <button
              type="button"
              onClick={() => void saveRound()}
              disabled={savingRound}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {savingRound ? "Creando..." : "Crear ronda"}
            </button>
            {createdRoundId && (
              <button
                type="button"
                onClick={() =>
                  void startRound(createdRoundId)
                    .then(() => {
                      setMessage("Ronda iniciada");
                      loadActiveRound();
                      refreshRoundsProgress();
                    })
                    .catch((error) =>
                      setMessage(
                        error instanceof Error ? error.message : "No se pudo iniciar la ronda",
                      ),
                    )
                }
                className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Iniciar ronda creada
              </button>
            )}
          </div>
        </section>

        {nextRoundPreview && (
          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground">Ronda siguiente</h3>
            {nextRoundPreview.available ? (
              <>
                <p className="mt-2 text-xs text-muted-foreground">
                  {nextRoundPreview.advancingCount} de {liveParticipants.length} participantes
                  clasificaron a la ronda {nextRoundPreview.nextRoundNumber}. Ya están inscriptos.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {nextRoundPreview.advancing.map((entry) => (
                    <span
                      key={entry.participant_id}
                      className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
                    >
                      {entry.final_rank}. {entry.display_name}
                    </span>
                  ))}
                </div>
                <div className="mt-4 space-y-3">
                  <label className="block text-sm">
                    <span className="text-muted-foreground">Problema</span>
                    <select
                      value={selectedProblem}
                      onChange={(event) => setSelectedProblem(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                    >
                      {problems.length === 0 && (
                        <option value="">No hay problemas disponibles</option>
                      )}
                      {problems.map((problem) => (
                        <option key={problem.id} value={problem.id}>
                          {problem.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <label className="block flex-1 text-sm">
                      <span className="text-muted-foreground">
                        Cupo (máx. {nextRoundPreview.advancingCount})
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={nextRoundPreview.advancingCount}
                        value={nextRoundCapacity}
                        onChange={(event) => setNextRoundCapacity(Number(event.target.value))}
                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
                      />
                    </label>
                    <label className="block flex-1 text-sm">
                      <span className="text-muted-foreground">Tiempo límite (minutos)</span>
                      <input
                        type="number"
                        min={1}
                        value={timeLimitMinutes}
                        onChange={(event) => setTimeLimitMinutes(Number(event.target.value))}
                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveNextRound()}
                    disabled={savingNextRound}
                    className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {savingNextRound
                      ? "Creando..."
                      : `Crear ronda ${nextRoundPreview.nextRoundNumber}`}
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{nextRoundPreview.reason}</p>
            )}
          </section>
        )}

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Progreso del torneo</h3>
          {!progressTournamentId ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Elige un torneo o inicia una ronda para ver su progreso.
            </p>
          ) : roundsProgress === null ? (
            <p className="mt-4 text-sm text-muted-foreground">Cargando rondas…</p>
          ) : roundsProgress.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Sin rondas todavía</p>
          ) : (
            <ul className="mt-4 space-y-1">
              {roundsProgress.map((r) => (
                <li
                  key={r.id}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                    r.status === "active"
                      ? "bg-info-soft font-medium text-foreground"
                      : r.status === "pending"
                        ? "text-muted-foreground"
                        : "text-foreground"
                  }`}
                >
                  <span>
                    Ronda {r.round_number} · {ROUND_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  <span className="font-mono tabular-nums">
                    {r.participants_count} → {r.status === "closed" ? r.advanced_count : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </TabsContent>

      <TabsContent value="acceso">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Códigos de acceso</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            Cada código se puede canjear una sola vez. Si lo asocias a un torneo, se invalida solo
            cuando el torneo termina o cuando vence el plazo.
          </p>

          <div className="mt-4 space-y-3">
            <label className="block text-xs">
              <span className="text-muted-foreground">Torneo (opcional)</span>
              <select
                value={codeTournamentId}
                onChange={(event) => setCodeTournamentId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
              >
                <option value="">Sin torneo (código global)</option>
                {tournaments.map((tournament) => (
                  <option
                    key={tournament.id}
                    value={tournament.id}
                    disabled={tournament.status === "finished"}
                  >
                    {tournament.name}
                    {tournament.status === "finished" ? " — finalizado" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-2">
              <label className="block flex-1 text-xs">
                <span className="text-muted-foreground">Cantidad</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={codeCount}
                  onChange={(event) => setCodeCount(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
                  aria-label="Cantidad de códigos"
                />
              </label>
              <label className="block flex-1 text-xs">
                <span className="text-muted-foreground">Válidos por (minutos)</span>
                <input
                  type="number"
                  min={1}
                  max={43200}
                  value={codeTtlMinutes}
                  onChange={(event) => setCodeTtlMinutes(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
                  aria-label="Minutos de validez"
                />
              </label>
            </div>

            <button
              type="button"
              disabled={busyCodes}
              onClick={() => {
                setBusyCodes(true);
                void generateAccessCodes({
                  count: codeCount,
                  tournamentId: codeTournamentId || null,
                  ttlMinutes: codeTtlMinutes || null,
                })
                  .then((result) => {
                    setGeneratedCodes(result.codes.map((item) => item.code));
                    setMessage(`${result.codes.length} códigos generados`);
                    return refreshCodes();
                  })
                  .catch((error) =>
                    setMessage(
                      error instanceof Error ? error.message : "No se pudieron generar los códigos",
                    ),
                  )
                  .finally(() => setBusyCodes(false));
              }}
              className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busyCodes ? "Generando..." : "Generar"}
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

          <div className="mt-4 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-foreground">Códigos emitidos</h4>
            <button
              type="button"
              onClick={() => void refreshCodes()}
              className="text-xs text-primary hover:underline"
            >
              Actualizar
            </button>
          </div>

          {codes.length > 0 && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Código</th>
                    <th className="px-2 py-1.5 font-medium">Estado</th>
                    <th className="px-2 py-1.5 font-medium">Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-2 py-1.5 font-mono text-foreground">
                        {item.code}
                        {item.display_name ? (
                          <span className="ml-1 font-sans text-muted-foreground">
                            {item.display_name}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={CODE_STATUS_CLASS[item.status]}>
                          {CODE_STATUS_LABEL[item.status]}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {item.expires_at ? formatExpiry(item.expires_at) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {loadingCodes && <p className="mt-2 text-xs text-muted-foreground">Cargando…</p>}
          {!loadingCodes && codes.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Todavía no hay códigos emitidos.</p>
          )}

          {codeTournamentId && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busyCodes}
                onClick={() => {
                  setBusyCodes(true);
                  void revokeAccessCodes({ tournamentId: codeTournamentId })
                    .then((result) => {
                      setMessage(`${result.revoked} códigos revocados`);
                      return refreshCodes();
                    })
                    .catch((error) =>
                      setMessage(error instanceof Error ? error.message : "No se pudieron revocar"),
                    )
                    .finally(() => setBusyCodes(false));
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-opacity hover:opacity-70 disabled:opacity-50"
              >
                Revocar sin usar
              </button>
              <button
                type="button"
                disabled={busyCodes}
                onClick={() => {
                  setBusyCodes(true);
                  void finishTournament(codeTournamentId)
                    .then((result) => {
                      setMessage(
                        `Torneo finalizado y ${result.expiredAccessCodes} códigos invalidados`,
                      );
                      return Promise.all([refreshCodes(), refreshTournaments()]);
                    })
                    .catch((error) =>
                      setMessage(error instanceof Error ? error.message : "No se pudo finalizar"),
                    )
                    .finally(() => setBusyCodes(false));
                }}
                className="rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger transition-opacity hover:opacity-70 disabled:opacity-50"
              >
                Finalizar torneo e invalidar
              </button>
            </div>
          )}

          {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
        </section>
      </TabsContent>
    </Tabs>
  );
}

export default AdminPanel;
