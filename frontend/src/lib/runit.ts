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
export interface RoundStartedPayload {
  round_id: string;
  ends_at: string;
  capacity: number;
}

export type RoundStatus = "pending" | "active" | "closing" | "closed";

// Respuesta a round:snapshot. null si la ronda no existe o el usuario no está
// inscripto en ella.
export type RoundSnapshotEvent = {
  id: string;
  status: RoundStatus;
  paused: boolean;
  ends_at: string | null;
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

export interface RunItEvents {
  "round:started": RoundStartedPayload;
  "round:snapshot": RoundSnapshotEvent;
  "participant:joined": ParticipantJoinedEvent;
  "participant:progress": ParticipantProgressEvent;
  "round:closing_soon": RoundClosingSoonEvent;
  "round:closed": RoundClosedEvent;
  "round:paused": RoundPausedEvent;
  "tournament:winner": TournamentWinnerEvent;
}

export interface RunItFeed {
  on<K extends keyof RunItEvents>(event: K, handler: (payload: RunItEvents[K]) => void): void;
  disconnect(): void;
}

export const SILK_COUNT = 10;

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
