// DEMO: ronda simulada para la pista proyectada. Las filas tienen la misma forma
// que GET /rounds/:id/leaderboard (más `character`), así el componente se conecta
// después a los datos reales sin cambios. Los eventos imitan lo que llega por
// Socket.io (participant:progress, participant:joined).
import { CHARACTERS } from "@/lib/characters";

export type Entry = {
  participant_id: string;
  display_name: string;
  character: number;
  final_rank: number | null;
  final_status: "advanced" | "eliminated" | null;
  best_pass_percentage: number;
  failed_attempts_count: number;
  solved_at: string | null;
  penalty_seconds: number;
  total_time_seconds: number | null;
};

export type FeedEvent = {
  id: number;
  at: number;
  kind: "joined" | "progress" | "fail" | "solved";
  name: string;
  character: number;
  passed?: number;
  total?: number;
  /** Orden de llegada entre los que resolvieron (1 = el primero). */
  arrival?: number;
};

export type SimRound = {
  number: number;
  problem: string;
  capacity: number;
  startsAt: number;
  endsAt: number;
  closed: boolean;
};

const NAMES = [
  "Zorro", "Nova", "Trueno", "Lima", "Pixel", "Bit", "Cometa", "Rayo", "Luna", "Byte",
  "Fénix", "Turbo", "Neón", "Chispa", "Orbe", "Kilo", "Vector", "Delta", "Quark", "Eco",
  "Nébula", "Sigma", "Atlas", "Iris", "Puma", "Halcón", "Koala", "Lynx", "Mango", "Nacho",
  "Ópalo", "Pulsar", "Radar", "Sol", "Tango", "Ulises", "Vega", "Wifi", "Xeno", "Yuki",
  "Zafiro", "Ámbar", "Brisa", "Cobra", "Dante", "Elio", "Faro", "Gala", "Hugo", "Índigo",
  "Jade", "Kiwi", "Lobo", "Mora", "Nilo", "Onix", "Pino", "Quinto", "Roca", "Salsa",
];
/** Estándar del torneo: 30 test cases por problema. */
const TESTS = 30;

type Runner = Entry & { skill: number; passed: number };

export function createSim({ participants, capacity }: { participants: number; capacity: number }) {
  const now = Date.now();
  const round: SimRound = {
    number: 1,
    problem: "Suma de dos números",
    capacity,
    startsAt: now + 3000,
    endsAt: now + 3000 + 6 * 60_000,
    closed: false,
  };
  const runners: Runner[] = Array.from({ length: participants }, (_, i) => ({
    participant_id: `p${i}`,
    display_name: NAMES[i % NAMES.length]! + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""),
    character: Math.floor(Math.random() * CHARACTERS.length),
    final_rank: null,
    final_status: null,
    best_pass_percentage: 0,
    failed_attempts_count: 0,
    solved_at: null,
    penalty_seconds: 0,
    total_time_seconds: null,
    skill: 0.25 + Math.random() * 0.7,
    passed: 0,
  }));
  let events: FeedEvent[] = [];
  let eventId = 0;
  let arrivals = 0;
  let speed = 1;
  // Segundos que suma un envío fallido; los hits del público pueden cambiarlo.
  let penalty = () => 30;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  const push = (event: Omit<FeedEvent, "id" | "at">) => {
    events = [{ ...event, id: ++eventId, at: Date.now() }, ...events].slice(0, 40);
  };

  // Mismo orden que el servidor: completó (por llegada), más tests, menos fallos.
  const ranked = (): Entry[] =>
    [...runners].sort((a, b) => {
      if (Boolean(a.solved_at) !== Boolean(b.solved_at)) return a.solved_at ? -1 : 1;
      if (a.solved_at && b.solved_at) return a.solved_at.localeCompare(b.solved_at);
      if (a.best_pass_percentage !== b.best_pass_percentage) {
        return b.best_pass_percentage - a.best_pass_percentage;
      }
      return a.penalty_seconds - b.penalty_seconds;
    });

  const close = () => {
    if (round.closed) return;
    round.closed = true;
    ranked().forEach((entry, i) => {
      const runner = runners.find((r) => r.participant_id === entry.participant_id)!;
      runner.final_rank = i + 1;
      runner.final_status = i < round.capacity ? "advanced" : "eliminated";
    });
    emit();
  };

  // Un envío al azar: el más hábil pasa más tests; pasar todos es resolver.
  const tick = () => {
    if (round.closed || Date.now() < round.startsAt) return;
    if (Date.now() >= round.endsAt) return close();
    const pending = runners.filter((r) => !r.solved_at);
    const runner = pending[Math.floor(Math.random() * pending.length)];
    if (!runner) return close();
    // Los últimos tests cuestan más: así la ronda dura y el pelotón se separa.
    const odds = runner.passed >= TESTS - 6 ? runner.skill * 0.35 : runner.skill;
    const gain = Math.random() < odds ? 2 + Math.floor(Math.random() * 6) : 0;
    const passed = Math.min(TESTS, runner.passed + gain);
    // Pasar todos los tests es resolver, como en el juez real.
    if (passed === TESTS) {
      runner.passed = TESTS;
      runner.best_pass_percentage = 100;
      runner.solved_at = new Date().toISOString();
      runner.total_time_seconds = Math.round((Date.now() - round.startsAt) / 1000) + runner.penalty_seconds;
      push({ kind: "solved", name: runner.display_name, character: runner.character, arrival: ++arrivals });
      if (arrivals >= round.capacity) close();
    } else if (passed > runner.passed) {
      runner.passed = passed;
      runner.best_pass_percentage = Math.round((passed / TESTS) * 100);
      push({ kind: "progress", name: runner.display_name, character: runner.character, passed, total: TESTS });
    } else {
      runner.failed_attempts_count += 1;
      runner.penalty_seconds += penalty();
      push({ kind: "fail", name: runner.display_name, character: runner.character, passed: runner.passed, total: TESTS });
    }
    emit();
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  const restartTimer = () => {
    clearInterval(timer);
    // Con 36 corredores llega un envío cada ~0.7 s a velocidad 1.
    timer = setInterval(tick, Math.max(60, 25000 / participants / speed));
  };
  restartTimer();

  return {
    round: () => round,
    board: ranked,
    events: () => events,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSpeed(next: number) {
      // Acelera también el reloj de la ronda para ver el final sin esperar.
      const left = round.endsAt - Date.now();
      round.endsAt = Date.now() + (left * speed) / next;
      speed = next;
      restartTimer();
    },
    close,
    setPenalty(next: () => number) {
      penalty = next;
    },
    speed: () => speed,
    stop: () => clearInterval(timer),
  };
}
