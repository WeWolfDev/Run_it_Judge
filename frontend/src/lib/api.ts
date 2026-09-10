const API_URL = import.meta.env.VITE_API_URL ?? "";

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
  return body as { token: string; user: { id: string; username: string; role: "admin" | "participant" } };
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

export async function generateAccessCodes(count: number) {
  const response = await fetch(`${API_URL}/access-codes/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ count }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron generar los códigos");
  return body as { codes: string[] };
}

export async function getProblems() {
  const response = await fetch(`${API_URL}/problems`);
  if (!response.ok) throw new Error("No se pudieron cargar los problemas");
  return response.json() as Promise<Array<{ id: string; name: string; difficulty: string }>>;
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
  return response.json() as Promise<Array<{
    participant_id: string;
    display_name: string;
    final_rank: number | null;
    best_pass_percentage: number;
    failed_attempts_count: number;
  }>>;
}

export async function getRoundSubmissions(roundId: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/submissions`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("No se pudieron cargar los resultados");
  return response.json() as Promise<Array<{
    id: string;
    participant_id: string;
    display_name: string;
    language: string;
    verdict: string;
    test_cases_passed: number;
    test_cases_total: number;
    submitted_at: string;
  }>>;
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
    test_cases: Array<{ stdin?: string; expected?: string }>;
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

export async function submitRound(roundId: string, participantId: string, code: string, language: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ participantId, code, language }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo enviar la solución");
  return body;
}
