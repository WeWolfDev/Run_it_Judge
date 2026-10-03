// DEMO: cálculo de los premios honoríficos a partir de los resultados del
// torneo. Es una función pura sobre datos que la base ya guarda
// (round_participants y submissions), salvo `exec_ms`: el tiempo de ejecución
// del juez hoy no se guarda en submissions (habría que agregarlo).

export type ResultRow = {
  participant_id: string;
  display_name: string;
  character: number;
  final_rank: number;
  final_status: "advanced" | "eliminated";
  solved_at: string | null;
  failed_attempts_count: number;
  best_pass_percentage: number;
};

export type RoundResult = {
  round_number: number;
  capacity: number;
  /** Fin de la cuenta regresiva: desde ahí corre el tiempo. */
  started_at: string;
  /** Cierre de la ronda (rounds.ends_at o el momento en que se llenó el cupo). */
  ended_at: string;
  rows: ResultRow[];
};

export type Submission = {
  participant_id: string;
  round_number: number;
  submitted_at: string;
  verdict: "accepted" | "rejected";
  passed: number;
  total: number;
  /** Tiempo de ejecución del juez (máximo entre casos). Solo en aceptados. */
  exec_ms: number | null;
};

export type Award = {
  id: string;
  title: string;
  /** Qué premia, para leerlo en pantalla antes de revelar al ganador. */
  description: string;
  winner: { participant_id: string; display_name: string; character: number };
  /** El dato que lo justifica, en una línea. */
  detail: string;
};

type Who = Award["winner"];
const who = (row: ResultRow): Who => ({
  participant_id: row.participant_id,
  display_name: row.display_name,
  character: row.character,
});

const seconds = (from: string, to: string) =>
  Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Ranking en cada momento de la ronda, rearmado con los envíos en orden: el
// mismo criterio del servidor (completó por llegada, más tests, menos fallos).
// Devuelve el peor puesto de cada uno en la segunda mitad de la ronda: al
// principio todos están últimos porque nadie envió nada, y eso no es remontar.
function rankTimeline(round: RoundResult, subs: Submission[]) {
  const half = new Date(
    (new Date(round.started_at).getTime() + new Date(round.ended_at).getTime()) / 2,
  ).toISOString();
  const state = new Map<string, { pct: number; solved: string | null; fails: number }>();
  for (const row of round.rows) state.set(row.participant_id, { pct: 0, solved: null, fails: 0 });
  const worst = new Map<string, number>();
  const ordered = subs
    .filter((s) => s.round_number === round.round_number)
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  for (const sub of ordered) {
    const st = state.get(sub.participant_id);
    if (!st) continue;
    if (sub.verdict === "accepted") {
      st.solved ??= sub.submitted_at;
      st.pct = 100;
    } else {
      st.fails += 1;
      st.pct = Math.max(st.pct, Math.round((sub.passed / Math.max(1, sub.total)) * 100));
    }
    const ranking = [...state.entries()].sort(([, a], [, b]) => {
      if (Boolean(a.solved) !== Boolean(b.solved)) return a.solved ? -1 : 1;
      if (a.solved && b.solved) return a.solved.localeCompare(b.solved);
      if (a.pct !== b.pct) return b.pct - a.pct;
      return a.fails - b.fails;
    });
    if (sub.submitted_at < half) continue;
    ranking.forEach(([id], i) => worst.set(id, Math.max(worst.get(id) ?? 0, i + 1)));
  }
  return worst;
}

export function computeAwards(rounds: RoundResult[], subs: Submission[]): Award[] {
  const awards: Award[] = [];
  const sorted = [...rounds].sort((a, b) => a.round_number - b.round_number);
  const first = sorted[0];
  const final = sorted[sorted.length - 1];
  if (!first || !final) return awards;

  // El Ave Fénix: clasificó después de haber estado más lejos del corte.
  let phoenix: { row: ResultRow; gap: number; round: number; worst: number } | null = null;
  for (const round of sorted) {
    const worst = rankTimeline(round, subs);
    for (const row of round.rows) {
      if (row.final_status !== "advanced") continue;
      const gap = (worst.get(row.participant_id) ?? 0) - round.capacity;
      if (gap > 0 && (!phoenix || gap > phoenix.gap)) {
        phoenix = { row, gap, round: round.round_number, worst: worst.get(row.participant_id)! };
      }
    }
  }
  if (phoenix) {
    awards.push({
      id: "fenix",
      title: "El Ave Fénix",
      description: "La remontada del torneo: clasificó estando al borde de la eliminación.",
      winner: who(phoenix.row),
      detail: `En la ronda ${phoenix.round} llegó a ir ${phoenix.worst}.º (cupo ${phoenix.worst - phoenix.gap}) y clasificó.`,
    });
  }

  // El Matagigantes: la peor preclasificación (ranking de la ronda 1) que
  // terminó por encima de uno de los 3 favoritos en la ronda que lo eliminó.
  const seed = new Map(first.rows.map((r) => [r.participant_id, r.final_rank]));
  const favorites = first.rows.filter((r) => r.final_rank <= 3).map((r) => r.participant_id);
  let giant: { row: ResultRow; seed: number; favoriteSeed: number; beaten: string; round: number } | null = null;
  for (const round of sorted.slice(1)) {
    for (const fav of round.rows.filter((r) => favorites.includes(r.participant_id) && r.final_status === "eliminated")) {
      for (const row of round.rows) {
        const s = seed.get(row.participant_id) ?? 0;
        // A igual revelación, se nombra al favorito mejor preclasificado.
        const favoriteSeed = seed.get(fav.participant_id) ?? 0;
        const better = !giant || s > giant.seed || (s === giant.seed && favoriteSeed < giant.favoriteSeed);
        if (row.final_rank < fav.final_rank && s > 3 && better) {
          giant = { row, seed: s, favoriteSeed, beaten: fav.display_name, round: round.round_number };
        }
      }
    }
  }
  if (giant) {
    awards.push({
      id: "matagigantes",
      title: "El Matagigantes",
      description: "El jugador revelación que dejó afuera a uno de los grandes favoritos.",
      winner: who(giant.row),
      detail: `Preclasificado ${giant.seed}.º, quedó por encima de ${giant.beaten} en la ronda ${giant.round}.`,
    });
  }

  // Superviviente: más clasificaciones sin resolver (por desempate de tests).
  const survivals = new Map<string, { row: ResultRow; n: number }>();
  for (const round of sorted) {
    for (const row of round.rows) {
      if (row.final_status === "advanced" && !row.solved_at) {
        const prev = survivals.get(row.participant_id);
        survivals.set(row.participant_id, { row, n: (prev?.n ?? 0) + 1 });
      }
    }
  }
  const survivor = [...survivals.values()].sort((a, b) => b.n - a.n)[0];
  if (survivor) {
    awards.push({
      id: "superviviente",
      title: "Superviviente",
      description: "Clasificó sin resolver: el cupo no se llenó y pasó por desempate.",
      winner: who(survivor.row),
      detail: `Sobrevivió ${survivor.n} ${survivor.n === 1 ? "ronda" : "rondas"} sin completar el problema.`,
    });
  }

  // El Verdugo: más rondas ganadas por la vía rápida (1.º en resolver).
  const firsts = new Map<string, { row: ResultRow; n: number }>();
  for (const round of sorted) {
    const winner = round.rows.find((r) => r.final_rank === 1 && r.solved_at);
    if (winner) {
      const prev = firsts.get(winner.participant_id);
      firsts.set(winner.participant_id, { row: winner, n: (prev?.n ?? 0) + 1 });
    }
  }
  const executioner = [...firsts.values()].sort((a, b) => b.n - a.n)[0];
  if (executioner) {
    awards.push({
      id: "verdugo",
      title: "El Verdugo",
      description: "Más rondas ganadas por la vía rápida: primero en resolver.",
      winner: who(executioner.row),
      detail: `Fue el primero en resolver en ${executioner.n} ${executioner.n === 1 ? "ronda" : "rondas"}.`,
    });
  }

  // El Rayo del AC: el primer Accepted del torneo.
  const firstAc = subs
    .filter((s) => s.verdict === "accepted")
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))[0];
  if (firstAc) {
    const round = sorted.find((r) => r.round_number === firstAc.round_number)!;
    const row = round.rows.find((r) => r.participant_id === firstAc.participant_id)!;
    awards.push({
      id: "rayo",
      title: "El Rayo del AC",
      description: "El primer Accepted del torneo: el globo verde inicial.",
      winner: who(row),
      detail: `Accepted a los ${clock(seconds(round.started_at, firstAc.submitted_at))} de la ronda ${round.round_number}.`,
    });
  }

  // Compilador O(1) Humano: el aceptado con menor tiempo de ejecución.
  const fastest = subs
    .filter((s) => s.verdict === "accepted" && s.exec_ms !== null)
    .sort((a, b) => a.exec_ms! - b.exec_ms! || a.submitted_at.localeCompare(b.submitted_at))[0];
  if (fastest) {
    const round = sorted.find((r) => r.round_number === fastest.round_number)!;
    const row = round.rows.find((r) => r.participant_id === fastest.participant_id)!;
    awards.push({
      id: "o1",
      title: "Compilador O(1) Humano",
      description: "La solución más rápida en los servidores del juez.",
      winner: who(row),
      detail: `${fastest.exec_ms} ms de ejecución en la ronda ${round.round_number}.`,
    });
  }

  // Amigo del Penalizador: más envíos fallidos en un mismo problema.
  let friend: { row: ResultRow; fails: number; round: number } | null = null;
  for (const round of sorted) {
    for (const row of round.rows) {
      if (!friend || row.failed_attempts_count > friend.fails) {
        friend = { row, fails: row.failed_attempts_count, round: round.round_number };
      }
    }
  }
  if (friend && friend.fails > 0) {
    awards.push({
      id: "penalizador",
      title: "Amigo del Penalizador",
      description: "No se rindió: más envíos fallidos en un solo problema.",
      winner: who(friend.row),
      detail: `${friend.fails} envíos fallidos en la ronda ${friend.round}${friend.row.solved_at ? ", y lo sacó" : ", con honor"}.`,
    });
  }

  // GMA: el ganador del torneo, al final de la ceremonia.
  const champion = final.rows.find((r) => r.final_status === "advanced");
  if (champion) {
    awards.push({
      id: "gma",
      title: "GMA · Gran Maestro del Algoritmo",
      description: "El ganador del torneo.",
      winner: who(champion),
      detail: `Último en pie de ${first.rows.length} corredores, en ${sorted.length} rondas.`,
    });
  }
  return awards;
}
