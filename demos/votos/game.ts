import { confetti } from "@/lib/confetti";
import type { createSim } from "../proyeccion/sim";
import { ANNOUNCE_MS, HITS, MAX_POLLS, PAIRS, POLL_MS, QUIET_END_MS, QUIET_START_MS, type HitId } from "./hits";

// DEMO: estado de la votación. En la app vive en el servidor (hit_polls,
// hit_votes, round_hits) y viaja por Socket.io; acá es un objeto en memoria
// con suscriptores, encima de la ronda simulada.

type Sim = ReturnType<typeof createSim>;

export type Poll = {
  pair: number;
  /** Cuándo se anunció: hasta opensAt se ve "Votación próxima" y no se vota. */
  announcedAt: number;
  opensAt: number;
  closesAt: number;
  votes: { good: number; bad: number };
  mine: "good" | "bad" | null;
  /** null mientras está abierta. */
  winner: HitId | null;
};

export type ActiveHit = { id: HitId; startedAt: number; endsAt: number };

export type Feed = { id: number; at: number; text: string };

export function createGame(sim: Sim) {
  let poll: Poll | null = null;
  let polls: Poll[] = [];
  let active: ActiveHit[] = [];
  let applied: Array<{ id: HitId; at: number }> = [];
  let hint = false;
  let toast: Feed | null = null;
  let toastId = 0;
  let crowd: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const say = (text: string) => {
    toast = { id: ++toastId, at: Date.now(), text };
  };

  // Penalización según los hits activos: amnistía 0 s, doble 60 s.
  sim.setPenalty(() => {
    const now = Date.now();
    const on = (id: HitId) => active.some((h) => h.id === id && h.endsAt > now);
    if (on("amnistia")) return 0;
    if (on("penal-doble")) return 60;
    return 30;
  });

  /** Por qué no se puede abrir una votación ahora (o null si se puede). */
  function blockReason(pairIndex: number): string | null {
    const round = sim.round();
    const now = Date.now();
    if (round.closed) return "La ronda ya terminó";
    if (now < round.startsAt) return "La ronda todavía no empezó";
    if (poll && !poll.winner) return "Ya hay una votación abierta";
    if (polls.length >= MAX_POLLS) return `Ya hubo ${MAX_POLLS} votaciones en esta ronda`;
    const elapsed = (now - round.startsAt) * sim.speed();
    const left = (round.endsAt - now) * sim.speed();
    if (elapsed < QUIET_START_MS) return "Sin votaciones en el primer minuto";
    if (left < QUIET_END_MS + (ANNOUNCE_MS + POLL_MS) * sim.speed()) return "Sin votaciones en los últimos 2 minutos";
    const pair = PAIRS[pairIndex]!;
    const used = new Set(applied.map((a) => a.id));
    if (used.has(pair.good) || used.has(pair.bad)) return "Ese par ya se usó en esta ronda";
    if (pair.weight === 3 && round.capacity <= 2) return "Con cupo 2 o menos no se tocan los cupos";
    return null;
  }

  function open(pairIndex: number) {
    if (blockReason(pairIndex)) return;
    const now = Date.now();
    const opensAt = now + ANNOUNCE_MS;
    poll = { pair: pairIndex, announcedAt: now, opensAt, closesAt: opensAt + POLL_MS, votes: { good: 0, bad: 0 }, mine: null, winner: null };
    polls = [...polls, poll];
    // La grada: votos que llegan con el QR durante la votación.
    const lean = 0.35 + Math.random() * 0.3;
    crowd = setInterval(() => {
      if (!poll || poll.winner) return;
      if (Date.now() < poll.opensAt) return;
      if (Date.now() >= poll.closesAt) return close();
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        if (Math.random() < lean) poll.votes.good += 1;
        else poll.votes.bad += 1;
      }
      emit();
    }, 450);
    emit();
  }

  function vote(side: "good" | "bad") {
    if (!poll || poll.winner || poll.mine || Date.now() < poll.opensAt) return;
    poll.mine = side;
    poll.votes[side] += 1;
    emit();
  }

  function close() {
    if (!poll || poll.winner) return;
    clearInterval(crowd);
    const pair = PAIRS[poll.pair]!;
    const { good, bad } = poll.votes;
    // Empate: se sortea; nunca decide el organizador.
    const goodWins = good === bad ? Math.random() < 0.5 : good > bad;
    poll.winner = goodWins ? pair.good : pair.bad;
    apply(poll.winner);
    emit();
  }

  function apply(id: HitId) {
    const round = sim.round();
    const hit = HITS[id];
    const now = Date.now();
    applied = [...applied, { id, at: now }];
    switch (id) {
      case "extra":
        round.endsAt += 60_000 / sim.speed();
        say("La grada sumó 1 minuto al reloj");
        break;
      case "cupo-mas":
        round.capacity = Math.min(round.capacity + 1, sim.board().length - 1);
        say(`La grada sumó un lugar: ahora clasifican ${round.capacity}`);
        break;
      case "cupo-menos":
        round.capacity = Math.max(2, round.capacity - 1);
        say(`La grada quitó un lugar: ahora clasifican ${round.capacity}`);
        break;
      case "pista":
        hint = true;
        say("La grada desbloqueó una pista del organizador");
        break;
      case "aliento":
        confetti({ x: 0.5, y: 0.35 });
        say("¡La grada te alienta!");
        break;
      default:
        say(`Hit de la grada: ${hit.name}`);
    }
    if (hit.duration) {
      active = [...active, { id, startedAt: now, endsAt: now + hit.duration / sim.speed() }];
    }
  }

  /** Cancela una votación anunciada que todavía no abrió: no cuenta para el máximo. */
  function abort() {
    if (!poll || poll.winner || Date.now() >= poll.opensAt) return;
    clearInterval(crowd);
    polls = polls.filter((p) => p !== poll);
    poll = null;
    emit();
  }

  function cancel(id: HitId) {
    active = active.filter((h) => h.id !== id);
    emit();
  }

  // Los hits con duración vencen solos.
  const tick = setInterval(() => {
    const now = Date.now();
    const before = active.length;
    active = active.filter((h) => h.endsAt > now);
    if (active.length !== before) emit();
    if (poll && !poll.winner && now >= poll.closesAt) close();
    // El paso de anuncio a votación abierta también se avisa.
    if (poll && !poll.winner && now >= poll.opensAt && now - poll.opensAt < 260) emit();
  }, 250);

  return {
    poll: () => poll,
    /** Anunciada pero todavía sin abrir. */
    announcing: () => Boolean(poll && !poll.winner && Date.now() < poll.opensAt),
    polls: () => polls,
    active: () => active,
    applied: () => applied,
    hint: () => hint,
    toast: () => toast,
    isOn: (id: HitId) => active.some((h) => h.id === id && h.endsAt > Date.now()),
    left: (id: HitId) => {
      const hit = active.find((h) => h.id === id);
      return hit ? Math.max(0, hit.endsAt - Date.now()) * sim.speed() : 0;
    },
    blockReason,
    open,
    vote,
    close,
    abort,
    cancel,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      clearInterval(crowd);
      clearInterval(tick);
    },
  };
}

export type Game = ReturnType<typeof createGame>;
