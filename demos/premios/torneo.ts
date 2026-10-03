// DEMO: un torneo entero ya jugado, con resultados y envíos como los guarda la
// base. La última ronda tiene cupo 1: el único que clasifica es el ganador.
import type { ResultRow, RoundResult, Submission } from "./awards";

const NAMES = [
  "Zorro", "Nova", "Trueno", "Lima", "Pixel", "Bit", "Cometa", "Rayo", "Luna", "Byte",
  "Fénix", "Turbo", "Neón", "Chispa", "Orbe", "Kilo", "Vector", "Delta", "Quark", "Eco",
  "Nébula", "Sigma", "Atlas", "Iris", "Puma", "Halcón", "Koala", "Lynx", "Mango", "Nacho",
  "Ópalo", "Pulsar", "Radar", "Sol", "Tango", "Ulises",
];
export const CAPACITIES = [12, 4, 1];
/** Cada ronda es más difícil: menos gente llega a resolver y entran los desempates. */
const DIFFICULTY = [0.7, 0.5, 0.4];
/** Personajes disponibles (lib/characters.ts). */
const CHARACTER_COUNT = 48;
const TESTS = 5;
const ROUND_SECONDS = 600;

// Azar con semilla: el mismo torneo se repite igual al recargar.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Player = { id: string; name: string; character: number; skill: number };

export function playTournament(seed: number) {
  const rand = rng(seed);
  let players: Player[] = NAMES.map((name, i) => ({
    id: `p${i}`,
    name,
    character: Math.floor(rand() * CHARACTER_COUNT),
    skill: 0.3 + rand() * 0.65,
  }));
  const rounds: RoundResult[] = [];
  const subs: Submission[] = [];
  const base = Date.UTC(2026, 9, 3, 15, 0, 0);

  CAPACITIES.forEach((capacity, r) => {
    const start = base + r * 30 * 60_000;
    const started_at = new Date(start).toISOString();
    const rows: Array<ResultRow & { pct: number; solvedMs: number | null }> = players.map((p) => {
      let passed = 0;
      let fails = 0;
      let solvedMs: number | null = null;
      let t = 20 + rand() * 60;
      // Envíos hasta resolver o hasta que se acabe el tiempo.
      while (t < ROUND_SECONDS && solvedMs === null) {
        const odds = p.skill * DIFFICULTY[r]! * (passed === TESTS - 1 ? 0.45 : 1);
        const gain = rand() < odds ? 1 + Math.floor(rand() * 2) : 0;
        const now = Math.min(TESTS, passed + gain);
        const at = new Date(start + t * 1000).toISOString();
        if (now === TESTS) {
          passed = TESTS;
          solvedMs = t * 1000;
          subs.push({ participant_id: p.id, round_number: r + 1, submitted_at: at, verdict: "accepted", passed: TESTS, total: TESTS, exec_ms: 4 + Math.floor(rand() * 180) });
        } else {
          passed = Math.max(passed, now);
          fails += 1;
          subs.push({ participant_id: p.id, round_number: r + 1, submitted_at: at, verdict: "rejected", passed: now, total: TESTS, exec_ms: null });
        }
        t += 25 + rand() * (90 - p.skill * 50);
      }
      return {
        participant_id: p.id,
        display_name: p.name,
        character: p.character,
        final_rank: 0,
        final_status: "eliminated",
        solved_at: solvedMs === null ? null : new Date(start + solvedMs).toISOString(),
        failed_attempts_count: fails,
        best_pass_percentage: Math.round((passed / TESTS) * 100),
        pct: passed,
        solvedMs,
      };
    });
    // Mismo orden que el servidor: completó por llegada, más tests, menos fallos.
    rows.sort((a, b) => {
      if ((a.solvedMs === null) !== (b.solvedMs === null)) return a.solvedMs === null ? 1 : -1;
      if (a.solvedMs !== null && b.solvedMs !== null) return a.solvedMs - b.solvedMs;
      if (a.pct !== b.pct) return b.pct - a.pct;
      return a.failed_attempts_count - b.failed_attempts_count;
    });
    rows.forEach((row, i) => {
      row.final_rank = i + 1;
      row.final_status = i < capacity ? "advanced" : "eliminated";
    });
    rounds.push({
      round_number: r + 1,
      capacity,
      started_at,
      ended_at: new Date(start + ROUND_SECONDS * 1000).toISOString(),
      rows: rows.map(({ pct: _pct, solvedMs: _ms, ...row }) => row),
    });
    players = players.filter((p) => rows.find((row) => row.participant_id === p.id)?.final_status === "advanced");
  });

  return { rounds, subs };
}
