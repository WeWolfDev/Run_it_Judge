/**
 * Contrato de datos de Run It.
 *
 * Los eventos replican exactamente los emitidos por el backend vía Socket.io.
 * Mientras no exista backend, `createMockFeed()` los emite localmente.
 * Para conectar el backend real basta con reemplazar `createMockFeed` por
 * una implementación sobre `socket.io-client` que respete `RunItFeed`.
 */

export type ParticipantStatus = "racing" | "solved" | "eliminated" | "past";

export interface Participant {
  participant_id: string;
  name: string;
  lane: number;
  silk: number; // 0..5 -> color de casaca
  test_cases_passed: number;
  test_cases_total: number;
  attempts: number;
  solved: boolean;
  status: ParticipantStatus;
}

export interface RoundStartedEvent {
  round_id: number;
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
    final_status: "qualified" | "eliminated";
  }>;
}

export interface RoundPausedEvent {
  paused: boolean;
}

export interface TournamentWinnerEvent {
  participant_id: string;
}

export interface RunItEvents {
  "round:started": RoundStartedEvent;
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

/* ------------------------------- datos mock ------------------------------ */

export const MOCK_PARTICIPANTS: Participant[] = [
  { participant_id: "p1", name: "ada_lovelace", lane: 1, silk: 0, test_cases_passed: 7, test_cases_total: 10, attempts: 3, solved: false, status: "racing" },
  { participant_id: "p2", name: "linus_t", lane: 2, silk: 1, test_cases_passed: 10, test_cases_total: 10, attempts: 2, solved: true, status: "solved" },
  { participant_id: "p3", name: "grace_h", lane: 3, silk: 2, test_cases_passed: 4, test_cases_total: 10, attempts: 5, solved: false, status: "racing" },
  { participant_id: "p4", name: "kernighan", lane: 4, silk: 3, test_cases_passed: 0, test_cases_total: 10, attempts: 4, solved: false, status: "eliminated" },
  { participant_id: "p5", name: "margaret_h", lane: 5, silk: 4, test_cases_passed: 6, test_cases_total: 10, attempts: 1, solved: false, status: "racing" },
  { participant_id: "p6", name: "dijkstra", lane: 6, silk: 5, test_cases_passed: 9, test_cases_total: 10, attempts: 6, solved: false, status: "racing" },
  { participant_id: "p7", name: "hopper_jr", lane: 7, silk: 1, test_cases_passed: 2, test_cases_total: 10, attempts: 2, solved: false, status: "racing" },
  { participant_id: "p8", name: "turing_a", lane: 8, silk: 0, test_cases_passed: 0, test_cases_total: 10, attempts: 1, solved: false, status: "past" },
];

export const MOCK_ROUND: RoundStartedEvent = {
  round_id: 3,
  problem: "Sliding Window Maximum",
  capacity: 4,
  ends_at: Date.now() + 7 * 60 * 1000 + 24 * 1000,
};

export const MOCK_ROUNDS_PROGRESS = [
  { round: 1, entered: 200, advanced: 100, state: "done" as const },
  { round: 2, entered: 100, advanced: 40, state: "done" as const },
  { round: 3, entered: 40, advanced: null, state: "active" as const },
  { round: 4, entered: 12, advanced: null, state: "upcoming" as const },
  { round: 5, entered: 4, advanced: null, state: "upcoming" as const },
];

export const SILK_COUNT = 6;

/** Feed simulado: emite `participant:progress` como lo haría el socket real. */
export function createMockFeed(participants: Participant[]): RunItFeed {
  const handlers = new Map<string, Array<(p: unknown) => void>>();
  const state = participants.map((p) => ({ ...p }));

  const interval = setInterval(() => {
    const live = state.filter((p) => p.status === "racing");
    if (live.length === 0) return;
    const target = live[Math.floor(Math.random() * live.length)];
    if (!target || Math.random() < 0.55) return;
    target.test_cases_passed = Math.min(target.test_cases_total, target.test_cases_passed + 1);
    target.solved = target.test_cases_passed === target.test_cases_total;
    (handlers.get("participant:progress") ?? []).forEach((h) =>
      h({
        participant_id: target.participant_id,
        test_cases_passed: target.test_cases_passed,
        test_cases_total: target.test_cases_total,
        solved: target.solved,
      } satisfies ParticipantProgressEvent),
    );
  }, 1400);

  return {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler as (p: unknown) => void);
      handlers.set(event, list);
    },
    disconnect() {
      clearInterval(interval);
      handlers.clear();
    },
  };
}

export function createSocketFeed(): RunItFeed | null {
  const socketUrl = import.meta.env.VITE_SOCKET_URL;
  if (!socketUrl) return null;

  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  let socket: import("socket.io-client").Socket | null = null;

  void import("socket.io-client").then(({ io }) => {
    socket = io(socketUrl);
    socket.on("connect", () => {
      const roundId = import.meta.env.VITE_ROUND_ID;
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
