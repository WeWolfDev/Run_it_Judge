const API_URL = import.meta.env["VITE_API_URL"] ?? "";

function authHeaders() {
  const raw = window.localStorage.getItem("run-it-session");
  const session = raw ? (JSON.parse(raw) as { token?: string }) : {};
  return session.token ? { authorization: `Bearer ${session.token}` } : {};
}

export async function login(username: string, accessCode: string) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, accessCode }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo iniciar sesión");
  return body as {
    token: string;
    user: { id: string; username: string; role: "admin" | "participant" };
  };
}

export async function logout() {
  const response = await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("No se pudo cerrar la sesión");
}

export async function register(username: string, accessCode: string) {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, accessCode }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo crear el acceso");
  return body as { token: string; user: { id: string; username: string; role: "participant" } };
}

export type AccessCodeStatus = "unused" | "claimed" | "expired";

export type AccessCode = {
  id: string;
  code: string;
  status: AccessCodeStatus;
  display_name: string | null;
  claimed_at: string | null;
  created_at: string;
  tournament_id: string | null;
  tournament_name: string | null;
  expires_at: string | null;
};

export async function generateAccessCodes(input: {
  count: number;
  tournamentId?: string | null;
  ttlMinutes?: number | null;
}) {
  const response = await fetch(`${API_URL}/access-codes/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      count: input.count,
      tournamentId: input.tournamentId ?? null,
      ttlMinutes: input.ttlMinutes ?? null,
    }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron generar los códigos");
  return body as { codes: AccessCode[] };
}

export async function listAccessCodes(tournamentId?: string | null) {
  const query = tournamentId ? `?tournamentId=${encodeURIComponent(tournamentId)}` : "";
  const response = await fetch(`${API_URL}/access-codes${query}`, {
    headers: authHeaders(),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron cargar los códigos");
  return body as AccessCode[];
}

// Solo los torneos que no terminaron: alimenta todos los selectores del panel.
export async function getTournaments() {
  const response = await fetch(`${API_URL}/tournaments`, { headers: authHeaders() });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron cargar los torneos");
  return body as Array<{ id: string; name: string; status: string }>;
}

export type FinishedTournament = {
  id: string;
  name: string;
  status: "finished";
  created_at: string;
  rounds_count: number;
  participants_count: number;
  submissions_count: number;
  // Usuarios que solo jugaron este torneo: al borrarlo quedan huérfanos.
  orphaned_users_count: number;
};

// El historial: los terminados se piden explícitamente, nunca se mezclan con los
// abiertos.
export async function getFinishedTournaments() {
  const response = await fetch(`${API_URL}/tournaments?status=finished`, {
    headers: authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo cargar el historial");
  return body as FinishedTournament[];
}

export async function deleteTournament(tournamentId: string) {
  const response = await fetch(`${API_URL}/tournaments/${tournamentId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo borrar el torneo");
  return body as { deleted: true; rounds: number; participants: number; submissions: number };
}

export type OrphanUser = {
  id: string;
  username: string;
  access_code: string;
  created_at: string;
};

export async function getOrphanUsers() {
  const response = await fetch(`${API_URL}/users/orphans`, { headers: authHeaders() });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron cargar los usuarios");
  return body as OrphanUser[];
}

// Borra solo los ids revisados; el servidor vuelve a comprobar que sigan huérfanos.
export async function deleteOrphanUsers(ids: string[]) {
  const response = await fetch(`${API_URL}/users/orphans`, {
    method: "DELETE",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ ids }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron borrar los usuarios");
  return body as { deleted: number; users: Array<{ id: string; username: string }> };
}

export async function revokeAccessCodes(input: { tournamentId?: string | null; codes?: string[] }) {
  const response = await fetch(`${API_URL}/access-codes/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      tournamentId: input.tournamentId ?? null,
      codes: input.codes ?? null,
    }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron revocar los códigos");
  return body as { revoked: number; codes: string[] };
}

export async function finishTournament(tournamentId: string) {
  const response = await fetch(`${API_URL}/tournaments/${tournamentId}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({}),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo finalizar el torneo");
  return body as {
    tournament: { id: string; name: string; status: string };
    expiredAccessCodes: number;
  };
}

export async function getProblems() {
  const response = await fetch(`${API_URL}/problems`);
  if (!response.ok) throw new Error("No se pudieron cargar los problemas");
  return response.json() as Promise<Array<{ id: string; name: string; difficulty: string }>>;
}

export type ProblemDifficulty = "easy" | "medium" | "hard";

// is_sample viaja siempre: el backend guarda false si falta, y un caso que era
// ejemplo dejaría de serlo sin aviso.
export type ProblemTestCase = { stdin: string; expected: string; is_sample: boolean };

export type ProblemInput = {
  name: string;
  statement: string;
  difficulty: ProblemDifficulty;
  testCases: ProblemTestCase[];
};

// GET /problems/:id/full, solo admin. Trae los casos completos y las rondas que
// usan el problema.
export type ProblemDetail = {
  id: string;
  name: string;
  statement: string;
  difficulty: ProblemDifficulty;
  test_cases: ProblemTestCase[];
  created_at: string;
  rounds: Array<{
    id: string;
    round_number: number;
    status: string;
    tournament_name: string;
    tournament_status: string;
  }>;
};

export async function getProblemDetail(problemId: string) {
  const response = await fetch(`${API_URL}/problems/${problemId}/full`, {
    headers: authHeaders(),
  });
  const body = await response.json();
  // Fastify responde "Not Found" cuando la ruta no existe: el backend es anterior
  // a este endpoint (deploy a medias), no que falte el problema.
  if (response.status === 404 && body.error === "Not Found") {
    throw new Error("El servidor todavía no tiene esta función. Recargá en unos minutos.");
  }
  if (!response.ok) throw new Error(body.error || "No se pudo cargar el problema");
  return body as ProblemDetail;
}

export async function updateProblem(problemId: string, input: ProblemInput) {
  const response = await fetch(`${API_URL}/problems/${problemId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo guardar el problema");
  return body as { id: string; name: string; difficulty: ProblemDifficulty };
}

export async function deleteProblem(problemId: string) {
  const response = await fetch(`${API_URL}/problems/${problemId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo borrar el problema");
  // roundsKept: rondas de torneos terminados que quedan sin el vínculo, con el nombre.
  return body as { deleted: true; roundsKept: number };
}

// Solo rondas pendientes. timeLimitSeconds va en segundos: el panel convierte.
export async function updateRound(
  roundId: string,
  input: { problemId: string; capacity: number; timeLimitSeconds: number },
) {
  const response = await fetch(`${API_URL}/rounds/${roundId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo guardar la ronda");
  return body as { id: string; problem_id: string; capacity: number; time_limit_seconds: number };
}

// Solo borra rondas pendientes: el backend rechaza las que ya empezaron.
export async function deleteRound(roundId: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo borrar la ronda");
  return body as { deleted: true };
}

export async function createProblem(input: ProblemInput) {
  const response = await fetch(`${API_URL}/problems`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo crear el problema");
  return body as { id: string; name: string; difficulty: ProblemDifficulty };
}

export async function createTournament(name: string) {
  const response = await fetch(`${API_URL}/tournaments`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo crear el torneo");
  return body as { id: string; name: string };
}

export async function getTournamentRounds(tournamentId: string) {
  const response = await fetch(`${API_URL}/tournaments/${tournamentId}/rounds`, {
    headers: authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron cargar las rondas");
  return body as Array<{
    id: string;
    round_number: number;
    status: string;
    capacity: number;
    time_limit_seconds: number;
    // null en una ronda de un torneo terminado cuyo problema se borró; problem_name
    // conserva el nombre.
    problem_id: string | null;
    problem_name: string | null;
    participants_count: number;
    advanced_count: number;
    // Motivo por el que una ronda pendiente no puede iniciar todavía; null si
    // puede. Es el mismo texto que devuelve POST /rounds/:id/start.
    start_blocked_reason: string | null;
  }>;
}

export async function createRound(
  tournamentId: string,
  roundNumber: number,
  problemId: string,
  capacity: number,
  timeLimitSeconds: number,
) {
  const response = await fetch(`${API_URL}/rounds`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ tournamentId, roundNumber, problemId, capacity, timeLimitSeconds }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo crear la ronda");
  return body as { id: string; status: string };
}

export async function startRound(roundId: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/start`, {
    method: "POST",
    headers: authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo iniciar la ronda");
  return body;
}

export async function getRoundLeaderboard(roundId: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/leaderboard`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("No se pudo cargar el ranking");
  return response.json() as Promise<
    Array<{
      participant_id: string;
      display_name: string;
      final_rank: number | null;
      // Lo escribe closeRound. null mientras la ronda está abierta.
      final_status: "advanced" | "eliminated" | null;
      best_pass_percentage: number;
      failed_attempts_count: number;
      solved_at: string | null;
      penalty_seconds: number;
      // Desde el fin de la cuenta regresiva, con la penalización. null si no resolvió.
      total_time_seconds: number | null;
    }>
  >;
}

export async function getRoundSubmissions(roundId: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/submissions`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("No se pudieron cargar los resultados");
  return response.json() as Promise<
    Array<{
      id: string;
      participant_id: string;
      display_name: string;
      language: string;
      verdict: string;
      test_cases_passed: number;
      test_cases_total: number;
      case_results: Array<{ passed: boolean; status: string }>;
      submitted_at: string;
    }>
  >;
}

export type MySubmission = {
  id: string;
  participant_id: string;
  language: string;
  verdict: string;
  test_cases_passed: number;
  test_cases_total: number;
  submitted_at: string;
};

// Envíos propios en la ronda. El backend resuelve el participante desde el
// token: no se manda ningún id.
export async function getMySubmissions(roundId: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/submissions/mine`, {
    headers: authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo cargar tu historial");
  return body as MySubmission[];
}

export function apiUrl(path: string) {
  return `${API_URL}${path}`;
}

export async function closeRound(roundId: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/close`, {
    method: "POST",
    headers: authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo cerrar la ronda");
  return body;
}

export type NextRoundAdvancing = {
  participant_id: string;
  display_name: string;
  final_rank: number;
  best_pass_percentage: string;
};

export type NextRoundPreview = {
  available: boolean;
  reason?: string;
  nextRoundNumber: number;
  tournamentId: string;
  tournamentStatus: string;
  // Estado de la ronda consultada. Un backend anterior no lo manda.
  roundStatus?: string;
  advancingCount: number;
  advancing: NextRoundAdvancing[];
  existing: { id: string; round_number: number; status: string } | null;
};

export async function getNextRound(roundId: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/next`, {
    headers: authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo consultar la ronda siguiente");
  return body as NextRoundPreview;
}

export async function createNextRound(
  roundId: string,
  input: { problemId: string; capacity?: number | null; timeLimitSeconds: number },
) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/next`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      problemId: input.problemId,
      capacity: input.capacity ?? null,
      timeLimitSeconds: input.timeLimitSeconds,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo crear la ronda siguiente");
  return body as {
    round: { id: string; round_number: number; capacity: number; status: string };
    participants: number;
    advancing: NextRoundAdvancing[];
  };
}

export async function toggleRoundPause(roundId: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/pause`, {
    method: "POST",
    headers: authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo cambiar la pausa de la ronda");
  return body as { paused: boolean };
}

export async function getActiveRound() {
  const response = await fetch(`${API_URL}/public/rounds/active`);
  if (!response.ok) throw new Error("No se pudo cargar la ronda activa");
  return response.json() as Promise<{
    id: string;
    ends_at: string;
    // null en las rondas anteriores a la cuenta regresiva.
    starts_at: string | null;
    problem_name: string;
    statement: string;
    capacity: number;
    participants: Array<{
      participant_id: string;
      name: string;
      character: number;
      best_pass_percentage: number;
      solved_at: string | null;
      failed_attempts_count: number;
    }>;
  } | null>;
}

// `character` es obligatorio: el backend conserva el primero que recibe, y un
// cliente que no lo mande quedaría con el 0 por defecto para todo el torneo.
export async function joinRound(roundId: string, displayName: string, character: number) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/participants/join`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ displayName, character }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo entrar a la ronda");
  return body as { id: string; display_name: string; character: number };
}

export async function submitRound(
  roundId: string,
  participantId: string,
  code: string,
  language: string,
) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ participantId, code, language }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo enviar la solución");
  return body;
}
