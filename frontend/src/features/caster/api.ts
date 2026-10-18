// Cliente HTTP del módulo caster: vista y administración de cuentas.

import { backendFetch } from "@/lib/backend-fetch";

function authHeaders(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem("run-it-session");
    const session = raw ? (JSON.parse(raw) as { token?: string }) : {};
    return session.token ? { authorization: `Bearer ${session.token}` } : {};
  } catch {
    return {};
  }
}

async function request<T>(path: string, fallback: string, init: RequestInit = {}): Promise<T> {
  const response = await backendFetch(path, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    const error = new Error(body?.error || fallback) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

export type CasterRound = {
  id: string;
  tournament_id: string;
  round_number: number;
  status: string;
  paused: boolean;
  capacity: number;
  starts_at: string | null;
  started_at: string | null;
  ends_at: string;
  problem_name: string;
  statement: string | null;
  samples: Array<{ stdin: string; expected: string }>;
};

export type CasterOverview = {
  active: CasterRound | null;
  previous: { id: string; round_number: number; problem_name: string } | null;
};

export type CasterSubmission = {
  id: string;
  participant_id: string;
  display_name: string;
  character: number;
  language: "python" | "c" | "cpp";
  verdict: string;
  test_cases_passed: number;
  test_cases_total: number;
  submitted_at: string;
  attempt: number;
  penalty_seconds: number;
};

export type CasterSubmissionList = {
  round: {
    id: string;
    round_number: number;
    status: string;
    starts_at: string | null;
    started_at: string | null;
  };
  fog: boolean;
  submissions: CasterSubmission[];
};

export type CasterSubmissionDetail = Omit<CasterSubmission, "penalty_seconds"> & {
  round_id: string;
  round_number: number;
  round_status: string;
  case_results: Array<{ passed: boolean; status: string }>;
  /** El código de un Aceptado no sale hasta que cierra la ronda. */
  locked: boolean;
  code: string | null;
};

export const getCasterOverview = () =>
  request<CasterOverview>("/caster/overview", "No se pudo cargar la ronda");

export const getCasterSubmissions = (roundId: string) =>
  request<CasterSubmissionList>(
    `/caster/rounds/${roundId}/submissions`,
    "No se pudieron cargar los envíos",
  );

export const getCasterSubmission = (submissionId: string) =>
  request<CasterSubmissionDetail>(
    `/caster/submissions/${submissionId}`,
    "No se pudo cargar el envío",
  );

// Cuentas de caster (solo el admin).
export type CasterAccount = {
  id: string;
  username: string;
  access_code: string;
  created_at: string;
};

export const listCasters = () =>
  request<CasterAccount[]>("/casters", "No se pudieron cargar los casters");

/** Sin `accessCode` el servidor genera uno de 12 caracteres. */
export const createCaster = (username: string, accessCode?: string) =>
  request<CasterAccount>("/casters", "No se pudo crear el caster", {
    method: "POST",
    body: JSON.stringify(accessCode ? { username, accessCode } : { username }),
  });

export const deleteCaster = (id: string) =>
  request<{ deleted: string }>(`/casters/${id}`, "No se pudo borrar el caster", {
    method: "DELETE",
  });

/** Veredicto corto y su color, para la tabla de envíos y la grilla de casos. */
export function verdictStyle(verdict: string): { code: string; color: string } {
  if (verdict === "accepted" || verdict === "Accepted")
    return { code: "AC", color: "var(--success)" };
  if (verdict === "Wrong Answer") return { code: "WA", color: "var(--danger)" };
  if (verdict === "Time Limit Exceeded") return { code: "TLE", color: "var(--gold)" };
  // CE y RE con colores fijos: en algunas paletas info y accent se parecen.
  if (verdict === "Compilation Error") return { code: "CE", color: "#a78bfa" };
  if (verdict.startsWith("Runtime Error")) return { code: "RE", color: "#fb923c" };
  if (verdict === "queued" || verdict === "In Queue" || verdict === "Processing")
    return { code: "…", color: "var(--muted-foreground)" };
  return { code: "ERR", color: "var(--muted-foreground)" };
}
