const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

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

export function apiUrl(path: string) {
  return `${API_URL}${path}`;
}

export async function submitCode(code: string, language: string, problemId: string) {
  const response = await fetch(`${API_URL}/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ code, language, problemId }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo enviar la solución");
  return body;
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

export async function getActiveRound() {
  const response = await fetch(`${API_URL}/public/rounds/active`);
  if (!response.ok) throw new Error("No se pudo cargar la ronda activa");
  return response.json();
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
