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

export async function getTournaments() {
  const response = await fetch(`${API_URL}/tournaments`, { headers: authHeaders() });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron cargar los torneos");
  return body as Array<{ id: string; name: string; status: string }>;
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

export async function createProblem(input: {
  name: string;
  statement: string;
  difficulty: "easy" | "medium" | "hard";
  testCases: Array<{ stdin: string; expected: string }>;
}) {
  const response = await fetch(`${API_URL}/problems`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo crear el problema");
  return body as { id: string; name: string; difficulty: "easy" | "medium" | "hard" };
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
      best_pass_percentage: number;
      failed_attempts_count: number;
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
      submitted_at: string;
    }>
  >;
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
    problem_name: string;
    statement: string;
    capacity: number;
    participants: Array<{
      participant_id: string;
      name: string;
      best_pass_percentage: number;
      solved_at: string | null;
      failed_attempts_count: number;
    }>;
  } | null>;
}

export async function joinRound(roundId: string, displayName: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/participants/join`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ displayName }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo entrar a la ronda");
  return body as { id: string; display_name: string };
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
