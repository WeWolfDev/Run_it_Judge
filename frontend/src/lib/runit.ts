import { getSession } from "./session";

/**
 * Contrato de datos de Run It.
 *
 * Los eventos replican exactamente los emitidos por el backend vía Socket.io.
 * No hay datos de respaldo: si el backend no responde, la UI lo dice en lugar
 * de mostrar una carrera inventada.
 */

export type ParticipantStatus = "racing" | "solved" | "eliminated" | "past";

export interface Participant {
  participant_id: string;
  name: string;
  lane: number;
  silk: number; // 0..SILK_COUNT-1 -> color de casaca
  test_cases_passed: number;
  test_cases_total: number;
  attempts: number;
  solved: boolean;
  status: ParticipantStatus;
}

export interface RoundStartedEvent {
  round_id: number | string;
  ends_at: number; // timestamp del servidor (ms)
  // Fin de la cuenta regresiva (ms); 0 o ausente si la ronda no tiene.
  starts_at?: number;
  problem: string;
  capacity: number;
}

export interface ParticipantProgressEvent {
  participant_id: string;
  test_cases_passed: number;
  test_cases_total: number;
  solved: boolean;
}

export interface RoundClosingSoonEvent {
  seconds_remaining: number;
}

export interface RoundClosedEvent {
  // Un backend anterior a este campo no lo manda.
  round_id?: string;
  ranking: Array<{
    participant_id: string;
    final_rank: number;
    final_status: "advanced" | "eliminated";
  }>;
}

// El backend emite la fila completa de la ronda; solo se usan estos campos.
export interface RoundPausedEvent {
  id: string;
  paused: boolean;
}

// POST /rounds/:id/start. No trae el problema: para eso está el snapshot.
// starts_at es el fin de la cuenta regresiva; un backend viejo no lo manda.
export interface RoundStartedPayload {
  round_id: string;
  ends_at: string;
  capacity: number;
  starts_at?: string | null;
}

export type RoundStatus = "pending" | "active" | "closing" | "closed";

// Respuesta a round:snapshot. null si la ronda no existe o el usuario no está
// inscripto en ella.
export type RoundSnapshotEvent = {
  id: string;
  status: RoundStatus;
  paused: boolean;
  ends_at: string | null;
  starts_at?: string | null;
  capacity: number;
  problem_name: string;
  statement: string;
} | null;

export interface ParticipantJoinedEvent {
  round_id: string;
  participant_id: string;
  name: string;
}

export interface TournamentWinnerEvent {
  participant_id: string;
}

// POST /rounds/:id/submissions al crear el envío (verdict "queued") y el worker
// cuando el job falla (verdict "judge_error", sin display_name ni language).
export interface SubmissionQueuedEvent {
  id: string;
  round_id: string;
  participant_id: string;
  display_name?: string;
  language?: string;
  submitted_at?: string;
  verdict: string;
}

// Veredicto final de un envío. Solo llega a la sala de la ronda.
export interface SubmissionJudgedEvent {
  id: string;
  round_id: string;
  participant_id: string;
  display_name: string;
  language: string;
  verdict: string;
  test_cases_passed: number;
  test_cases_total: number;
  submitted_at: string;
}

/**
 * Nombre corto de cada `verdict` que escribe el backend. El worker guarda
 * "accepted" y "Wrong Answer" propios, y para el resto el `status.description`
 * de Judge0 tal cual; los últimos cinco son estados internos de Run It.
 */
export const VERDICT_LABEL: Record<string, string> = {
  queued: "En cola",
  // Judge0 1..13 (y 14), por su description.
  "In Queue": "En cola",
  Processing: "Procesando",
  accepted: "Aceptado",
  Accepted: "Aceptado",
  "Wrong Answer": "Respuesta incorrecta",
  "Time Limit Exceeded": "Tiempo excedido",
  "Compilation Error": "Error de compilación",
  "Runtime Error (SIGSEGV)": "Error de ejecución (SIGSEGV)",
  "Runtime Error (SIGXFSZ)": "Error de ejecución (SIGXFSZ)",
  "Runtime Error (SIGFPE)": "Error de ejecución (SIGFPE)",
  "Runtime Error (SIGABRT)": "Error de ejecución (SIGABRT)",
  "Runtime Error (NZEC)": "Error de ejecución (NZEC)",
  "Runtime Error (Other)": "Error de ejecución",
  "Internal Error": "Error interno del juez",
  "Exec Format Error": "Error de formato ejecutable",
  rejected: "Rechazado",
  no_test_cases: "Sin casos de prueba",
  round_unavailable: "Fuera de la ronda",
  queue_error: "Error de cola",
  judge_error: "Error del juez",
};

export function verdictLabel(verdict: string) {
  return VERDICT_LABEL[verdict] ?? verdict;
}

export type VerdictTone = "pending" | "success" | "danger";

export function verdictTone(verdict: string): VerdictTone {
  if (verdict === "queued" || verdict === "In Queue" || verdict === "Processing") return "pending";
  return verdict === "accepted" || verdict === "Accepted" ? "success" : "danger";
}

// Claves de LANGUAGE_IDS en judge0-client.js.
export const LANGUAGE_LABEL: Record<string, string> = { python: "Python 3", c: "C", cpp: "C++" };

type SubmissionLike = { id: string; verdict: string; submitted_at: string };

/**
 * Mezcla la lista que devolvió el servidor con la que ya está en pantalla. La
 * respuesta puede ser anterior a un evento que llegó mientras viajaba: una fila
 * que el servidor todavía da por "queued" conserva el veredicto ya recibido, y
 * un envío que el servidor aún no incluía no se pierde.
 */
export function mergeSubmissions<T extends SubmissionLike>(current: T[], fetched: T[]): T[] {
  const byId = new Map(current.map((row) => [row.id, row]));
  const merged = fetched.map((row) => {
    const known = byId.get(row.id);
    byId.delete(row.id);
    return known && row.verdict === "queued" && known.verdict !== "queued" ? known : row;
  });
  return [...byId.values(), ...merged].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
}

/** Inserta o actualiza una fila por id, sin tocar las demás. */
export function upsertSubmission<T extends SubmissionLike>(current: T[], row: T): T[] {
  if (!current.some((item) => item.id === row.id)) return [row, ...current];
  return current.map((item) => (item.id === row.id ? { ...item, ...row } : item));
}

/** Hora local HH:MM:SS de un timestamp del servidor. */
export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour12: false });
}

/**
 * Respuesta de GET /queue/stats. `round` sale de la tabla submissions y es de la
 * ronda activa; null si no hay ninguna. `pending` junta "en espera" y
 * "ejecutándose": la base guarda las dos como verdict = 'queued'. `failed` son
 * errores de infraestructura (cola, juez), nunca un WA o un CE.
 * waiting..delayed son los contadores globales de BullMQ en Redis, de todas las
 * rondas; se conservan por compatibilidad y son null si Redis no responde.
 */
export type QueueStats = {
  round: {
    id: string;
    round_number: number;
    status: string;
    tournament_id: string;
    tournament_name: string;
    total: number;
    pending: number;
    completed: number;
    failed: number;
  } | null;
  queue_available: boolean;
  waiting: number | null;
  active: number | null;
  completed: number | null;
  failed: number | null;
  delayed: number | null;
};

export interface RunItEvents {
  "round:started": RoundStartedPayload;
  "round:snapshot": RoundSnapshotEvent;
  "participant:joined": ParticipantJoinedEvent;
  "participant:progress": ParticipantProgressEvent;
  "round:closing_soon": RoundClosingSoonEvent;
  "round:closed": RoundClosedEvent;
  "round:paused": RoundPausedEvent;
  "tournament:winner": TournamentWinnerEvent;
  // El admin avanzó la ceremonia de premios (o terminó el torneo): hay que
  // volver a pedir GET /public/ceremony.
  "ceremony:update": { tournament_id: string };
  "submission:queued": SubmissionQueuedEvent;
  "submission:judged": SubmissionJudgedEvent;
  // Local, no lo emite el servidor: cada conexión y reconexión del socket. Lo
  // que se perdió mientras estaba caído se recupera volviendo a pedirlo.
  "feed:connected": undefined;
}

export interface RunItFeed {
  on<K extends keyof RunItEvents>(event: K, handler: (payload: RunItEvents[K]) => void): void;
  disconnect(): void;
}

export const SILK_COUNT = 10;

/**
 * Techo de la subida de un problema, en bytes del body ya serializado.
 *
 * Es el mismo número que `client_max_body_size` en el vhost de Nginx y que
 * `MAX_BODY_BYTES` en el backend. El formulario mide contra este valor antes de
 * enviar: subir 6 MB para que el proxy los rechace con un 413 no le dice nada a
 * quien está preparando el torneo.
 */
export const MAX_PROBLEM_PAYLOAD_BYTES = 16 * 1024 * 1024;

export function createSocketFeed(roundId = import.meta.env["VITE_ROUND_ID"]): RunItFeed | null {
  const socketUrl = import.meta.env["VITE_SOCKET_URL"];
  if (!socketUrl) return null;

  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  let socket: import("socket.io-client").Socket | null = null;
  let disconnected = false;

  void import("socket.io-client").then(({ io }) => {
    if (disconnected) return;
    socket = io(socketUrl, { auth: { token: getSession()?.token || null } });
    socket.on("connect", () => {
      if (roundId) {
        socket?.emit("round:join", roundId);
        socket?.emit("round:snapshot", roundId);
      }
      handlers.get("feed:connected")?.forEach((handler) => handler(undefined));
    });
    socket.onAny((event, payload) => {
      handlers.get(event)?.forEach((handler) => handler(payload));
    });
  });

  return {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler as (payload: unknown) => void);
      handlers.set(event, list);
    },
    disconnect() {
      disconnected = true;
      socket?.disconnect();
      handlers.clear();
    },
  };
}

/** Timer derivado del `ends_at` del servidor, nunca del reloj local. */
export function formatClock(msRemaining: number) {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}
