import { useEffect, useMemo, useRef, useState } from "react";
import { formatClock, type Participant, type RoundStartedEvent } from "@/lib/runit";
import { useRoundTimer, useServerClockOffset } from "@/hooks/use-round-timer";
import { parseCodeforcesZip } from "@/lib/test-case-parser";
import { ProblemStatement } from "@/components/ProblemStatement";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RowCheckbox, SelectAllCheckbox } from "@/components/BulkSelect";
import { PixelIcon, type PixelIconName } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import {
  apiUrl,
  closeRound,
  createNextRound,
  createProblem,
  createRound,
  createTournament,
  deleteOrphanUsers,
  deleteProblem,
  deleteProblems,
  deleteRound,
  deleteTournament,
  deleteTournaments,
  finishTournament,
  generateAccessCodes,
  getActiveRound,
  getFinishedTournaments,
  getNextRound,
  getOrphanUsers,
  getProblemDetail,
  getProblems,
  getRoundLeaderboard,
  getRoundSubmissions,
  getTournamentRounds,
  getTournaments,
  listAccessCodes,
  previewProblemsDelete,
  previewTournamentsDelete,
  revokeAccessCodes,
  saveTournamentPlan,
  startRound,
  toggleRoundPause,
  updateProblem,
  updateRound,
  type AccessCode,
  type FinishedTournament,
  type NextRoundPreview,
  type OpenTournament,
  type OrphanUser,
  type ProblemDeletePreview,
  type ProblemDetail,
  type ProblemDifficulty,
  type ProblemTestCase,
  type TournamentDeletePreview,
} from "@/lib/api";
import {
  createSocketFeed,
  formatTime,
  LANGUAGE_LABEL,
  MAX_PROBLEM_PAYLOAD_BYTES,
  mergeSubmissions,
  type QueueStats,
  upsertSubmission,
  verdictLabel,
  verdictTone,
} from "@/lib/runit";
import { getSessionToken } from "@/lib/session";

type TournamentRoundProgress = Awaited<ReturnType<typeof getTournamentRounds>>[number];

type RankingEntry = {
  participant_id: string;
  display_name: string;
  final_rank: number | null;
  final_status?: "advanced" | "eliminated" | null;
  best_pass_percentage: number | string;
  failed_attempts_count: number;
  solved_at?: string | null;
  penalty_seconds?: number;
  total_time_seconds?: number | null;
};

const EMPTY_CASE: ProblemTestCase = { stdin: "", expected: "", is_sample: false };

// etiqueta de dificultad de una ronda; filtra los problemas del editor.
const DIFFICULTY_LABEL: Record<ProblemDifficulty, string> = {
  easy: "Fácil",
  medium: "Intermedio",
  hard: "Difícil",
};

const DIFFICULTY_CLASS: Record<ProblemDifficulty, string> = {
  easy: "bg-success-soft text-success",
  medium: "bg-info-soft text-info",
  hard: "bg-danger-soft text-danger",
};

// una fila del plan de rondas del torneo (pestaña Rondas).
type PlanRow = {
  id: string | null;
  round_number: number;
  difficulty: ProblemDifficulty;
  problemId: string;
  capacity: number;
  minutes: number;
  status: string;
};

// copia al portapapeles; si el navegador no deja, selecciona un textarea.
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  }
}

const ROUND_STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  active: "En curso",
  closing: "Cerrando",
  closed: "Cerrada",
};

type SubmissionRow = {
  id: string;
  display_name: string;
  language: string;
  verdict: string;
  test_cases_passed: number;
  test_cases_total: number;
  submitted_at: string;
};

const VERDICT_TONE_CLASS = {
  pending: "text-info",
  success: "text-success",
  danger: "text-danger",
} as const;

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

// El borrado masivo es una sola transacción: si el servidor respondió con un
// error, hizo ROLLBACK y no se borró nada. Sin respuesta (fetch tira TypeError)
// no se sabe, y la lista releída es la que manda.
function bulkDeleteFailure(error: unknown, fallback: string) {
  if (error instanceof TypeError) {
    return "No hubo respuesta del servidor. La lista se volvió a leer: muestra lo que quedó.";
  }
  return `${error instanceof Error ? error.message : fallback}. No se borró ninguno.`;
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatPercentage(value: number | string) {
  return `${Number(value).toLocaleString("es", { maximumFractionDigits: 2 })}%`;
}

/**
 * Ranking de una ronda. "Resultado" solo existe cuando la ronda cerró:
 * final_status lo escribe closeRound, y antes nadie está eliminado todavía.
 * Con la ronda abierta solo tiene posición quien ya resolvió; el resto no
 * recibe un número inventado.
 */
export function RoundRanking({ entries }: { entries: RankingEntry[] }) {
  const closed = entries.some((entry) => entry.final_status);
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Aún no hay ranking disponible.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="pb-3">Pos.</th>
          <th className="pb-3">Participante</th>
          {closed && <th className="pb-3">Resultado</th>}
          <th className="pb-3">Casos resueltos</th>
          <th className="pb-3">Fallos</th>
          <th className="pb-3">Tiempo</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {entries.map((entry, index) => {
          // Abierta: el servidor ordena primero a los que resolvieron, por
          // solved_at, así que su índice es su posición provisoria.
          const position = closed ? entry.final_rank : entry.solved_at ? index + 1 : null;
          return (
            <tr key={entry.participant_id}>
              <td className="py-2 font-mono">
                {position ?? <span className="text-muted-foreground">Sin posición</span>}
              </td>
              <td className="py-2 font-mono">{entry.display_name}</td>
              {closed && (
                <td className="py-2">
                  {entry.final_status === "advanced" ? (
                    <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
                      Clasificó
                    </span>
                  ) : (
                    <span className="rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger">
                      Eliminado
                    </span>
                  )}
                </td>
              )}
              <td className="py-2 font-mono tabular-nums">
                {formatPercentage(entry.best_pass_percentage)}
              </td>
              <td className="py-2">{entry.failed_attempts_count}</td>
              <td className="py-2 font-mono tabular-nums">
                {entry.solved_at === null ? (
                  <span className="text-muted-foreground">No resolvió</span>
                ) : (
                  formatTotalTime(entry.total_time_seconds, entry.penalty_seconds)
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
  const [tournaments, setTournaments] = useState<OpenTournament[]>([]);
  const [problemName, setProblemName] = useState("");
  const [problemStatement, setProblemStatement] = useState("");
  const [problemDifficulty, setProblemDifficulty] = useState<"easy" | "medium" | "hard">("easy");
  // is_sample marca los casos que ve el participante. Por defecto todo es privado.
  const [testCases, setTestCases] = useState<ProblemTestCase[]>([EMPTY_CASE]);
  // Casos importados de un .zip que no se muestran en el editor, pero se envían.
  // Nunca son ejemplo: el admin no los ve, así que no puede decidir publicarlos.
  const [hiddenCases, setHiddenCases] = useState<ProblemTestCase[]>([]);
  const [savingProblem, setSavingProblem] = useState(false);
  // Resultado del formulario de problemas. Se muestra junto al botón: el mensaje
  // general queda arriba de la lista, fuera de pantalla para quien guarda.
  const [problemFormMessage, setProblemFormMessage] = useState("");
  // Problema en edición. null = el formulario crea uno nuevo.
  const [editingProblem, setEditingProblem] = useState<ProblemDetail | null>(null);
  const [loadingProblemId, setLoadingProblemId] = useState("");
  // La lista va arriba del formulario: "Editar" lo trae a la vista.
  const problemFormRef = useRef<HTMLElement>(null);
  // Segundo paso antes de guardar un problema que se queda sin ejemplos públicos.
  const [confirmNoSamples, setConfirmNoSamples] = useState(false);
  // Confirmación de borrado: detail trae las rondas que usan el problema.
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    detail: ProblemDetail | null;
  } | null>(null);
  const [deletingProblem, setDeletingProblem] = useState(false);
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
  const [showNextForm, setShowNextForm] = useState(false);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(10);
  const [savingRound, setSavingRound] = useState(false);
  // Ronda que se está iniciando: deshabilita todos los "Iniciar" hasta que vuelva.
  const [startingRoundId, setStartingRoundId] = useState("");
  // Ronda pendiente con el "Borrar" abierto, y la que se está borrando.
  const [confirmDeleteRoundId, setConfirmDeleteRoundId] = useState("");
  const [deletingRoundId, setDeletingRoundId] = useState("");
  // Ronda pendiente en edición. El tiempo se edita en minutos, como al crearla,
  // y viaja en segundos.
  const [roundEdit, setRoundEdit] = useState<{
    id: string;
    roundNumber: number;
    problemId: string;
    capacity: number;
    minutes: number;
    maxCapacity: number | null;
  } | null>(null);
  const [savingRoundEdit, setSavingRoundEdit] = useState(false);
  // Historial: torneos terminados, pedidos aparte. null = todavía no se cargó.
  const [finishedTournaments, setFinishedTournaments] = useState<FinishedTournament[] | null>(null);
  const [confirmDeleteTournamentId, setConfirmDeleteTournamentId] = useState("");
  const [deletingTournamentId, setDeletingTournamentId] = useState("");
  // Usuarios huérfanos: primero se listan para revisar, después se borran.
  const [orphanUsers, setOrphanUsers] = useState<OrphanUser[] | null>(null);
  const [loadingOrphans, setLoadingOrphans] = useState(false);
  const [confirmDeleteOrphans, setConfirmDeleteOrphans] = useState(false);
  const [deletingOrphans, setDeletingOrphans] = useState(false);
  // Rondas del torneo terminado que se está mirando en Historial.
  const [historyRounds, setHistoryRounds] = useState<{
    tournamentId: string;
    rows: TournamentRoundProgress[] | null;
  } | null>(null);
  // Borrado masivo. La selección vive acá, en el panel, y no en la pestaña: los
  // TabsContent de Radix se desmontan al cambiar de pestaña, el panel no. Así la
  // selección sobrevive a ir y volver; se poda cuando la lista se relee (lo que ya
  // no existe o dejó de ser borrable sale) y se vacía después de borrar.
  // preview es la respuesta de la vista previa: cualquier cambio de selección la
  // descarta, así nunca se confirma sobre números de otra selección.
  const [selectedProblemIds, setSelectedProblemIds] = useState<Set<string>>(() => new Set());
  const [problemBulkPreview, setProblemBulkPreview] = useState<ProblemDeletePreview | null>(null);
  const [problemBulkBusy, setProblemBulkBusy] = useState(false);
  const [selectedTournamentIds, setSelectedTournamentIds] = useState<Set<string>>(() => new Set());
  const [tournamentBulkPreview, setTournamentBulkPreview] =
    useState<TournamentDeletePreview | null>(null);
  const [tournamentBulkBusy, setTournamentBulkBusy] = useState(false);
  const [leaderboard, setLeaderboard] = useState<RankingEntry[]>([]);
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
  // torneo que se administra en "Control de ronda".
  const [controlTournamentId, setControlTournamentId] = useState("");
  // participantes de la ronda que se muestra en Control (unidos y ranking).
  const [board, setBoard] = useState<RankingEntry[]>([]);
  // plan de rondas del torneo elegido en la pestaña Rondas.
  const [planTournamentId, setPlanTournamentId] = useState("");
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [planIndex, setPlanIndex] = useState(0);
  const [planDirty, setPlanDirty] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [newTournamentInput, setNewTournamentInput] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const displayedRound = liveRound;
  const serverOffsetMs = useServerClockOffset(setMessage);
  const remaining = useRoundTimer(displayedRound?.ends_at ?? 0, serverOffsetMs);
  const untilStart = useRoundTimer(displayedRound?.starts_at ?? 0, serverOffsetMs);
  const liveRoundId = displayedRound ? String(displayedRound.round_id) : "";
  // Id de la última ronda que el servidor dio por cerrada. Se compara contra la
  // mostrada: si el panel adopta otra ronda, deja de aplicar solo.
  const [closedRoundId, setClosedRoundId] = useState("");
  const roundClosed = liveRoundId !== "" && closedRoundId === liveRoundId;
  const countingDown = !roundClosed && untilStart > 0;

  const filtered = useMemo(
    () => liveParticipants.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [liveParticipants, query],
  );
  const solved = liveParticipants.filter((p) => p.solved).length;
  // los vencidos o invalidados no se muestran, aunque el servidor los mande.
  const visibleCodes = codes.filter(
    (code) =>
      code.status !== "expired" &&
      !(code.status === "unused" && code.expires_at && Date.parse(code.expires_at) <= Date.now()),
  );
  const unusedCodes = visibleCodes
    .filter((code) => code.status === "unused")
    .map((code) => code.code);
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

  const refreshFinishedTournaments = useMemo(
    () => async () => {
      try {
        setFinishedTournaments(await getFinishedTournaments());
      } catch {
        setFinishedTournaments([]);
      }
    },
    [],
  );

  useEffect(() => {
    void refreshFinishedTournaments();
  }, [refreshFinishedTournaments]);

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
    // así un código que vence desaparece de la lista sin recargar.
    const id = setInterval(() => void refreshCodes(), 15000);
    return () => clearInterval(id);
  }, [refreshCodes]);

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
            starts_at: remote.starts_at ? new Date(remote.starts_at).getTime() : 0,
            problem: remote.problem_name,
            capacity: remote.capacity,
          });
          setLiveParticipants(
            remote.participants.map((participant, index) => ({
              participant_id: participant.participant_id,
              name: participant.name,
              lane: index + 1,
              silk: participant.character,
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
  // el progreso es el del torneo elegido en Control de ronda.
  const progressTournamentId =
    controlTournamentId ||
    liveTournamentId ||
    tournaments.find((t) => t.name === tournamentName.trim() && t.status !== "finished")?.id ||
    "";

  // si no hay torneo elegido (o se terminó), se toma el de la ronda en
  // curso, o el primero abierto.
  useEffect(() => {
    if (controlTournamentId && tournaments.some((t) => t.id === controlTournamentId)) return;
    const fallback = liveTournamentId || tournaments[0]?.id || "";
    if (fallback !== controlTournamentId) setControlTournamentId(fallback);
  }, [tournaments, liveTournamentId, controlTournamentId]);

  const refreshRoundsProgress = useMemo(
    () => () => {
      if (!progressTournamentId) {
        setRoundsProgress(null);
        return;
      }
      void getTournamentRounds(progressTournamentId)
        .then(setRoundsProgress)
        .catch(() => setRoundsProgress([]));
    },
    [progressTournamentId],
  );

  useEffect(() => {
    refreshRoundsProgress();
  }, [refreshRoundsProgress, closedVersion]);

  // la ronda del torneo elegido que se controla.
  const currentRound = useMemo(() => {
    if (!roundsProgress?.length) return null;
    return (
      roundsProgress.find((r) => r.status === "active" || r.status === "closing") ??
      roundsProgress.find((r) => r.status === "pending") ??
      roundsProgress[roundsProgress.length - 1] ??
      null
    );
  }, [roundsProgress]);
  const currentRoundId = currentRound?.id ?? "";
  const ctrlRemaining = useRoundTimer(
    currentRound?.ends_at ? Date.parse(currentRound.ends_at) : 0,
    serverOffsetMs,
  );
  const ctrlUntilStart = useRoundTimer(
    currentRound?.starts_at ? Date.parse(currentRound.starts_at) : 0,
    serverOffsetMs,
  );
  const ctrlCountingDown = currentRound?.status === "active" && ctrlUntilStart > 0;

  // Cerrar la última ronda puede terminar el torneo: sale de los selectores y
  // entra al historial.
  useEffect(() => {
    if (closedVersion === 0) return;
    void refreshTournaments();
    void refreshFinishedTournaments();
  }, [closedVersion, refreshTournaments, refreshFinishedTournaments]);

  // Rondas del torneo elegido en "Configurar ronda". Si ya tiene alguna, ese
  // formulario no crea: la siguiente sale de "Avanzar", con los clasificados.
  // null mientras no se sabe.
  const formTournamentId =
    tournaments.find((t) => t.name === tournamentName.trim() && t.status !== "finished")?.id ?? "";
  const [formTournamentRounds, setFormTournamentRounds] = useState<number | null>(0);
  const refreshFormTournamentRounds = useMemo(
    () => () => {
      if (!formTournamentId) {
        setFormTournamentRounds(0);
        return;
      }
      setFormTournamentRounds(null);
      void getTournamentRounds(formTournamentId)
        .then((rows) => setFormTournamentRounds(rows.length))
        // Sin el dato no se bloquea: el backend igual rechaza con su motivo.
        .catch(() => setFormTournamentRounds(0));
    },
    [formTournamentId],
  );

  useEffect(() => {
    refreshFormTournamentRounds();
  }, [refreshFormTournamentRounds, closedVersion]);

  // El feed del socket no depende del torneo elegido: lee el refresco por ref
  // para no reconectarse cada vez que cambia.
  const refreshProgressRef = useRef(refreshRoundsProgress);
  refreshProgressRef.current = refreshRoundsProgress;

  // Se avanza desde la última ronda del torneo y solo cuando cerró: con la ronda
  // en curso no hay a quién pasar. Sale del progreso y no de la ronda activa, así
  // el botón sigue ahí aunque el admin recargue el panel después del cierre.
  const lastRound = roundsProgress?.length ? roundsProgress[roundsProgress.length - 1] : null;
  const advanceFromId = lastRound?.status === "closed" ? lastRound.id : "";

  useEffect(() => {
    setShowNextForm(false);
    if (!advanceFromId) {
      setNextRoundPreview(null);
      return;
    }
    let cancelled = false;
    void getNextRound(advanceFromId)
      .then((preview) => {
        if (cancelled) return;
        setNextRoundPreview(preview);
        // El cupo por defecto es "clasifican todos". El admin puede bajarlo
        // para eliminar más, nunca subirlo.
        setNextRoundCapacity(preview.advancingCount);
        // la ronda siguiente ya planificada trae su problema, cupo y tiempo.
        const planned = preview.existing as
          | (NonNullable<NextRoundPreview["existing"]> & {
              planned?: boolean;
              problem_id?: string | null;
              capacity?: number;
              time_limit_seconds?: number;
            })
          | null;
        if (planned?.planned) {
          if (planned.problem_id) setSelectedProblem(planned.problem_id);
          if (planned.capacity)
            setNextRoundCapacity(Math.min(planned.capacity, preview.advancingCount));
          if (planned.time_limit_seconds) setTimeLimitMinutes(planned.time_limit_seconds / 60);
        }
      })
      .catch(() => {
        if (!cancelled) setNextRoundPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [advanceFromId]);

  const socketRoundId = currentRoundId || (liveRound ? String(liveRound.round_id) : undefined);

  // participantes de la ronda controlada (los que ya se unieron, aunque
  // no haya empezado) con el ranking. Se relee cada 2 s junto con el progreso.
  useEffect(() => {
    if (!currentRoundId) {
      setBoard([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      void getRoundLeaderboard(currentRoundId)
        .then((rows) => {
          if (!cancelled) setBoard(rows);
        })
        .catch(() => undefined);
    load();
    const id = setInterval(() => {
      load();
      refreshProgressRef.current();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [currentRoundId]);

  useEffect(() => {
    const roundId = socketRoundId ?? "";
    let cancelled = false;
    // La cola es de una sola ronda: al cambiar se vacía y se vuelve a sembrar.
    setSubmissions([]);
    // Siembra desde la base. Cubre lo enviado antes de abrir el panel y lo que
    // se perdió con el socket caído: se llama en cada (re)conexión.
    const seedSubmissions = () => {
      if (!roundId) return;
      void getRoundSubmissions(roundId)
        .then((rows) => {
          if (!cancelled) setSubmissions((current) => mergeSubmissions(current, rows));
        })
        .catch(() => {
          if (!cancelled) setMessage("No se pudo cargar la cola de envíos.");
        });
    };
    // Sin ronda el socket igual se conecta, para enterarse de round:started.
    const feed = createSocketFeed(socketRoundId);
    if (!feed) {
      seedSubmissions();
      return () => {
        cancelled = true;
      };
    }
    feed.on("feed:connected", () => {
      seedSubmissions();
      refreshQueueStats();
      // Con el socket caído se pudo perder round:started de otra ronda (otro
      // admin, otra pestaña): se vuelve a preguntar cuál es la activa.
      void getActiveRound()
        .then((active) => {
          if (cancelled || !active || active.id === roundId) return;
          loadActiveRound();
          refreshProgressRef.current();
        })
        .catch(() => undefined);
    });
    // submission:queued sale a todos los sockets, de cualquier ronda: el filtro
    // evita mezclar la cola con la de otro torneo.
    feed.on("submission:queued", (event) => {
      // Sin ronda conocida, un envío en cola significa que hay una ronda activa
      // que el panel no cargó: se adopta, y su cola se siembra al cambiar.
      if (!roundId) {
        loadActiveRound();
        return;
      }
      if (event.round_id !== roundId) return;
      const { display_name: displayName, language, submitted_at: submittedAt } = event;
      // El worker reemite judge_error sin nombre: solo actualiza una fila existente.
      if (displayName && language && submittedAt) {
        setSubmissions((current) =>
          upsertSubmission(current, {
            id: event.id,
            display_name: displayName,
            language,
            verdict: event.verdict,
            test_cases_passed: 0,
            test_cases_total: 0,
            submitted_at: submittedAt,
          }),
        );
      } else {
        setSubmissions((current) =>
          current.map((row) => (row.id === event.id ? { ...row, verdict: event.verdict } : row)),
        );
      }
      refreshQueueStats();
    });
    // El veredicto final, por id de envío.
    feed.on("submission:judged", (event) => {
      if (event.round_id !== roundId) return;
      setSubmissions((current) =>
        upsertSubmission(current, {
          id: event.id,
          display_name: event.display_name,
          language: event.language,
          verdict: event.verdict,
          test_cases_passed: event.test_cases_passed,
          test_cases_total: event.test_cases_total,
          submitted_at: event.submitted_at,
        }),
      );
      refreshQueueStats();
    });
    feed.on("participant:progress", (progress) => {
      // La penalización y el orden solo se conocen al terminar el job.
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
    // participant:joined no trae el personaje: se relee la ronda activa, que
    // además refresca el ranking.
    feed.on("participant:joined", (joined) => {
      if (joined.round_id !== roundId) return;
      loadActiveRound();
    });
    feed.on("round:started", (started) => {
      if (started.round_id !== roundId) loadActiveRound();
      refreshProgressRef.current();
      refreshQueueStats();
    });
    feed.on("round:paused", (roundState) => setPaused(Boolean(roundState.paused)));
    feed.on("round:closed", (event) => {
      // Sale a todos los sockets: el cierre de otra ronda no es el de esta. Sin
      // round_id (backend viejo) se asume la propia, como antes.
      if (event.round_id && event.round_id !== roundId) return;
      if (roundId) setClosedRoundId(roundId);
      setMessage("La ronda se cerró");
      setPaused(false);
      setClosedVersion((version) => version + 1);
      refreshQueueStats();
      if (!roundId) return;
      void getRoundLeaderboard(roundId)
        .then(setLeaderboard)
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      feed.disconnect();
    };
  }, [socketRoundId, refreshQueueStats, loadActiveRound]);

  const allCases = [...testCases, ...hiddenCases];
  const sampleCount = allCases.filter((testCase) => testCase.is_sample).length;
  const originalSampleCount = editingProblem
    ? editingProblem.test_cases.filter((testCase) => testCase.is_sample === true).length
    : 0;

  const resetProblemForm = () => {
    setEditingProblem(null);
    setConfirmNoSamples(false);
    setProblemName("");
    setProblemStatement("");
    setProblemDifficulty("easy");
    setTestCases([EMPTY_CASE]);
    setHiddenCases([]);
    setProblemFormMessage("");
  };

  // Relee la lista del servidor. La lista de problemas y los dos selectores de
  // ronda leen de este mismo estado.
  const refreshProblems = async (keepSelected: string) => {
    const items = await getProblems();
    setProblems(items);
    setSelectedProblem(
      items.some((item) => item.id === keepSelected) ? keepSelected : (items[0]?.id ?? ""),
    );
  };

  const saveProblem = async () => {
    setProblemFormMessage("");
    if (!problemName.trim() || !problemStatement.trim()) {
      setProblemFormMessage("Completa el nombre y el enunciado.");
      return;
    }
    // La entrada puede ir vacía: un problema sin stdin es válido y el backend lo
    // acepta. La salida esperada, no.
    const incomplete = allCases.findIndex((testCase) => !testCase.expected.trim());
    if (incomplete !== -1) {
      setProblemFormMessage(`Completa la salida esperada del caso ${incomplete + 1}.`);
      return;
    }
    // Quitar el último ejemplo público pide un segundo clic: el participante deja
    // de ver ejemplos y nada más lo avisa.
    if (editingProblem && sampleCount === 0 && originalSampleCount > 0 && !confirmNoSamples) {
      setConfirmNoSamples(true);
      return;
    }
    setSavingProblem(true);
    const input = {
      name: problemName.trim(),
      statement: problemStatement.trim(),
      difficulty: problemDifficulty,
      // El array completo, con is_sample en cada caso: el backend guarda false si
      // falta.
      testCases: allCases.map((testCase) => ({
        stdin: testCase.stdin,
        expected: testCase.expected,
        is_sample: testCase.is_sample,
      })),
    };
    // Medir antes de enviar: el proxy corta la subida con un 413 que no explica
    // el motivo. Blob mide los bytes UTF-8 reales, que es lo que cuenta el servidor.
    const payloadBytes = new Blob([JSON.stringify(input)]).size;
    if (payloadBytes > MAX_PROBLEM_PAYLOAD_BYTES) {
      setProblemFormMessage(
        `Este problema mide ${(payloadBytes / (1024 * 1024)).toFixed(1)} MB y el máximo son 16 MB. ` +
          "Reducí los casos o partilo en problemas más chicos.",
      );
      setSavingProblem(false);
      return;
    }
    try {
      let done: string;
      let keepSelected = selectedProblem;
      if (editingProblem) {
        const saved = await updateProblem(editingProblem.id, input);
        done = `Problema “${saved.name}” guardado. ${sampleCount} de ${allCases.length} casos son ejemplo público.`;
      } else {
        const created = await createProblem(input);
        keepSelected = created.id;
        done = `Problema “${created.name}” creado y seleccionado.`;
      }
      resetProblemForm();
      // Ya se guardó: si falla releer la lista, se avisa sin decir que no se guardó.
      await refreshProblems(keepSelected).catch(() => {
        done += " No se pudo actualizar la lista; recargá la página.";
      });
      setMessage(done);
      setProblemFormMessage(done);
    } catch (error) {
      setProblemFormMessage(
        error instanceof Error ? error.message : "No se pudo guardar el problema",
      );
    } finally {
      setSavingProblem(false);
    }
  };

  // Prellena el formulario con el problema completo, is_sample incluido. Sin eso
  // el guardado desmarcaría todos los ejemplos sin aviso.
  const editProblem = async (problemId: string) => {
    setLoadingProblemId(problemId);
    try {
      const detail = await getProblemDetail(problemId);
      setEditingProblem(detail);
      setConfirmNoSamples(false);
      setDeleteTarget(null);
      setProblemName(detail.name);
      setProblemStatement(detail.statement);
      setProblemDifficulty(detail.difficulty);
      const cases = detail.test_cases.map((testCase) => ({
        stdin: String(testCase.stdin ?? ""),
        expected: String(testCase.expected ?? ""),
        is_sample: testCase.is_sample === true,
      }));
      // Todos a la vista: un ejemplo oculto no se podría desmarcar.
      setTestCases(cases.length ? cases : [EMPTY_CASE]);
      setHiddenCases([]);
      setProblemFormMessage("");
      setMessage(`Editando “${detail.name}”.`);
      problemFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar el problema");
    } finally {
      setLoadingProblemId("");
    }
  };

  const askDeleteProblem = async (problem: { id: string; name: string }) => {
    setDeleteTarget({ id: problem.id, name: problem.name, detail: null });
    try {
      const detail = await getProblemDetail(problem.id);
      setDeleteTarget((current) => (current?.id === problem.id ? { ...current, detail } : current));
    } catch (error) {
      setDeleteTarget(null);
      setMessage(error instanceof Error ? error.message : "No se pudo consultar el problema");
    }
  };

  const confirmDeleteProblem = async () => {
    if (!deleteTarget) return;
    setDeletingProblem(true);
    try {
      await deleteProblem(deleteTarget.id);
      if (editingProblem?.id === deleteTarget.id) resetProblemForm();
      setDeleteTarget(null);
      let done = `Problema “${deleteTarget.name}” eliminado.`;
      await refreshProblems(selectedProblem).catch(() => {
        done += " No se pudo actualizar la lista; recargá la página.";
      });
      setMessage(done);
    } catch (error) {
      // El 409 trae el motivo del servidor: se muestra tal cual.
      setMessage(error instanceof Error ? error.message : "No se pudo borrar el problema");
    } finally {
      setDeletingProblem(false);
    }
  };

  // Libera el problema borrando una ronda que todavía no se jugó.
  const removePendingRound = async (roundId: string, roundNumber: number) => {
    if (!deleteTarget) return;
    setDeletingProblem(true);
    try {
      await deleteRound(roundId);
      setMessage(`Ronda ${roundNumber} pendiente borrada.`);
      refreshRoundsProgress();
      const detail = await getProblemDetail(deleteTarget.id);
      setDeleteTarget((current) =>
        current?.id === deleteTarget.id ? { ...current, detail } : current,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo borrar la ronda");
    } finally {
      setDeletingProblem(false);
    }
  };

  const importTestCases = async (file: File) => {
    try {
      const parsed = await parseCodeforcesZip(file);
      if (parsed.length > 100) {
        setProblemFormMessage(`El .zip tiene ${parsed.length} casos y el máximo es 100.`);
        return;
      }
      // Los dos primeros quedan visibles y editables; el resto se envía oculto.
      const imported = parsed.map((testCase) => ({ ...testCase, is_sample: false }));
      setTestCases(imported.slice(0, 2));
      setHiddenCases(imported.slice(2));
      setProblemFormMessage(
        parsed.length > 2
          ? `Se importaron ${parsed.length} casos: 2 en el editor y ${parsed.length - 2} ocultos. Ninguno es ejemplo público hasta que lo marques.`
          : `Se importaron ${parsed.length} casos. Ninguno es ejemplo público hasta que lo marques.`,
      );
    } catch (error) {
      setProblemFormMessage(
        error instanceof Error
          ? `No se pudo leer el .zip: ${error.message}`
          : "No se pudo leer el .zip",
      );
    }
  };

  const clearTestCases = () => {
    setTestCases([EMPTY_CASE]);
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
      // Reusa el torneo con el mismo nombre mientras no esté finalizado. Si ya
      // tiene rondas, el backend rechaza con el motivo: las siguientes se crean
      // con "Avanzar a la siguiente ronda", que inscribe a los clasificados.
      const existing = tournaments.find((t) => t.name === name && t.status !== "finished");
      const tournament = existing ?? (await createTournament(name));

      // Crear no inicia: la ronda queda pendiente y se inicia desde "Progreso
      // del torneo", donde se respeta el orden de las rondas.
      await createRound(
        tournament.id,
        roundNumber,
        selectedProblem,
        capacity,
        timeLimitMinutes * 60,
      );
      void refreshTournaments();
      refreshRoundsProgress();
      refreshFormTournamentRounds();
      setMessage(
        `Ronda ${roundNumber} de "${name}" creada. Quedó pendiente: iniciala desde Progreso del torneo.`,
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
        {
          id: created.id,
          name: created.name,
          status: "pending",
          created_at: new Date().toISOString(),
          rounds_count: 0,
          played_rounds_count: 0,
        },
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
      const created = await createNextRound(advanceFromId, {
        problemId: selectedProblem,
        capacity: nextRoundCapacity || null,
        timeLimitSeconds: timeLimitMinutes * 60,
      });
      setNextRoundPreview(null);
      setShowNextForm(false);
      refreshRoundsProgress();
      setMessage(
        `Ronda ${created.round.round_number} creada con ${created.participants} participantes. Quedó pendiente: iniciala desde Progreso del torneo.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear la ronda siguiente");
    } finally {
      setSavingNextRound(false);
    }
  };

  // Solo rondas pendientes: el backend rechaza las que ya empezaron. Es la
  // salida para una ronda creada con otro problema o sin participantes.
  const removeRound = async (roundId: string, roundNumber: number) => {
    setDeletingRoundId(roundId);
    try {
      await deleteRound(roundId);
      setMessage(`Ronda ${roundNumber} borrada.`);
      refreshFormTournamentRounds();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo borrar la ronda");
    } finally {
      setDeletingRoundId("");
      setConfirmDeleteRoundId("");
      refreshRoundsProgress();
    }
  };

  const openRoundEdit = (r: TournamentRoundProgress) => {
    // Una ronda siguiente ya tiene el roster armado: el cupo no puede pasarlo. La
    // primera se llena al iniciarse, así que ahí no hay techo.
    const hasPrevious = (roundsProgress ?? []).some((o) => o.round_number < r.round_number);
    setConfirmDeleteRoundId("");
    setRoundEdit({
      id: r.id,
      roundNumber: r.round_number,
      problemId: r.problem_id ?? problems[0]?.id ?? "",
      capacity: r.capacity,
      minutes: r.time_limit_seconds / 60,
      maxCapacity: hasPrevious ? r.participants_count : null,
    });
  };

  const saveRoundEdit = async () => {
    if (!roundEdit) return;
    const seconds = Math.round(roundEdit.minutes * 60);
    if (!roundEdit.problemId) {
      setMessage("Elegí un problema para la ronda.");
      return;
    }
    if (!Number.isInteger(roundEdit.capacity) || roundEdit.capacity < 1) {
      setMessage("El cupo tiene que ser un entero desde 1.");
      return;
    }
    if (roundEdit.maxCapacity !== null && roundEdit.capacity > roundEdit.maxCapacity) {
      setMessage(`El cupo no puede ser mayor que los ${roundEdit.maxCapacity} inscriptos.`);
      return;
    }
    if (!(seconds >= 10 && seconds <= 86400)) {
      setMessage("El tiempo límite tiene que estar entre 10 segundos y 24 horas.");
      return;
    }
    setSavingRoundEdit(true);
    try {
      await updateRound(roundEdit.id, {
        problemId: roundEdit.problemId,
        capacity: roundEdit.capacity,
        timeLimitSeconds: seconds,
      });
      setMessage(`Ronda ${roundEdit.roundNumber} guardada.`);
      setRoundEdit(null);
    } catch (error) {
      // El 409 dice por qué: otro admin la inició, o el cupo pasa a los inscriptos.
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la ronda");
    } finally {
      setSavingRoundEdit(false);
      refreshRoundsProgress();
    }
  };

  const removeTournament = async (tournament: FinishedTournament) => {
    setDeletingTournamentId(tournament.id);
    try {
      const result = await deleteTournament(tournament.id);
      setMessage(
        `Torneo “${tournament.name}” borrado: ${result.rounds} rondas, ${result.participants} participantes y ${result.submissions} envíos.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo borrar el torneo");
    } finally {
      setDeletingTournamentId("");
      setConfirmDeleteTournamentId("");
      void refreshFinishedTournaments();
      setOrphanUsers(null);
    }
  };

  const toggleHistoryRounds = (tournamentId: string) => {
    if (historyRounds?.tournamentId === tournamentId) {
      setHistoryRounds(null);
      return;
    }
    setHistoryRounds({ tournamentId, rows: null });
    void getTournamentRounds(tournamentId)
      .then((rows) =>
        setHistoryRounds((current) =>
          current?.tournamentId === tournamentId ? { tournamentId, rows } : current,
        ),
      )
      .catch(() => {
        setHistoryRounds(null);
        setMessage("No se pudieron cargar las rondas del torneo.");
      });
  };

  const loadOrphanUsers = async () => {
    setLoadingOrphans(true);
    setConfirmDeleteOrphans(false);
    try {
      setOrphanUsers(await getOrphanUsers());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los usuarios");
    } finally {
      setLoadingOrphans(false);
    }
  };

  const removeOrphanUsers = async () => {
    if (!orphanUsers?.length) return;
    setDeletingOrphans(true);
    try {
      // Solo los que el admin tiene a la vista, nunca "todos los huérfanos".
      const result = await deleteOrphanUsers(orphanUsers.map((user) => user.id));
      const skipped = orphanUsers.length - result.deleted;
      setMessage(
        `${result.deleted} usuarios borrados.` +
          (skipped ? ` ${skipped} ya no eran huérfanos y se conservaron.` : ""),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron borrar los usuarios");
    } finally {
      setDeletingOrphans(false);
      setConfirmDeleteOrphans(false);
      void loadOrphanUsers();
    }
  };

  // Todos los torneos en una sola lista: abiertos primero, después terminados. Un
  // abierto con rondas jugadas no tiene casilla: el backend igual lo rechazaría.
  const tournamentRows = useMemo(
    () => [
      ...tournaments.map((t) => ({
        id: t.id,
        name: t.name,
        created_at: t.created_at,
        finished: null as FinishedTournament | null,
        blockReason:
          t.played_rounds_count > 0
            ? "Abierto y con rondas jugadas: finalizalo para poder borrarlo."
            : null,
      })),
      ...(finishedTournaments ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        created_at: t.created_at,
        finished: t as FinishedTournament | null,
        blockReason: null as string | null,
      })),
    ],
    [tournaments, finishedTournaments],
  );
  const deletableTournamentIds = useMemo(
    () => tournamentRows.filter((row) => !row.blockReason).map((row) => row.id),
    [tournamentRows],
  );
  const problemIds = useMemo(() => problems.map((problem) => problem.id), [problems]);

  // Poda: al releer las listas, lo que ya no existe o dejó de ser borrable sale
  // de la selección, y la vista previa, que era de otra selección, se descarta.
  useEffect(() => {
    const present = new Set(deletableTournamentIds);
    if ([...selectedTournamentIds].every((id) => present.has(id))) return;
    setSelectedTournamentIds(new Set([...selectedTournamentIds].filter((id) => present.has(id))));
    setTournamentBulkPreview(null);
  }, [deletableTournamentIds, selectedTournamentIds]);

  useEffect(() => {
    const present = new Set(problemIds);
    if ([...selectedProblemIds].every((id) => present.has(id))) return;
    setSelectedProblemIds(new Set([...selectedProblemIds].filter((id) => present.has(id))));
    setProblemBulkPreview(null);
  }, [problemIds, selectedProblemIds]);

  const changeProblemSelection = (next: Set<string>) => {
    setSelectedProblemIds(next);
    setProblemBulkPreview(null);
  };

  const changeTournamentSelection = (next: Set<string>) => {
    setSelectedTournamentIds(next);
    setTournamentBulkPreview(null);
  };

  // Primer paso: la vista previa. No borra nada.
  const askBulkDeleteProblems = async () => {
    if (selectedProblemIds.size === 0) return;
    setProblemBulkBusy(true);
    try {
      setProblemBulkPreview(await previewProblemsDelete([...selectedProblemIds]));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo preparar el borrado");
    } finally {
      setProblemBulkBusy(false);
    }
  };

  // Segundo paso: borra solo los que la vista previa dio por borrables. El
  // servidor vuelve a decidir con las filas bloqueadas; lo que cambió desde la
  // vista previa vuelve en skipped y no se borra.
  const confirmBulkDeleteProblems = async () => {
    const preview = problemBulkPreview;
    if (!preview || preview.deletable.length === 0) return;
    setProblemBulkBusy(true);
    try {
      const result = await deleteProblems(preview.deletable.map((problem) => problem.id));
      const deletedIds = new Set(result.deleted.map((problem) => problem.id));
      if (editingProblem && deletedIds.has(editingProblem.id)) resetProblemForm();
      if (deleteTarget && deletedIds.has(deleteTarget.id)) setDeleteTarget(null);
      const reasons = [...preview.blocked, ...result.skipped].map((problem) => problem.reason);
      const notDeleted =
        preview.blocked.length +
        preview.missing.length +
        result.skipped.length +
        result.missing.length;
      let done =
        `Se borraron ${countLabel(result.deleted.length, "problema", "problemas")}.` +
        (notDeleted
          ? ` No se borraron ${notDeleted}${reasons.length ? `: ${reasons.join(" ")}` : " (ya no existían)."}`
          : "");
      setSelectedProblemIds(new Set());
      setProblemBulkPreview(null);
      await refreshProblems(selectedProblem).catch(() => {
        done += " No se pudo actualizar la lista; recargá la página.";
      });
      setMessage(done);
    } catch (error) {
      setMessage(bulkDeleteFailure(error, "No se pudieron borrar los problemas"));
      void refreshProblems(selectedProblem).catch(() => undefined);
    } finally {
      setProblemBulkBusy(false);
    }
  };

  const askBulkDeleteTournaments = async () => {
    if (selectedTournamentIds.size === 0) return;
    setTournamentBulkBusy(true);
    try {
      setTournamentBulkPreview(await previewTournamentsDelete([...selectedTournamentIds]));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo preparar el borrado");
    } finally {
      setTournamentBulkBusy(false);
    }
  };

  const confirmBulkDeleteTournaments = async () => {
    const preview = tournamentBulkPreview;
    if (!preview || preview.deletable.length === 0) return;
    setTournamentBulkBusy(true);
    try {
      const result = await deleteTournaments(preview.deletable.map((row) => row.id));
      const deletedIds = new Set(result.deleted.map((row) => row.id));
      const deletedNames = new Set(result.deleted.map((row) => row.name));
      // Lo que apuntaba a un torneo borrado vuelve a "ninguno".
      if (deletedIds.has(codeTournamentId)) setCodeTournamentId("");
      if (historyRounds && deletedIds.has(historyRounds.tournamentId)) setHistoryRounds(null);
      if (deletedIds.has(confirmDeleteTournamentId)) setConfirmDeleteTournamentId("");
      if (deletedNames.has(tournamentName.trim())) setTournamentName("");
      const { totals } = result;
      const skipped = [...preview.blocked, ...result.skipped];
      const notDeleted = skipped.length + preview.missing.length + result.missing.length;
      setMessage(
        `Se borraron ${countLabel(totals.tournaments, "torneo", "torneos")}, ` +
          `${countLabel(totals.rounds, "ronda", "rondas")}, ` +
          `${countLabel(totals.participants, "participante", "participantes")}, ` +
          `${countLabel(totals.submissions, "envío", "envíos")} y ` +
          `${countLabel(totals.access_codes, "código de acceso", "códigos de acceso")}.` +
          (notDeleted
            ? ` No se borraron ${notDeleted}${skipped.length ? `: ${skipped.map((row) => row.reason).join(" ")}` : " (ya no existían)."}`
            : ""),
      );
      setSelectedTournamentIds(new Set());
      setTournamentBulkPreview(null);
    } catch (error) {
      setMessage(bulkDeleteFailure(error, "No se pudieron borrar los torneos"));
    } finally {
      setTournamentBulkBusy(false);
      void refreshTournaments();
      void refreshFinishedTournaments();
      setOrphanUsers(null);
    }
  };

  // ---------- Plan de rondas (pestaña Rondas) ----------
  const firstProblemOf = (difficulty: ProblemDifficulty) =>
    problems.find((problem) => problem.difficulty === difficulty)?.id ?? "";

  const loadPlan = useMemo(
    () => async (tournamentId: string) => {
      if (!tournamentId) {
        setPlan([]);
        return;
      }
      try {
        const rows = await getTournamentRounds(tournamentId);
        const next: PlanRow[] = rows.map((r) => ({
          id: r.id,
          round_number: r.round_number,
          difficulty: (r.difficulty ?? "easy") as ProblemDifficulty,
          problemId: r.problem_id ?? "",
          capacity: r.capacity,
          minutes: r.time_limit_seconds / 60,
          status: r.status,
        }));
        setPlan(next);
        setPlanDirty(false);
        setPlanIndex((index) => Math.min(index, Math.max(0, next.length - 1)));
      } catch {
        setPlan([]);
      }
    },
    [],
  );

  useEffect(() => {
    void loadPlan(planTournamentId);
  }, [planTournamentId, loadPlan]);

  // Arranca con el torneo que se administra en Control: el editor ya queda activo.
  useEffect(() => {
    if (!planTournamentId && controlTournamentId) setPlanTournamentId(controlTournamentId);
  }, [planTournamentId, controlTournamentId]);

  // "Crear torneo" siempre está activo: crea y lo deja elegido para configurar.
  const createTournamentAndSelect = async () => {
    const name = newTournamentInput.trim();
    if (!name) {
      setMessage("Indica un nombre para el torneo.");
      return;
    }
    setSavingTournament(true);
    try {
      const created = await createTournament(name);
      setNewTournamentInput("");
      await refreshTournaments();
      setPlanTournamentId(created.id);
      setPlan([
        {
          id: null,
          round_number: 1,
          difficulty: "easy",
          problemId: firstProblemOf("easy"),
          capacity: 8,
          minutes: 10,
          status: "pending",
        },
      ]);
      setPlanDirty(true);
      setPlanIndex(0);
      setMessage(`Torneo “${created.name}” creado. Configurá sus rondas y guardalas.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear el torneo");
    } finally {
      setSavingTournament(false);
    }
  };

  const updatePlanRow = (index: number, patch: Partial<PlanRow>) => {
    setPlan((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setPlanDirty(true);
  };

  const addPlanRound = () => {
    const last = plan[plan.length - 1];
    const difficulty: ProblemDifficulty = !last
      ? "easy"
      : last.difficulty === "easy"
        ? "medium"
        : "hard";
    setPlan([
      ...plan,
      {
        id: null,
        round_number: (last?.round_number ?? 0) + 1,
        difficulty,
        problemId: firstProblemOf(difficulty),
        capacity: Math.max(1, Math.floor((last?.capacity ?? 8) / 2)),
        minutes: (last?.minutes ?? 10) + 5,
        status: "pending",
      },
    ]);
    setPlanIndex(plan.length);
    setPlanDirty(true);
  };

  const removeLastPlanRound = () => {
    const last = plan[plan.length - 1];
    if (!last || last.status !== "pending") return;
    setPlan(plan.slice(0, -1));
    setPlanIndex((index) => Math.min(index, plan.length - 2));
    setPlanDirty(true);
  };

  // Todas las rondas de una vez. Solo viajan las pendientes.
  const savePlan = async () => {
    if (!planTournamentId) return;
    const missing = plan.find((row) => row.status === "pending" && !row.problemId);
    if (missing) {
      setMessage(`Elegí un problema para la ronda ${missing.round_number}.`);
      setPlanIndex(plan.indexOf(missing));
      return;
    }
    setSavingPlan(true);
    try {
      await saveTournamentPlan(
        planTournamentId,
        plan
          .filter((row) => row.status === "pending")
          .map((row) => ({
            round_number: row.round_number,
            difficulty: row.difficulty,
            problemId: row.problemId,
            capacity: row.capacity,
            timeLimitSeconds: Math.round(row.minutes * 60),
          })),
      );
      await loadPlan(planTournamentId);
      refreshRoundsProgress();
      void refreshTournaments();
      setMessage(`Se guardaron las ${countLabel(plan.length, "ronda", "rondas")} del torneo.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el plan");
    } finally {
      setSavingPlan(false);
    }
  };

  // Una sola ronda: si ya existe se guarda sola; si es nueva, va con el plan.
  const savePlanRow = async (index: number) => {
    const row = plan[index];
    if (!row) return;
    if (!row.id) {
      await savePlan();
      return;
    }
    setSavingPlan(true);
    try {
      await updateRound(row.id, {
        problemId: row.problemId,
        capacity: row.capacity,
        timeLimitSeconds: Math.round(row.minutes * 60),
        difficulty: row.difficulty,
      });
      await loadPlan(planTournamentId);
      refreshRoundsProgress();
      setMessage(`Ronda ${row.round_number} guardada.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la ronda");
    } finally {
      setSavingPlan(false);
    }
  };

  // ---------- Copiar códigos (solo los que están sin usar) ----------
  const copyCodes = async (key: string, list: string[]) => {
    if (list.length === 0) return;
    const done = await copyText(list.join("\n"));
    setCopiedKey(done ? key : "");
    setMessage(
      done
        ? `${countLabel(list.length, "código copiado", "códigos copiados")}.`
        : "No se pudo copiar.",
    );
    setTimeout(() => setCopiedKey((current) => (current === key ? "" : current)), 1500);
  };

  // Solo hace el POST de inicio: el roster de la ronda ya lo armó quien la creó.
  const beginRound = async (roundId: string) => {
    setStartingRoundId(roundId);
    try {
      await startRound(roundId);
      setMessage("Ronda iniciada");
      loadActiveRound();
      refreshQueueStats();
    } catch (error) {
      // El 409 nombra la ronda que falta cerrar.
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar la ronda");
    } finally {
      setStartingRoundId("");
      refreshRoundsProgress();
    }
  };

  return (
    <Tabs defaultValue="control">
      <TabsList>
        {(
          [
            ["control", "Control de ronda", "gamepad"],
            ["pista", "Pista", "flag"],
            ["rondas", "Rondas", "play"],
            ["problemas", "Problemas", "code"],
            ["acceso", "Acceso", "users"],
            ["historial", "Historial", "star"],
          ] as Array<[string, string, PixelIconName]>
        ).map(([value, label, icon]) => (
          <TabsTrigger key={value} value={value} className="gap-1.5">
            <PixelIcon name={icon} className="h-4 w-4" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="control">
        {/* distribución control de ronda + cola a la izquierda, progreso a la derecha. */}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <section className="rounded-xl border border-border bg-card">
              <div className="space-y-5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <label className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                      Torneo
                      <select
                        value={controlTournamentId}
                        onChange={(event) => setControlTournamentId(event.target.value)}
                        className="rounded-lg border border-input bg-background px-2 py-1 text-sm normal-case tracking-normal text-foreground outline-none focus:border-ring"
                      >
                        {tournaments.length === 0 && (
                          <option value="">No hay torneos abiertos</option>
                        )}
                        {tournaments.map((tournament) => (
                          <option key={tournament.id} value={tournament.id}>
                            {tournament.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <h2 className="text-lg font-semibold text-foreground">
                      {currentRound
                        ? `Ronda ${currentRound.round_number} · ${currentRound.problem_name ?? "sin problema"}`
                        : "Sin rondas en este torneo"}
                    </h2>
                    {currentRound && (
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                          {currentRound.paused
                            ? "Pausada"
                            : (ROUND_STATUS_LABEL[currentRound.status] ?? currentRound.status)}
                        </span>
                        {currentRound.difficulty && (
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${DIFFICULTY_CLASS[currentRound.difficulty]}`}
                          >
                            {DIFFICULTY_LABEL[currentRound.difficulty]}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-4xl font-semibold tabular-nums text-foreground">
                      {!currentRound
                        ? "--:--"
                        : currentRound.status === "closed"
                          ? "Cerrada"
                          : currentRound.status === "pending"
                            ? formatClock(currentRound.time_limit_seconds * 1000)
                            : formatClock(
                                ctrlCountingDown && currentRound.starts_at && currentRound.ends_at
                                  ? Date.parse(currentRound.ends_at) -
                                      Date.parse(currentRound.starts_at)
                                  : ctrlRemaining,
                              )}
                    </p>
                    {ctrlCountingDown && (
                      <p role="timer" className="mt-1 font-mono text-sm font-semibold text-info">
                        Empieza en {formatClock(Math.ceil(ctrlUntilStart / 1000) * 1000)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat label="Cupo" value={currentRound ? currentRound.capacity : "—"} />
                  <Stat
                    label={currentRound?.status === "pending" ? "Conectados" : "Inscriptos"}
                    value={board.length}
                  />
                  <Stat
                    label="Resolvieron"
                    value={board.filter((entry) => entry.solved_at).length}
                  />
                  <Stat
                    label="Envíos"
                    value={queueStats?.round?.id === currentRoundId ? queueStats.round.total : 0}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {currentRound?.status === "pending" && (
                    <button
                      type="button"
                      disabled={
                        Boolean(currentRound.start_blocked_reason) || startingRoundId !== ""
                      }
                      onClick={() => void beginRound(currentRound.id)}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {startingRoundId === currentRound.id
                        ? "Iniciando..."
                        : `Iniciar ronda ${currentRound.round_number} (cuenta de 10 s)`}
                    </button>
                  )}
                  <button
                    disabled={currentRound?.status !== "active"}
                    onClick={() => {
                      void toggleRoundPause(currentRoundId)
                        .then(() => refreshRoundsProgress())
                        .catch((error) =>
                          setMessage(
                            error instanceof Error ? error.message : "No se pudo pausar la ronda",
                          ),
                        );
                    }}
                    className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    {currentRound?.paused ? "Reanudar ronda" : "Pausar ronda"}
                  </button>
                  <button
                    disabled={currentRound?.status !== "active"}
                    onClick={() => {
                      void closeRound(currentRoundId)
                        .then(() => {
                          setMessage("Ronda cerrada");
                          setClosedVersion((version) => version + 1);
                          refreshQueueStats();
                        })
                        .catch((error) => setMessage(error.message));
                    }}
                    className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-danger-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Forzar cierre
                  </button>
                  {currentRound?.status === "pending" && currentRound.start_blocked_reason && (
                    <p className="text-xs text-muted-foreground">
                      {currentRound.start_blocked_reason}
                    </p>
                  )}
                  {message && <p className="text-xs text-muted-foreground">{message}</p>}
                </div>
              </div>

              {/* ranking y participantes de la ronda, en una sola tabla. */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {currentRound?.status === "pending"
                    ? "Participantes conectados, esperando el inicio"
                    : "Ranking y participantes"}
                </h3>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar participante…"
                  className="w-56 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Pos.</th>
                      <th className="px-5 py-3 font-medium">Participante</th>
                      <th className="px-5 py-3 font-medium">Estado</th>
                      <th className="px-5 py-3 font-medium">Tests</th>
                      <th className="px-5 py-3 font-medium">Fallos</th>
                      <th className="px-5 py-3 font-medium">Tiempo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {board
                      .map((entry, index) => ({ entry, position: index + 1 }))
                      .filter(({ entry }) =>
                        entry.display_name.toLowerCase().includes(query.toLowerCase()),
                      )
                      .map(({ entry, position }) => {
                        const silk =
                          (entry as RankingEntry & { character?: number }).character ?? 0;
                        const pct = Math.round(Number(entry.best_pass_percentage));
                        const status =
                          currentRound?.status === "pending"
                            ? { label: "Conectado", className: "bg-muted text-muted-foreground" }
                            : entry.final_status === "advanced"
                              ? { label: "Clasificó", className: "bg-success-soft text-success" }
                              : entry.final_status === "eliminated"
                                ? { label: "Eliminado", className: "bg-danger-soft text-danger" }
                                : entry.solved_at
                                  ? { label: "Resolvió", className: "bg-success-soft text-success" }
                                  : { label: "En carrera", className: "bg-info-soft text-info" };
                        return (
                          <tr key={entry.participant_id}>
                            <td className="px-5 py-3 font-mono tabular-nums">
                              {currentRound?.status === "pending" ? "—" : position}
                            </td>
                            <td className="px-5 py-3 font-mono text-foreground">
                              <span className="flex items-center gap-2">
                                <span
                                  className={`h-3 w-3 shrink-0 rounded-full bg-silk-${silk % 10}`}
                                  aria-hidden="true"
                                />
                                {entry.display_name}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}
                              >
                                {status.label}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-20 rounded-full bg-muted">
                                  <div
                                    className={`h-full rounded-full bg-silk-${silk % 10}`}
                                    style={{ width: `${pct}%`, transition: "width 0.55s ease" }}
                                  />
                                </div>
                                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                  {pct}%
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-3 font-mono tabular-nums text-muted-foreground">
                              {entry.failed_attempts_count}
                            </td>
                            <td className="px-5 py-3 font-mono tabular-nums">
                              {entry.solved_at ? (
                                formatTotalTime(entry.total_time_seconds, entry.penalty_seconds)
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {board.length === 0 && (
                  <p className="px-5 py-4 text-sm text-muted-foreground">
                    {currentRound
                      ? "Todavía no se conectó nadie a esta ronda."
                      : "Elegí un torneo con rondas para ver a sus participantes."}
                  </p>
                )}
              </div>
              <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                Orden: completó primero (por orden de llegada), después más tests y después menos
                fallos.
              </p>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">Cola de evaluación</h3>
                {/* "Cola no disponible" primero: con Redis caído nada se evalúa,
                aunque los números de la ronda (que salen de la base) sigan ahí. */}
                {queueError || queueStats?.queue_available === false ? (
                  <span className="inline-flex rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger">
                    Cola no disponible
                  </span>
                ) : !queueStats ? null : !queueStats.round ? (
                  <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    Sin ronda activa
                  </span>
                ) : queueStats.round.pending === 0 ? (
                  <span className="inline-flex rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
                    Sin pendientes
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-info-soft px-2.5 py-1 text-xs font-medium text-info">
                    {queueStats.round.pending} pendientes
                  </span>
                )}
              </div>
              {queueStats && !queueStats.round ? (
                <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                  No hay una ronda activa. Los contadores son de los envíos de la ronda en curso:
                  cuando se inicie una, aparecen acá.
                </p>
              ) : (
                <>
                  {queueStats?.round && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Ronda {queueStats.round.round_number} de “{queueStats.round.tournament_name}”
                      · {countLabel(queueStats.round.total, "envío", "envíos")}
                    </p>
                  )}
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Stat label="Pendientes" value={queueStats?.round?.pending ?? "—"} />
                    <Stat label="Evaluados" value={queueStats?.round?.completed ?? "—"} />
                    <Stat label="Fallidos" value={queueStats?.round?.failed ?? "—"} />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Pendientes: en cola o ejecutándose; la base no distingue entre los dos.
                    Fallidos: errores de la cola o del juez. Un programa que no compila o falla
                    casos cuenta como evaluado.
                  </p>
                </>
              )}
              <div className="mt-5 border-t border-border pt-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Últimos envíos
                </p>
                {submissions.length > 0 && (
                  <div className="mt-2 max-h-80 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="pb-2 font-medium">Hora</th>
                          <th className="pb-2 font-medium">Participante</th>
                          <th className="pb-2 font-medium">Lenguaje</th>
                          <th className="pb-2 font-medium">Estado</th>
                          <th className="pb-2 text-right font-medium">Casos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {submissions.map((submission) => (
                          <tr key={submission.id}>
                            <td className="py-1.5 font-mono tabular-nums text-muted-foreground">
                              {formatTime(submission.submitted_at)}
                            </td>
                            <td className="py-1.5 font-mono text-foreground">
                              {submission.display_name}
                            </td>
                            <td className="py-1.5 text-muted-foreground">
                              {LANGUAGE_LABEL[submission.language] ?? submission.language}
                            </td>
                            <td
                              className={`py-1.5 font-medium ${VERDICT_TONE_CLASS[verdictTone(submission.verdict)]}`}
                            >
                              {verdictLabel(submission.verdict)}
                            </td>
                            <td className="py-1.5 text-right font-mono tabular-nums">
                              {submission.test_cases_total
                                ? `${submission.test_cases_passed}/${submission.test_cases_total}`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {submissions.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {liveRoundId
                      ? "Aún no hay envíos en esta ronda."
                      : "No hay una ronda en curso."}
                  </p>
                )}
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-border bg-card p-5 lg:sticky lg:top-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PixelIcon name="trophy" className="h-4 w-4 text-primary" /> Progreso del torneo
            </h3>
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
                    className={`rounded-lg px-3 py-2 text-sm ${
                      r.status === "active"
                        ? "bg-info-soft font-medium text-foreground"
                        : r.status === "pending"
                          ? "text-muted-foreground"
                          : "text-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        Ronda {r.round_number} · {ROUND_STATUS_LABEL[r.status] ?? r.status}
                        {r.problem_name && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            · {r.problem_name}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono tabular-nums">
                          {r.participants_count} → {r.status === "closed" ? r.advanced_count : "—"}
                        </span>
                        {r.status === "pending" && (
                          <button
                            type="button"
                            disabled={Boolean(r.start_blocked_reason) || startingRoundId !== ""}
                            onClick={() => void beginRound(r.id)}
                            className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            {startingRoundId === r.id ? "Iniciando..." : "Iniciar"}
                          </button>
                        )}
                      </span>
                    </div>
                    {r.status === "pending" && r.start_blocked_reason && (
                      <p className="mt-1 text-xs text-muted-foreground">{r.start_blocked_reason}</p>
                    )}
                    {r.status === "pending" && roundEdit?.id === r.id && (
                      <form
                        className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3 text-xs"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveRoundEdit();
                        }}
                      >
                        <label className="block">
                          <span className="text-muted-foreground">Problema</span>
                          <select
                            value={roundEdit.problemId}
                            onChange={(event) =>
                              setRoundEdit({ ...roundEdit, problemId: event.target.value })
                            }
                            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                          >
                            {!roundEdit.problemId && <option value="">Elegí un problema</option>}
                            {problems.map((problem) => (
                              <option key={problem.id} value={problem.id}>
                                {problem.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="flex gap-2">
                          <label className="block flex-1">
                            <span className="text-muted-foreground">
                              Cupo
                              {roundEdit.maxCapacity !== null
                                ? ` (máx. ${roundEdit.maxCapacity} inscriptos)`
                                : ""}
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={roundEdit.maxCapacity ?? undefined}
                              value={roundEdit.capacity}
                              onChange={(event) =>
                                setRoundEdit({ ...roundEdit, capacity: Number(event.target.value) })
                              }
                              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
                            />
                          </label>
                          <label className="block flex-1">
                            <span className="text-muted-foreground">Tiempo límite (minutos)</span>
                            <input
                              type="number"
                              min={1}
                              step="any"
                              value={roundEdit.minutes}
                              onChange={(event) =>
                                setRoundEdit({ ...roundEdit, minutes: Number(event.target.value) })
                              }
                              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
                            />
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={savingRoundEdit}
                            className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
                          >
                            {savingRoundEdit ? "Guardando..." : "Guardar"}
                          </button>
                          <button
                            type="button"
                            disabled={savingRoundEdit}
                            onClick={() => setRoundEdit(null)}
                            className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    )}
                    {r.status === "pending" &&
                      roundEdit?.id !== r.id &&
                      (confirmDeleteRoundId === r.id ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-danger">
                          <span>
                            ¿Borrar la ronda {r.round_number}? Todavía no se jugó
                            {r.participants_count
                              ? `; sus ${r.participants_count} inscriptos salen de ella`
                              : ""}
                            .
                          </span>
                          <button
                            type="button"
                            disabled={deletingRoundId !== ""}
                            onClick={() => void removeRound(r.id, r.round_number)}
                            className="rounded-lg bg-danger px-2 py-1 font-medium text-danger-foreground disabled:opacity-50"
                          >
                            {deletingRoundId === r.id ? "Borrando..." : "Borrar"}
                          </button>
                          <button
                            type="button"
                            disabled={deletingRoundId !== ""}
                            onClick={() => setConfirmDeleteRoundId("")}
                            className="rounded-lg border border-danger px-2 py-1 font-medium"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <span className="mt-1 flex gap-3">
                          <button
                            type="button"
                            disabled={startingRoundId !== "" || deletingRoundId !== ""}
                            onClick={() => openRoundEdit(r)}
                            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={startingRoundId !== "" || deletingRoundId !== ""}
                            onClick={() => setConfirmDeleteRoundId(r.id)}
                            className="text-xs text-muted-foreground underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
                          >
                            Borrar ronda pendiente
                          </button>
                        </span>
                      ))}
                  </li>
                ))}
              </ul>
            )}
            {lastRound && advanceFromId && nextRoundPreview && (
              <div className="mt-4 border-t border-border pt-4">
                {nextRoundPreview.available ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Clasificaron {nextRoundPreview.advancingCount} de{" "}
                      {lastRound.participants_count} en la ronda {lastRound.round_number}:
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {nextRoundPreview.advancing.map((entry) => (
                        <span
                          key={entry.participant_id}
                          className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
                        >
                          {entry.final_rank}. {entry.display_name}
                        </span>
                      ))}
                    </div>
                    {!showNextForm ? (
                      <button
                        type="button"
                        onClick={() => setShowNextForm(true)}
                        className="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                      >
                        Avanzar a la siguiente ronda
                      </button>
                    ) : (
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
                        <p className="text-xs text-muted-foreground">
                          Los clasificados quedan inscriptos al crearla. Se crea pendiente: después
                          hay que iniciarla.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void saveNextRound()}
                            disabled={savingNextRound}
                            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            {savingNextRound
                              ? "Creando..."
                              : `Crear ronda ${nextRoundPreview.nextRoundNumber}`}
                          </button>
                          <button
                            type="button"
                            disabled={savingNextRound}
                            onClick={() => setShowNextForm(false)}
                            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{nextRoundPreview.reason}</p>
                )}
              </div>
            )}
          </section>
        </div>
      </TabsContent>

      {/* la pista del demo animado, con los sprites de cada participante. */}
      <TabsContent value="pista">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PixelIcon name="flag" className="h-4 w-4 text-primary" />
              {currentRound
                ? `Pista · Ronda ${currentRound.round_number} · ${currentRound.problem_name ?? ""}`
                : "Pista"}
            </h3>
            <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {currentRound?.status === "active" && !ctrlCountingDown
                ? formatClock(ctrlRemaining)
                : currentRound?.status === "closed"
                  ? "Cerrada"
                  : "--:--"}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Avanzan según los tests que pasan; el orden de los carriles es el del ranking (completó
            por llegada, después tests, después fallos). La línea roja marca el último que
            clasifica.
          </p>
          <div className="mt-4 space-y-1">
            {board.map((entry, index) => {
              const silk = (entry as RankingEntry & { character?: number }).character ?? 0;
              const pct = Math.min(100, Number(entry.best_pass_percentage));
              const state =
                entry.final_status === "eliminated"
                  ? "out"
                  : currentRound?.status === "active" && !ctrlCountingDown && !entry.solved_at
                    ? "run"
                    : "idle";
              const cut = currentRound ? index === currentRound.capacity - 1 : false;
              return (
                <div
                  key={entry.participant_id}
                  className={`relative h-20 border-b-2 ${cut ? "border-danger" : "border-dashed border-border"}`}
                >
                  <span className="absolute left-1 top-1 z-10 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <b className="font-mono text-foreground">{index + 1}.º</b>
                    <span
                      className={`h-2.5 w-2.5 rounded-sm bg-silk-${silk % 10}`}
                      aria-hidden="true"
                    />
                    {entry.display_name}
                    {entry.solved_at && (
                      <span className="font-semibold text-success">· completó</span>
                    )}
                    {entry.final_status === "eliminated" && (
                      <span className="font-semibold text-danger">· eliminado</span>
                    )}
                  </span>
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
                    <Sprite index={silk} state={state} scale={0.5} />
                  </div>
                </div>
              );
            })}
            {board.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Todavía no hay participantes en la ronda de este torneo.
              </p>
            )}
          </div>
        </section>
      </TabsContent>

      <TabsContent value="rondas" className="space-y-5">
        {message && (
          <p
            role="status"
            className="rounded-lg border border-border bg-card px-4 py-2 text-xs text-foreground"
          >
            {message}
          </p>
        )}
        {/* crear torneo y elegirlo a la izquierda; editor de ronda a la derecha. */}
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <section className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Crear torneo</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Siempre disponible. El torneo nuevo queda elegido para configurar sus rondas.
              </p>
              <div className="mt-4 space-y-3">
                <input
                  value={newTournamentInput}
                  onChange={(event) => setNewTournamentInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createTournamentAndSelect();
                  }}
                  placeholder="Nombre del torneo"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                />
                <button
                  type="button"
                  disabled={savingTournament}
                  onClick={() => void createTournamentAndSelect()}
                  className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {savingTournament ? "Creando..." : "Crear torneo"}
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Rondas del torneo</h3>
              <select
                value={planTournamentId}
                onChange={(event) => {
                  setPlanTournamentId(event.target.value);
                  setPlanIndex(0);
                }}
                className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
              >
                <option value="">Elegí un torneo para configurar sus rondas</option>
                {tournaments.map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>
                    {tournament.name}
                  </option>
                ))}
              </select>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={
                    !planTournamentId || savingPlan || plan[plan.length - 1]?.status !== "pending"
                  }
                  onClick={removeLastPlanRound}
                  className="rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:opacity-70 disabled:opacity-40"
                >
                  − Quitar última
                </button>
                <button
                  type="button"
                  disabled={!planTournamentId || savingPlan}
                  onClick={addPlanRound}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
                >
                  + Agregar ronda
                </button>
                <button
                  type="button"
                  disabled={!planTournamentId || savingPlan || !planDirty}
                  onClick={() => void savePlan()}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                >
                  {savingPlan ? "Guardando..." : "Guardar todas"}
                </button>
              </div>
              {planTournamentId && (
                <ul className="mt-4 space-y-1.5">
                  {plan.map((row, index) => (
                    <li key={`${row.round_number}-${row.id ?? "nueva"}`}>
                      <button
                        type="button"
                        onClick={() => setPlanIndex(index)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                          index === planIndex
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="font-mono font-semibold">R{row.round_number}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${DIFFICULTY_CLASS[row.difficulty]}`}
                          >
                            {DIFFICULTY_LABEL[row.difficulty]}
                          </span>
                          <span className="truncate text-muted-foreground">
                            {problems.find((problem) => problem.id === row.problemId)?.name ??
                              "Sin problema"}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {row.id ? (ROUND_STATUS_LABEL[row.status] ?? row.status) : "Sin guardar"}
                        </span>
                      </button>
                    </li>
                  ))}
                  {plan.length === 0 && (
                    <li className="text-xs text-muted-foreground">
                      Este torneo todavía no tiene rondas. Agregá la primera.
                    </li>
                  )}
                </ul>
              )}
              {planDirty && (
                <p className="mt-3 text-xs text-info">Hay cambios sin guardar en el plan.</p>
              )}
            </section>
          </div>

          {(() => {
            const row = plan[planIndex];
            const enabled = Boolean(planTournamentId && row);
            const editable = enabled && row?.status === "pending";
            const filtered = row
              ? problems.filter((problem) => problem.difficulty === row.difficulty)
              : [];
            return (
              <section
                aria-disabled={!enabled}
                className={`rounded-xl border border-border bg-card p-5 ${enabled ? "" : "opacity-50"}`}
              >
                <h3 className="text-sm font-semibold text-foreground">Ronda</h3>
                {!enabled ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Elegí o creá un torneo para configurar sus rondas.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-muted font-mono text-2xl font-bold text-foreground">
                        {row!.round_number}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {editable
                          ? "Ronda pendiente: se puede editar sola o junto con las demás."
                          : "Esta ronda ya empezó: no se puede editar."}
                      </p>
                    </div>
                    <label className="block text-sm">
                      <span className="text-muted-foreground">Nivel de dificultad</span>
                      <select
                        value={row!.difficulty}
                        disabled={!editable}
                        onChange={(event) => {
                          const difficulty = event.target.value as ProblemDifficulty;
                          updatePlanRow(planIndex, {
                            difficulty,
                            problemId: firstProblemOf(difficulty),
                          });
                        }}
                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                      >
                        {(Object.keys(DIFFICULTY_LABEL) as ProblemDifficulty[]).map((key) => (
                          <option key={key} value={key}>
                            {DIFFICULTY_LABEL[key]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="text-muted-foreground">
                        Problema ({countLabel(filtered.length, "disponible", "disponibles")} en{" "}
                        {DIFFICULTY_LABEL[row!.difficulty].toLowerCase()})
                      </span>
                      <select
                        value={row!.problemId}
                        disabled={!editable}
                        onChange={(event) =>
                          updatePlanRow(planIndex, { problemId: event.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                      >
                        {filtered.length === 0 && (
                          <option value="">No hay problemas con esta dificultad</option>
                        )}
                        {filtered.map((problem) => (
                          <option key={problem.id} value={problem.id}>
                            {problem.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex gap-3">
                      <label className="block flex-1 text-sm">
                        <span className="text-muted-foreground">Cupo (clasifican)</span>
                        <input
                          type="number"
                          min={1}
                          disabled={!editable}
                          value={row!.capacity}
                          onChange={(event) =>
                            updatePlanRow(planIndex, { capacity: Number(event.target.value) })
                          }
                          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
                        />
                      </label>
                      <label className="block flex-1 text-sm">
                        <span className="text-muted-foreground">Tiempo (minutos)</span>
                        <input
                          type="number"
                          min={1}
                          disabled={!editable}
                          value={row!.minutes}
                          onChange={(event) =>
                            updatePlanRow(planIndex, { minutes: Number(event.target.value) })
                          }
                          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      disabled={!editable || savingPlan}
                      onClick={() => void savePlanRow(planIndex)}
                      className="w-full rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      {savingPlan ? "Guardando..." : `Guardar solo la ronda ${row!.round_number}`}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      Las rondas se inician desde Control de ronda, en orden. La siguiente recibe a
                      los clasificados de la anterior.
                    </p>
                  </div>
                )}
              </section>
            );
          })()}
        </div>
      </TabsContent>

      <TabsContent value="problemas" className="space-y-5">
        {message && (
          <p
            role="status"
            className="rounded-lg border border-border bg-card px-4 py-2 text-xs text-foreground"
          >
            {message}
          </p>
        )}
        {/* una sola caja: formulario arriba, lista y borrado al final. */}
        <section ref={problemFormRef} className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">
            {editingProblem ? `Editar problema “${editingProblem.name}”` : "Crear problema"}
          </h3>
          <p className="mt-2 text-xs text-muted-foreground">
            Cada caso define una entrada y su salida esperada. Solo se acepta la solución que pasa
            todos los casos.
          </p>
          {editingProblem?.rounds.some((r) => r.status === "active" || r.status === "closing") && (
            <p className="mt-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
              Hay una ronda en juego con este problema. Nombre, enunciado y dificultad se pueden
              guardar ya; un cambio en los casos se rechaza hasta que la ronda cierre, porque
              cambiaría el veredicto de los envíos que faltan juzgar.
            </p>
          )}
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
                todos al guardar el problema.
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
              <p className="text-xs text-muted-foreground">
                {sampleCount} de {allCases.length} marcados como ejemplo público
                {editingProblem ? ` (guardado: ${originalSampleCount})` : ""}.
              </p>
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
            {sampleCount === 0 && (
              <p role="status" className="text-xs text-danger">
                Ningún caso es ejemplo público: el participante no va a ver ejemplos.
              </p>
            )}
            {confirmNoSamples && sampleCount === 0 ? (
              <div className="space-y-2 rounded-lg border border-danger bg-danger-soft p-3 text-xs text-danger">
                <p>
                  El problema tenía {originalSampleCount}{" "}
                  {originalSampleCount === 1 ? "ejemplo público" : "ejemplos públicos"} y se va a
                  guardar con 0.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={savingProblem}
                    className="rounded-lg bg-danger px-3 py-1.5 font-medium text-danger-foreground disabled:opacity-50"
                  >
                    {savingProblem ? "Guardando..." : "Guardar sin ejemplos"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmNoSamples(false)}
                    className="rounded-lg border border-danger px-3 py-1.5 font-medium"
                  >
                    Volver
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={savingProblem}
                  className="flex-1 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {editingProblem
                    ? savingProblem
                      ? "Guardando..."
                      : "Guardar cambios"
                    : savingProblem
                      ? "Creando..."
                      : "Crear y seleccionar"}
                </button>
                {editingProblem && (
                  <button
                    type="button"
                    disabled={savingProblem}
                    onClick={() => {
                      resetProblemForm();
                      setMessage("Edición cancelada.");
                    }}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Cancelar edición
                  </button>
                )}
              </div>
            )}
            {problemFormMessage && (
              <p
                role="status"
                className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
              >
                {problemFormMessage}
              </p>
            )}
          </form>

          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">
              Problemas guardados ({problems.length})
            </h3>
            {problems.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Todavía no hay problemas.</p>
            ) : (
              <>
                <ul className="mt-1 divide-y divide-border text-sm">
                  {problems.map((problem) => (
                    <li key={problem.id} className="py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-3 text-foreground">
                          <RowCheckbox
                            id={problem.id}
                            label={`Seleccionar ${problem.name}`}
                            selected={selectedProblemIds}
                            onChange={changeProblemSelection}
                            disabled={problemBulkBusy}
                          />
                          {problem.name}
                          {editingProblem?.id === problem.id && (
                            <span className="text-xs text-info">en edición</span>
                          )}
                        </span>
                        <span className="flex gap-2">
                          <button
                            type="button"
                            disabled={loadingProblemId !== "" || savingProblem}
                            onClick={() => void editProblem(problem.id)}
                            className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {loadingProblemId === problem.id ? "Cargando..." : "Editar"}
                          </button>
                          <button
                            type="button"
                            disabled={deletingProblem}
                            onClick={() => void askDeleteProblem(problem)}
                            className="rounded-lg border border-danger px-3 py-1 text-xs font-medium text-danger hover:opacity-70 disabled:opacity-50"
                          >
                            Eliminar
                          </button>
                        </span>
                      </div>
                      {deleteTarget?.id === problem.id && (
                        <div
                          role="alertdialog"
                          aria-label={`Eliminar ${problem.name}`}
                          className="mt-2 space-y-2 rounded-lg border border-danger bg-danger-soft p-3 text-xs text-danger"
                        >
                          {!deleteTarget.detail ? (
                            <p>Consultando qué rondas usan este problema…</p>
                          ) : deleteTarget.detail.rounds.length === 0 ? (
                            <p>Ninguna ronda usa este problema: no hay historial que perder.</p>
                          ) : (
                            <>
                              <p>
                                {deleteTarget.detail.rounds.length === 1
                                  ? "Lo usa 1 ronda:"
                                  : `Lo usan ${deleteTarget.detail.rounds.length} rondas:`}
                              </p>
                              <ul className="list-disc pl-5">
                                {deleteTarget.detail.rounds.map((r) => (
                                  <li key={r.id}>
                                    Ronda {r.round_number} de “{r.tournament_name}” ·{" "}
                                    {(ROUND_STATUS_LABEL[r.status] ?? r.status).toLowerCase()}
                                    {r.tournament_status === "finished"
                                      ? " · torneo terminado"
                                      : ""}
                                  </li>
                                ))}
                              </ul>
                              {deleteTarget.detail.rounds.some(
                                (r) => r.tournament_status === "finished",
                              ) && (
                                <p>
                                  Las rondas de torneos terminados se conservan con su número,
                                  estado, participantes y envíos, y guardan el nombre del problema.
                                  Lo que se pierde es el enunciado y los casos: no se va a poder
                                  auditar qué se juzgó.
                                </p>
                              )}
                              {deleteTarget.detail.rounds.some(
                                (r) => r.tournament_status !== "finished" && r.status !== "pending",
                              ) && (
                                <p>
                                  Una ronda ya jugada de un torneo que sigue abierto bloquea el
                                  borrado hasta que el torneo termine.
                                </p>
                              )}
                              {deleteTarget.detail.rounds
                                .filter(
                                  (r) =>
                                    r.status === "pending" && r.tournament_status !== "finished",
                                )
                                .map((r) => (
                                  <p key={r.id} className="flex flex-wrap items-center gap-2">
                                    La ronda {r.round_number} de “{r.tournament_name}” todavía no se
                                    jugó: cambiale el problema con “Editar” en Progreso del torneo,
                                    o borrala.
                                    <button
                                      type="button"
                                      disabled={deletingProblem}
                                      onClick={() => void removePendingRound(r.id, r.round_number)}
                                      className="rounded-lg border border-danger px-2 py-1 font-medium disabled:opacity-50"
                                    >
                                      Borrar la ronda {r.round_number} pendiente
                                    </button>
                                  </p>
                                ))}
                            </>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={deletingProblem || !deleteTarget.detail}
                              onClick={() => void confirmDeleteProblem()}
                              className="rounded-lg bg-danger px-3 py-1.5 font-medium text-danger-foreground disabled:opacity-50"
                            >
                              {deletingProblem ? "Eliminando..." : "Eliminar problema"}
                            </button>
                            <button
                              type="button"
                              disabled={deletingProblem}
                              onClick={() => setDeleteTarget(null)}
                              className="rounded-lg border border-danger px-3 py-1.5 font-medium"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs">
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <SelectAllCheckbox
                      label="Seleccionar todos los problemas"
                      selectableIds={problemIds}
                      selected={selectedProblemIds}
                      onChange={changeProblemSelection}
                      disabled={problemBulkBusy}
                    />
                    Todos
                  </label>
                  <span className="text-muted-foreground">
                    {countLabel(selectedProblemIds.size, "seleccionado", "seleccionados")}
                  </span>
                  <button
                    type="button"
                    disabled={selectedProblemIds.size === 0 || problemBulkBusy}
                    onClick={() => void askBulkDeleteProblems()}
                    className="rounded-lg border border-danger px-3 py-1 font-medium text-danger hover:opacity-70 disabled:opacity-50"
                  >
                    {problemBulkBusy && !problemBulkPreview
                      ? "Revisando..."
                      : `Borrar ${countLabel(selectedProblemIds.size, "problema", "problemas")}`}
                  </button>
                </div>
                {problemBulkPreview && (
                  <div
                    role="alertdialog"
                    aria-label="Borrar problemas seleccionados"
                    className="mt-3 space-y-2 rounded-lg border border-danger bg-danger-soft p-3 text-xs text-danger"
                  >
                    <p className="font-medium">
                      De{" "}
                      {countLabel(
                        selectedProblemIds.size,
                        "problema seleccionado",
                        "problemas seleccionados",
                      )}{" "}
                      se van a borrar {problemBulkPreview.deletable.length} y quedan afuera{" "}
                      {problemBulkPreview.blocked.length + problemBulkPreview.missing.length}.
                      Todavía no se borró nada.
                    </p>
                    {problemBulkPreview.deletable.length > 0 && (
                      <ul className="list-disc pl-5">
                        {problemBulkPreview.deletable.map((problem) => (
                          <li key={problem.id}>
                            “{problem.name}”
                            {problem.rounds_kept > 0 &&
                              ` · ${countLabel(problem.rounds_kept, "ronda de un torneo terminado conserva", "rondas de torneos terminados conservan")} el nombre, sin enunciado ni casos`}
                          </li>
                        ))}
                      </ul>
                    )}
                    {problemBulkPreview.blocked.length > 0 && (
                      <>
                        <p>Quedan afuera, porque los usa un torneo que no terminó:</p>
                        <ul className="list-disc pl-5">
                          {problemBulkPreview.blocked.map((problem) => (
                            <li key={problem.id}>
                              “{problem.name}”:{" "}
                              {problem.blocking
                                .map(
                                  (r) =>
                                    `ronda ${r.round_number} de “${r.tournament_name}” (${(ROUND_STATUS_LABEL[r.status] ?? r.status).toLowerCase()})`,
                                )
                                .join(", ")}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {problemBulkPreview.missing.length > 0 && (
                      <p>{problemBulkPreview.missing.length} ya no existían.</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={problemBulkBusy || problemBulkPreview.deletable.length === 0}
                        onClick={() => void confirmBulkDeleteProblems()}
                        className="rounded-lg bg-danger px-3 py-1.5 font-medium text-danger-foreground disabled:opacity-50"
                      >
                        {problemBulkBusy
                          ? "Borrando..."
                          : problemBulkPreview.deletable.length === 0
                            ? "No hay nada que borrar"
                            : `Borrar ${countLabel(problemBulkPreview.deletable.length, "problema", "problemas")} definitivamente`}
                      </button>
                      <button
                        type="button"
                        disabled={problemBulkBusy}
                        onClick={() => setProblemBulkPreview(null)}
                        className="rounded-lg border border-danger px-3 py-1.5 font-medium"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </TabsContent>

      <TabsContent value="acceso">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Códigos de acceso</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            Cada código se puede canjear una sola vez. Si lo asocias a un torneo, se invalida solo
            cuando el torneo termina o cuando vence el plazo. Los vencidos o invalidados se quitan
            solos de la lista.
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
                {/* Solo torneos abiertos: los terminados están en Historial. */}
                {tournaments.map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>
                    {tournament.name}
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
            <div className="mt-3 space-y-2">
              <textarea
                readOnly
                value={generatedCodes.join("\n")}
                className="h-32 w-full resize-none rounded-lg border border-input bg-background p-3 font-mono text-xs text-foreground outline-none"
                aria-label="Códigos generados"
              />
              <button
                type="button"
                onClick={() => {
                  // Solo los que siguen sin usar: si alguno se canjeó o venció, no se copia.
                  const unused = new Set(
                    visibleCodes.filter((c) => c.status === "unused").map((c) => c.code),
                  );
                  void copyCodes(
                    "generated",
                    generatedCodes.filter((code) => unused.has(code)),
                  );
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                {copiedKey === "generated" ? "Copiados ✓" : "Copiar los generados"}
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-foreground">Códigos emitidos</h4>
            <span className="flex items-center gap-3">
              <button
                type="button"
                disabled={unusedCodes.length === 0}
                onClick={() => void copyCodes("all", unusedCodes)}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {copiedKey === "all"
                  ? "Copiados ✓"
                  : `Copiar todos sin usar (${unusedCodes.length})`}
              </button>
              <button
                type="button"
                onClick={() => void refreshCodes()}
                className="text-xs text-primary hover:underline"
              >
                Actualizar
              </button>
            </span>
          </div>

          {visibleCodes.length > 0 && (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Código</th>
                    <th className="px-2 py-1.5 font-medium">Estado</th>
                    <th className="px-2 py-1.5 font-medium">Vence</th>
                    <th className="px-2 py-1.5 text-right font-medium">Copiar</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCodes.map((item) => (
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
                      <td className="px-2 py-1.5 text-right">
                        {item.status === "unused" ? (
                          <button
                            type="button"
                            onClick={() => void copyCodes(item.id, [item.code])}
                            className="rounded-md border border-border px-2 py-0.5 font-medium text-foreground hover:bg-muted"
                          >
                            {copiedKey === item.id ? "✓" : "Copiar"}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {loadingCodes && <p className="mt-2 text-xs text-muted-foreground">Cargando…</p>}
          {!loadingCodes && visibleCodes.length === 0 && (
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
                        `Torneo finalizado y ${result.expiredAccessCodes} códigos invalidados. Pasó a Historial.`,
                      );
                      // Ya no está en el selector: se deja de filtrar por él.
                      setCodeTournamentId("");
                      return Promise.all([refreshTournaments(), refreshFinishedTournaments()]);
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

      <TabsContent value="historial" className="space-y-5">
        {message && (
          <p
            role="status"
            className="rounded-lg border border-border bg-card px-4 py-2 text-xs text-foreground"
          >
            {message}
          </p>
        )}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Torneos</h3>
            <button
              type="button"
              disabled={tournamentBulkBusy}
              onClick={() => {
                void refreshTournaments();
                void refreshFinishedTournaments();
              }}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              Actualizar
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Los terminados no aparecen en los selectores de las otras pestañas y se conservan hasta
            que los borres. Un torneo abierto solo se puede borrar si todavía no jugó ninguna ronda.
            Borrar un torneo se lleva sus rondas, participantes, envíos y códigos de acceso; los
            usuarios no.
          </p>
          {finishedTournaments === null ? (
            <p className="mt-4 text-sm text-muted-foreground">Cargando…</p>
          ) : tournamentRows.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Ningún torneo.</p>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3 border-b border-border pb-3 text-xs">
                <label className="flex items-center gap-2 text-muted-foreground">
                  <SelectAllCheckbox
                    label="Seleccionar todos los torneos borrables"
                    selectableIds={deletableTournamentIds}
                    selected={selectedTournamentIds}
                    onChange={changeTournamentSelection}
                    disabled={tournamentBulkBusy}
                  />
                  Todos los borrables
                </label>
                <span className="text-muted-foreground">
                  {countLabel(selectedTournamentIds.size, "seleccionado", "seleccionados")}
                </span>
                <button
                  type="button"
                  disabled={selectedTournamentIds.size === 0 || tournamentBulkBusy}
                  onClick={() => void askBulkDeleteTournaments()}
                  className="rounded-lg border border-danger px-3 py-1 font-medium text-danger hover:opacity-70 disabled:opacity-50"
                >
                  {tournamentBulkBusy && !tournamentBulkPreview
                    ? "Revisando..."
                    : `Borrar ${countLabel(selectedTournamentIds.size, "torneo", "torneos")}`}
                </button>
              </div>
              {tournamentBulkPreview && (
                <div
                  role="alertdialog"
                  aria-label="Borrar torneos seleccionados"
                  className="mt-3 space-y-2 rounded-lg border border-danger bg-danger-soft p-3 text-xs text-danger"
                >
                  {tournamentBulkPreview.deletable.length > 0 ? (
                    <p className="font-medium">
                      Se van a borrar para siempre{" "}
                      {countLabel(tournamentBulkPreview.totals.tournaments, "torneo", "torneos")},{" "}
                      {countLabel(tournamentBulkPreview.totals.rounds, "ronda", "rondas")},{" "}
                      {countLabel(
                        tournamentBulkPreview.totals.participants,
                        "participante",
                        "participantes",
                      )}
                      , {countLabel(tournamentBulkPreview.totals.submissions, "envío", "envíos")} y{" "}
                      {countLabel(
                        tournamentBulkPreview.totals.access_codes,
                        "código de acceso",
                        "códigos de acceso",
                      )}
                      . No se puede deshacer.
                    </p>
                  ) : (
                    <p className="font-medium">Ninguno de los seleccionados se puede borrar.</p>
                  )}
                  {tournamentBulkPreview.deletable.length > 0 && (
                    <ul className="list-disc pl-5">
                      {tournamentBulkPreview.deletable.map((row) => (
                        <li key={row.id}>
                          “{row.name}”: {countLabel(row.rounds, "ronda", "rondas")},{" "}
                          {countLabel(row.participants, "participante", "participantes")},{" "}
                          {countLabel(row.submissions, "envío", "envíos")},{" "}
                          {countLabel(row.access_codes, "código", "códigos")}
                        </li>
                      ))}
                    </ul>
                  )}
                  {tournamentBulkPreview.blocked.length > 0 && (
                    <>
                      <p>Quedan afuera:</p>
                      <ul className="list-disc pl-5">
                        {tournamentBulkPreview.blocked.map((row) => (
                          <li key={row.id}>{row.reason}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {tournamentBulkPreview.missing.length > 0 && (
                    <p>{tournamentBulkPreview.missing.length} ya no existían.</p>
                  )}
                  {tournamentBulkPreview.deletable.length > 0 && (
                    <p>
                      Los usuarios no se borran.{" "}
                      {tournamentBulkPreview.totals.orphaned_users > 0
                        ? `${countLabel(tournamentBulkPreview.totals.orphaned_users, "queda", "quedan")} sin ningún torneo: se pueden revisar y limpiar abajo.`
                        : "Ninguno queda sin torneo."}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={tournamentBulkBusy || tournamentBulkPreview.deletable.length === 0}
                      onClick={() => void confirmBulkDeleteTournaments()}
                      className="rounded-lg bg-danger px-3 py-1.5 font-medium text-danger-foreground disabled:opacity-50"
                    >
                      {tournamentBulkBusy
                        ? "Borrando..."
                        : tournamentBulkPreview.deletable.length === 0
                          ? "No hay nada que borrar"
                          : `Borrar ${countLabel(tournamentBulkPreview.deletable.length, "torneo", "torneos")} definitivamente`}
                    </button>
                    <button
                      type="button"
                      disabled={tournamentBulkBusy}
                      onClick={() => setTournamentBulkPreview(null)}
                      className="rounded-lg border border-danger px-3 py-1.5 font-medium"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              <ul className="mt-1 divide-y divide-border text-sm">
                {tournamentRows.map((row) => {
                  const tournament = row.finished;
                  return (
                    <li key={row.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-3 text-foreground">
                          {row.blockReason ? (
                            // Sin casilla: no se puede borrar. El backend igual lo rechaza.
                            <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                          ) : (
                            <RowCheckbox
                              id={row.id}
                              label={`Seleccionar ${row.name}`}
                              selected={selectedTournamentIds}
                              onChange={changeTournamentSelection}
                              disabled={tournamentBulkBusy}
                            />
                          )}
                          <span>
                            {row.name}
                            <span
                              className={`ml-2 rounded-full px-2 py-0.5 text-xs ${tournament ? "bg-muted text-muted-foreground" : "bg-info-soft text-info"}`}
                            >
                              {tournament ? "Terminado" : "Abierto"}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {new Date(row.created_at).toLocaleDateString()}
                              {tournament &&
                                ` · ${tournament.rounds_count} rondas · ${tournament.participants_count} participantes`}
                            </span>
                            {row.blockReason && (
                              <span className="block text-xs text-muted-foreground">
                                {row.blockReason}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => toggleHistoryRounds(row.id)}
                            className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
                          >
                            {historyRounds?.tournamentId === row.id
                              ? "Ocultar rondas"
                              : "Ver rondas"}
                          </button>
                          {tournament && (
                            <button
                              type="button"
                              disabled={deletingTournamentId !== "" || tournamentBulkBusy}
                              onClick={() => setConfirmDeleteTournamentId(tournament.id)}
                              className="rounded-lg border border-danger px-3 py-1 text-xs font-medium text-danger hover:opacity-70 disabled:opacity-50"
                            >
                              Borrar
                            </button>
                          )}
                        </span>
                      </div>
                      {historyRounds?.tournamentId === row.id && (
                        <div className="mt-2 rounded-lg border border-border p-3 text-xs">
                          {historyRounds.rows === null ? (
                            <p className="text-muted-foreground">Cargando rondas…</p>
                          ) : historyRounds.rows.length === 0 ? (
                            <p className="text-muted-foreground">Sin rondas.</p>
                          ) : (
                            <ul className="space-y-1">
                              {historyRounds.rows.map((r) => (
                                <li key={r.id} className="flex justify-between gap-3">
                                  <span>
                                    Ronda {r.round_number} ·{" "}
                                    {ROUND_STATUS_LABEL[r.status] ?? r.status} ·{" "}
                                    {r.problem_name ?? "problema sin nombre"}
                                    {r.problem_id === null && r.problem_name && (
                                      <span className="text-muted-foreground">
                                        {" "}
                                        (problema borrado)
                                      </span>
                                    )}
                                  </span>
                                  <span className="font-mono tabular-nums">
                                    {r.participants_count} →{" "}
                                    {r.status === "closed" ? r.advanced_count : "—"}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      {tournament && confirmDeleteTournamentId === tournament.id && (
                        <div
                          role="alertdialog"
                          aria-label={`Borrar ${tournament.name}`}
                          className="mt-2 space-y-2 rounded-lg border border-danger bg-danger-soft p-3 text-xs text-danger"
                        >
                          <p>
                            Se borran para siempre {tournament.rounds_count} rondas,{" "}
                            {tournament.participants_count} participantes,{" "}
                            {tournament.submissions_count} envíos y los códigos de acceso de “
                            {tournament.name}”. No se puede deshacer.
                          </p>
                          <p>
                            Los usuarios no se borran.{" "}
                            {tournament.orphaned_users_count > 0
                              ? `${tournament.orphaned_users_count} de ellos no juegan otro torneo y quedan sin torneo: se pueden revisar y limpiar abajo.`
                              : "Ninguno queda sin torneo."}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={deletingTournamentId !== ""}
                              onClick={() => void removeTournament(tournament)}
                              className="rounded-lg bg-danger px-3 py-1.5 font-medium text-danger-foreground disabled:opacity-50"
                            >
                              {deletingTournamentId === tournament.id
                                ? "Borrando..."
                                : "Borrar torneo definitivamente"}
                            </button>
                            <button
                              type="button"
                              disabled={deletingTournamentId !== ""}
                              onClick={() => setConfirmDeleteTournamentId("")}
                              className="rounded-lg border border-danger px-3 py-1.5 font-medium"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Usuarios sin torneo</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            Participantes que no están en ningún torneo, registrados hace más de un día y sin un
            código de un torneo abierto. El admin nunca aparece. Revisá la lista antes de borrar: el
            código distingue a dos personas con el mismo nombre.
          </p>
          <button
            type="button"
            disabled={loadingOrphans || deletingOrphans}
            onClick={() => void loadOrphanUsers()}
            className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {loadingOrphans
              ? "Buscando..."
              : orphanUsers === null
                ? "Buscar usuarios sin torneo"
                : "Volver a buscar"}
          </button>
          {orphanUsers !== null && orphanUsers.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">No hay usuarios sin torneo.</p>
          )}
          {orphanUsers !== null && orphanUsers.length > 0 && (
            <>
              <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Nombre</th>
                      <th className="px-2 py-1.5 font-medium">Código</th>
                      <th className="px-2 py-1.5 font-medium">Registrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orphanUsers.map((user) => (
                      <tr key={user.id} className="border-t border-border">
                        <td className="px-2 py-1.5 text-foreground">{user.username}</td>
                        <td className="px-2 py-1.5 font-mono text-foreground">
                          {user.access_code}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {confirmDeleteOrphans ? (
                <div
                  role="alertdialog"
                  aria-label="Borrar usuarios sin torneo"
                  className="mt-3 space-y-2 rounded-lg border border-danger bg-danger-soft p-3 text-xs text-danger"
                >
                  <p>
                    Se borran para siempre los {orphanUsers.length} usuarios de la lista. Con su
                    código ya no pueden iniciar sesión. Sus códigos quedan como canjeados. No se
                    puede deshacer.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={deletingOrphans}
                      onClick={() => void removeOrphanUsers()}
                      className="rounded-lg bg-danger px-3 py-1.5 font-medium text-danger-foreground disabled:opacity-50"
                    >
                      {deletingOrphans
                        ? "Borrando..."
                        : `Borrar ${orphanUsers.length} usuarios definitivamente`}
                    </button>
                    <button
                      type="button"
                      disabled={deletingOrphans}
                      onClick={() => setConfirmDeleteOrphans(false)}
                      className="rounded-lg border border-danger px-3 py-1.5 font-medium"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOrphans(true)}
                  className="mt-3 rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:opacity-70"
                >
                  Borrar estos {orphanUsers.length} usuarios
                </button>
              )}
            </>
          )}
        </section>
      </TabsContent>
    </Tabs>
  );
}

export default AdminPanel;
