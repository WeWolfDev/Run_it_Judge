// Torneo simulado para el tráiler: 20 jugadores en la pista real (ProjectedTrack)
// con envíos acelerados, para que en pocos segundos se vea avanzar, fallar y
// clasificar a la gente. Sin servidor: todo corre en la página.

import type { Entry, FeedEvent, TrackRound } from "@/components/ProjectedTrack";
import { CHARACTERS } from "@/lib/characters";

/** Los jugadores del tráiler: el banco de nombres de los ejercicios y alias de la grada. */
export const PLAYERS = [
  "Leo",
  "Cesar",
  "Misa",
  "Joselo",
  "Dani",
  "Andy",
  "Maricarmen",
  "Rodrigo",
  "byte_runner",
  "lucia.dev",
  "kevin99",
  "ana_codes",
  "mateo.cpp",
  "sofi_py",
  "diegoAC",
  "vale_wa",
  "nico.tle",
  "camila.o1",
  "jose_dp",
  "maria.bfs",
];

/** Personaje fijo por jugador, repartido por toda la colección. */
export const characterOf = (name: string) =>
  (PLAYERS.indexOf(name) * 7 + 3 + CHARACTERS.length) % CHARACTERS.length;

type Runner = {
  id: string;
  name: string;
  best: number;
  fails: number;
  penalty: number;
  solvedAt: number | null;
};

export type Race = {
  round: TrackRound;
  runners: Runner[];
  events: FeedEvent[];
  seq: number;
};

const pick = <T>(list: T[]) =>
  list[Math.floor(Math.random() * list.length)] as T;

export function createRace(now: number): Race {
  // La ronda ya va por la mitad: hay ranking desde el primer cuadro.
  const startsAt = now - 6 * 60_000;
  return {
    round: {
      number: 3,
      problem: "Los saltos de Cesar",
      capacity: 8,
      startsAt,
      endsAt: startsAt + 15 * 60_000,
      closed: false,
    },
    runners: PLAYERS.map((name, index) => ({
      id: `p${index}`,
      name,
      // Unos cuantos ya van adelante: los primeros clasifican enseguida.
      best: index < 5 ? pick([60, 70, 70, 80]) : pick([0, 10, 20, 30, 40, 50]),
      fails: Math.floor(Math.random() * 3),
      penalty: 0,
      solvedAt: null,
    })),
    events: [],
    seq: 0,
  };
}

/** Un envío de alguien que todavía no resolvió. */
export function stepRace(race: Race, now: number) {
  const pending = race.runners.filter((r) => r.solvedAt === null);
  const solved = race.runners.length - pending.length;
  if (!pending.length || solved >= race.round.capacity) return;
  const runner = pick(pending);
  const base = {
    id: ++race.seq,
    at: now,
    name: runner.name,
    character: characterOf(runner.name),
  };
  const roll = Math.random();
  if (runner.best >= 70 && roll < 0.4) {
    runner.best = 100;
    runner.solvedAt = now;
    race.events = [
      { ...base, kind: "solved" as const, arrival: solved + 1 },
      ...race.events,
    ].slice(0, 40);
    return;
  }
  const improves = roll < 0.75 && runner.best < 90;
  if (improves)
    runner.best = Math.min(90, runner.best + pick([10, 20, 20, 30]));
  else {
    runner.fails += 1;
    runner.penalty += 30;
  }
  const passed = Math.round((runner.best / 100) * 30);
  race.events = [
    {
      ...base,
      kind: improves ? ("progress" as const) : ("fail" as const),
      passed,
      total: 30,
    },
    ...race.events,
  ].slice(0, 40);
}

/** El ranking en el formato de la pista: resueltos primero, después por avance. */
export function boardOf(race: Race): Entry[] {
  return [...race.runners]
    .sort((a, b) => {
      if (a.solvedAt !== null && b.solvedAt !== null)
        return a.solvedAt - b.solvedAt;
      if (a.solvedAt !== null) return -1;
      if (b.solvedAt !== null) return 1;
      return (
        b.best - a.best || a.fails - b.fails || a.name.localeCompare(b.name)
      );
    })
    .map((runner) => ({
      participant_id: runner.id,
      display_name: runner.name,
      character: characterOf(runner.name),
      final_rank: null,
      final_status: null,
      best_pass_percentage: runner.best,
      failed_attempts_count: runner.fails,
      solved_at:
        runner.solvedAt === null
          ? null
          : new Date(runner.solvedAt).toISOString(),
      penalty_seconds: runner.penalty,
    }));
}
