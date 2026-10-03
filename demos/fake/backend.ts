// Backend simulado de Run It para las demos. Intercepta window.fetch y responde
// las mismas rutas REST que run-it-backend/index.js, con el estado en memoria
// (y en localStorage, para que sobreviva a recargar). Los eventos de Socket.io
// salen por el bus de fake/socket.ts.
//
// Cosas que el backend real todavía NO hace y acá sí (son propuestas de la demo):
//  - PUT /tournaments/:id/plan: planificar todas las rondas de una vez, con
//    dificultad por ronda.
//  - GET /access-codes omite los códigos vencidos o invalidados.
//  - Unirse a la primera ronda mientras está pendiente (sala de espera).
//  - Desempate: completó > llegada (puesto directo) > tests > penalizaciones.
//  - La cuenta regresiva de 10 s no descuenta tiempo de la ronda.
import { broadcast, toRoom, onClientEmit } from "./socket";

type Difficulty = "easy" | "medium" | "hard";
type TestCase = { stdin: string; expected: string; is_sample: boolean };
type Problem = { id: string; name: string; statement: string; difficulty: Difficulty; test_cases: TestCase[]; created_at: string };
type Tournament = { id: string; name: string; status: "pending" | "active" | "finished"; created_at: string };
type Round = {
  id: string; tournament_id: string; round_number: number; problem_id: string | null; problem_name: string;
  capacity: number; time_limit_seconds: number; status: "pending" | "active" | "closing" | "closed";
  paused: boolean; paused_at: number | null; started_at: string | null; starts_at: string | null; ends_at: string | null;
  difficulty: Difficulty | null; created_at: string;
};
type User = { id: string; username: string; role: "admin" | "participant"; access_code: string; token: string; created_at: string; bot: boolean };
type Participant = { id: string; user_id: string; tournament_id: string; display_name: string; character: number; status: "active" | "eliminated"; created_at: string };
type RP = {
  round_id: string; participant_id: string; best_pass_percentage: number; failed_attempts_count: number;
  penalty_seconds: number; solved_at: string | null; final_rank: number | null; final_status: "advanced" | "eliminated" | null; joined_at: string;
};
type Submission = {
  id: string; round_id: string; participant_id: string; code: string; language: string; verdict: string;
  test_cases_passed: number; test_cases_total: number; case_results: Array<{ passed: boolean; status: string }>; submitted_at: string;
};
type Code = { id: string; code: string; status: "unused" | "claimed" | "expired"; display_name: string | null; claimed_at: string | null; created_at: string; tournament_id: string | null; expires_at: string | null };
type State = {
  version: number; problems: Problem[]; tournaments: Tournament[]; rounds: Round[]; users: User[]; participants: Participant[];
  rps: RP[]; submissions: Submission[]; codes: Code[];
};

export type DemoKind = "admin" | "participante";
const STATE_VERSION = 4;
const COUNTDOWN_MS = 10_000;
const PENALTY_S = 30;
const BOT_NAMES = ["Zorro", "Pixel", "Nova", "Trueno", "Lima", "Canela", "Brasa", "Aurora", "Nilo", "Mango", "Sol", "Trébol"];

let kind: DemoKind = "admin";
let state: State;
const now = () => Date.now();
const iso = (ms = now()) => new Date(ms).toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2) + Date.now().toString(16));
const codeString = () => Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
const storageKey = () => `run-it-demo-${kind}-v${STATE_VERSION}`;

// ---------------- Semillas ----------------
function seedProblems(): Problem[] {
  const p = (name: string, difficulty: Difficulty, statement: string, cases: Array<[string, string, boolean]>): Problem => ({
    id: uid(), name, difficulty, statement, created_at: iso(now() - 86400000),
    test_cases: cases.map(([stdin, expected, is_sample]) => ({ stdin, expected, is_sample })),
  });
  return [
    p("Suma de dos números", "easy", "Lee dos enteros $a$ y $b$ de la entrada estándar e imprime $a + b$.\n\n**Entrada:** una línea con $a$ y $b$ ($-10^9 \\le a, b \\le 10^9$).\n\n**Salida:** un entero.",
      [["2 3", "5", true], ["10 -4", "6", true], ["0 0", "0", false], ["1000000000 1000000000", "2000000000", false], ["-7 -8", "-15", false]]),
    p("Palíndromo", "easy", "Dada una palabra en minúsculas, imprime `SI` si se lee igual al revés y `NO` si no.",
      [["oso", "SI", true], ["runit", "NO", true], ["a", "SI", false], ["reconocer", "SI", false]]),
    p("Máximo de una lista", "medium", "Lee $n$ y luego $n$ enteros. Imprime el mayor.",
      [["3\n4 9 2", "9", true], ["1\n-5", "-5", false], ["5\n1 2 3 4 5", "5", false]]),
    p("Subarreglo de suma máxima", "medium", "Dado un arreglo de $n$ enteros, imprime la mayor suma de un subarreglo contiguo no vacío.",
      [["5\n-2 1 -3 4 -1", "4", true], ["3\n-1 -2 -3", "-1", false], ["4\n1 2 3 4", "10", false]]),
    p("Caminos en una grilla", "hard", "Cuenta los caminos desde la esquina superior izquierda hasta la inferior derecha de una grilla $n \\times m$ moviéndote solo a la derecha o abajo, módulo $10^9+7$.",
      [["2 2", "2", true], ["3 3", "6", true], ["1 5", "1", false], ["10 10", "48620", false]]),
    p("Fibonacci modular", "hard", "Imprime $F_n \\bmod 10^9+7$ para $n \\le 10^{18}$.",
      [["10", "55", true], ["1", "1", false], ["50", "12586269025", false]]),
  ];
}

function makeBotUser(name: string, codeRow: Code): User {
  return { id: uid(), username: name.toLowerCase(), role: "participant", access_code: codeRow.code, token: uid(), created_at: iso(), bot: true };
}

function seed(): State {
  const s: State = { version: STATE_VERSION, problems: seedProblems(), tournaments: [], rounds: [], users: [], participants: [], rps: [], submissions: [], codes: [] };
  const admin: User = { id: uid(), username: "admin", role: "admin", access_code: "ADMIN", token: "demo-admin-token", created_at: iso(), bot: false };
  s.users.push(admin);
  const t: Tournament = { id: uid(), name: "Run It · Primera edición", status: "pending", created_at: iso(now() - 3600000) };
  s.tournaments.push(t);
  const byDiff = (d: Difficulty) => s.problems.find((p) => p.difficulty === d)!;
  // Plan de 3 rondas: fácil, intermedia, difícil.
  ([["easy", 6, 10], ["medium", 3, 15], ["hard", 1, 20]] as const).forEach(([d, cap, min], i) => {
    const prob = byDiff(d);
    s.rounds.push({
      id: uid(), tournament_id: t.id, round_number: i + 1, problem_id: prob.id, problem_name: prob.name, capacity: cap,
      time_limit_seconds: min * 60, status: "pending", paused: false, paused_at: null, started_at: null, starts_at: null, ends_at: null,
      difficulty: d, created_at: iso(),
    });
  });
  // Códigos: algunos sin usar, algunos canjeados por bots y algunos vencidos o
  // invalidados (que la lista ya no muestra).
  const mk = (status: Code["status"], minutes: number | null): Code => ({
    id: uid(), code: codeString(), status, display_name: null, claimed_at: null, created_at: iso(now() - 600000),
    tournament_id: t.id, expires_at: minutes === null ? null : iso(now() + minutes * 60000),
  });
  for (let i = 0; i < 6; i += 1) s.codes.push(mk("unused", 240));
  s.codes.push(mk("expired", 240));
  s.codes.push(mk("unused", -5)); // vencido por tiempo
  const botCount = kind === "admin" ? 5 : 7;
  for (let i = 0; i < botCount; i += 1) {
    const c = mk("claimed", 240);
    const u = makeBotUser(BOT_NAMES[i]!, c);
    c.display_name = BOT_NAMES[i]!; c.claimed_at = iso(now() - (botCount - i) * 60000);
    s.codes.push(c); s.users.push(u);
    const part: Participant = { id: uid(), user_id: u.id, tournament_id: t.id, display_name: BOT_NAMES[i]!, character: (i * 7 + 5) % 48, status: "active", created_at: c.claimed_at };
    s.participants.push(part);
    s.rps.push(newRP(s.rounds[0]!.id, part.id, c.claimed_at));
  }
  if (kind === "participante") {
    // El participante de la demo: ya canjeó su código, falta elegir personaje.
    const c = mk("claimed", 240);
    c.display_name = "tú"; c.claimed_at = iso();
    s.codes.push(c);
    s.users.push({ id: uid(), username: "tú", role: "participant", access_code: c.code, token: "demo-participant-token", created_at: iso(), bot: false });
  }
  // Un torneo terminado para el historial.
  const old: Tournament = { id: uid(), name: "Torneo de práctica", status: "finished", created_at: iso(now() - 7 * 86400000) };
  s.tournaments.push(old);
  s.rounds.push({
    id: uid(), tournament_id: old.id, round_number: 1, problem_id: s.problems[1]!.id, problem_name: s.problems[1]!.name, capacity: 2,
    time_limit_seconds: 600, status: "closed", paused: false, paused_at: null, started_at: iso(now() - 7 * 86400000),
    starts_at: iso(now() - 7 * 86400000), ends_at: iso(now() - 7 * 86400000 + 600000), difficulty: "easy", created_at: old.created_at,
  });
  return s;
}

function newRP(round_id: string, participant_id: string, joined = iso()): RP {
  return { round_id, participant_id, best_pass_percentage: 0, failed_attempts_count: 0, penalty_seconds: 0, solved_at: null, final_rank: null, final_status: null, joined_at: joined };
}

// ---------------- Persistencia ----------------
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch { /* sin almacenamiento */ }
  }, 150);
}
function load(): State | null {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as State;
    return parsed.version === STATE_VERSION ? parsed : null;
  } catch { return null; }
}
export function resetDemo() {
  try { localStorage.removeItem(storageKey()); localStorage.removeItem("run-it-character:tú"); localStorage.removeItem("run-it-character-confirmed:tú"); } catch { /* nada */ }
  location.reload();
}

// ---------------- Consultas ----------------
const problem = (id: string | null) => state.problems.find((p) => p.id === id) || null;
const round = (id: string) => state.rounds.find((r) => r.id === id) || null;
const tournament = (id: string) => state.tournaments.find((t) => t.id === id) || null;
const participant = (id: string) => state.participants.find((p) => p.id === id) || null;
const rpsOf = (roundId: string) => state.rps.filter((rp) => rp.round_id === roundId);
const userByToken = (token: string | null) => state.users.find((u) => u.token === token) || null;

// Orden decidido: completó > puesto directo (llegada) > más tests > menos penalizaciones.
function rank(rows: RP[]) {
  return [...rows].sort((a, b) => {
    if (!!a.solved_at !== !!b.solved_at) return a.solved_at ? -1 : 1;
    if (a.solved_at && b.solved_at) return a.solved_at.localeCompare(b.solved_at);
    if (b.best_pass_percentage !== a.best_pass_percentage) return b.best_pass_percentage - a.best_pass_percentage;
    if (a.failed_attempts_count !== b.failed_attempts_count) return a.failed_attempts_count - b.failed_attempts_count;
    return a.joined_at.localeCompare(b.joined_at);
  });
}

function startBlockReason(r: Round): string | null {
  const t = tournament(r.tournament_id);
  if (t?.status === "finished") return "El torneo ya terminó.";
  const open = state.rounds.filter((o) => o.tournament_id === r.tournament_id && o.round_number < r.round_number && o.status !== "closed");
  if (open.length) return `Primero hay que cerrar ${open.map((o) => `la ronda ${o.round_number}`).join(", ")}.`;
  if (r.round_number > 1 && rpsOf(r.id).length === 0) return "Todavía no tiene participantes: se inscriben al avanzar desde la ronda anterior.";
  if (!r.problem_id) return "Falta elegir el problema.";
  return null;
}

function roundRow(r: Round) {
  const rows = rpsOf(r.id);
  return {
    id: r.id, round_number: r.round_number, status: r.status, capacity: r.capacity, time_limit_seconds: r.time_limit_seconds,
    problem_id: r.problem_id, problem_name: problem(r.problem_id)?.name ?? r.problem_name, participants_count: rows.length,
    advanced_count: rows.filter((x) => x.final_status === "advanced").length,
    start_blocked_reason: r.status === "pending" ? startBlockReason(r) : null, difficulty: r.difficulty,
    starts_at: r.starts_at, ends_at: r.ends_at, paused: r.paused,
  };
}

function leaderboard(roundId: string) {
  const r = round(roundId);
  const startMs = r?.starts_at ? Date.parse(r.starts_at) : 0;
  return rank(rpsOf(roundId)).map((rp) => {
    const p = participant(rp.participant_id)!;
    return {
      participant_id: rp.participant_id, display_name: p.display_name, character: p.character, final_rank: rp.final_rank,
      final_status: rp.final_status, best_pass_percentage: rp.best_pass_percentage, failed_attempts_count: rp.failed_attempts_count,
      solved_at: rp.solved_at, penalty_seconds: rp.penalty_seconds, joined_at: rp.joined_at,
      total_time_seconds: rp.solved_at ? Math.round((Date.parse(rp.solved_at) - startMs) / 1000) + rp.penalty_seconds : null,
    };
  });
}

function activeRound() {
  return [...state.rounds].filter((r) => r.status === "active").sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""))[0] || null;
}

function publicActive() {
  const r = activeRound();
  if (!r) return null;
  const p = problem(r.problem_id);
  return {
    ...r, problem_name: p?.name ?? r.problem_name, statement: p?.statement ?? "", difficulty: r.difficulty,
    samples: (p?.test_cases ?? []).filter((c) => c.is_sample).map((c) => ({ stdin: c.stdin, expected: c.expected })),
    participants: rpsOf(r.id).map((rp) => {
      const part = participant(rp.participant_id)!;
      return { participant_id: rp.participant_id, name: part.display_name, character: part.character, best_pass_percentage: rp.best_pass_percentage, solved_at: rp.solved_at, failed_attempts_count: rp.failed_attempts_count };
    }),
  };
}

function snapshot(roundId: string) {
  const r = round(roundId);
  if (!r) return null;
  const p = problem(r.problem_id);
  return { id: r.id, status: r.status, paused: r.paused, ends_at: r.ends_at, starts_at: r.starts_at, capacity: r.capacity, problem_name: p?.name ?? r.problem_name, statement: p?.statement ?? "" };
}

function queueStats() {
  const r = activeRound();
  const subs = r ? state.submissions.filter((s) => s.round_id === r.id) : [];
  const t = r ? tournament(r.tournament_id) : null;
  return {
    round: r ? {
      id: r.id, round_number: r.round_number, status: r.status, tournament_id: r.tournament_id, tournament_name: t?.name ?? "",
      total: subs.length, pending: subs.filter((s) => s.verdict === "queued").length,
      completed: subs.filter((s) => s.verdict !== "queued" && !["queue_error", "judge_error"].includes(s.verdict)).length,
      failed: subs.filter((s) => ["queue_error", "judge_error"].includes(s.verdict)).length,
    } : null,
    queue_available: true, waiting: 0, active: subs.filter((s) => s.verdict === "queued").length, completed: 0, failed: 0, delayed: 0,
  };
}

// ---------------- Ciclo de vida de una ronda ----------------
function startRound(r: Round) {
  const startsAt = now() + COUNTDOWN_MS;
  r.status = "active"; r.started_at = iso(); r.starts_at = iso(startsAt);
  r.ends_at = iso(startsAt + r.time_limit_seconds * 1000); r.paused = false; r.paused_at = null;
  const t = tournament(r.tournament_id); if (t && t.status === "pending") t.status = "active";
  save();
  const payload = { round_id: r.id, ends_at: r.ends_at, starts_at: r.starts_at, capacity: r.capacity };
  broadcast("round:started", payload);
  toRoom(r.id, "round:snapshot", snapshot(r.id));
  return roundRow(r);
}

function closeRound(r: Round) {
  if (r.status === "closed") return;
  r.status = "closed";
  const ranked = rank(rpsOf(r.id));
  ranked.forEach((rp, i) => {
    rp.final_rank = i + 1;
    rp.final_status = i < r.capacity ? "advanced" : "eliminated";
    if (rp.final_status === "eliminated") { const p = participant(rp.participant_id); if (p) p.status = "eliminated"; }
  });
  const t = tournament(r.tournament_id);
  const advanced = ranked.filter((rp) => rp.final_status === "advanced").length;
  if (t && advanced <= 1) t.status = "finished";
  save();
  broadcast("round:closed", { round_id: r.id, ranking: ranked.map((rp) => ({ participant_id: rp.participant_id, final_rank: rp.final_rank, final_status: rp.final_status })) });
  toRoom(r.id, "round:snapshot", snapshot(r.id));
}

function tick() {
  for (const r of state.rounds) {
    if (r.status === "active" && !r.paused && r.ends_at && Date.parse(r.ends_at) <= now()) closeRound(r);
  }
}

// ---------------- Juez simulado ----------------
// Solo "Suma de dos números" se evalúa de verdad (reconoce a+b, a-b, etc.). En
// el resto, el resultado sale de un hash del código: estable para el mismo código.
function judgeCase(code: string, language: string, prob: Problem | null, tc: { stdin: string; expected?: string }) {
  const isC = language !== "python";
  if (isC && !/\bmain\s*\(/.test(code)) return { status: "Compilation Error", stdout: "", compile_output: "undefined reference to `main'", stderr: "" };
  if (isC && /return\s+0\s*}/.test(code)) return { status: "Compilation Error", stdout: "", compile_output: "error: expected ';' before '}' token", stderr: "" };
  if (/while\s*\(?\s*(True|1|true)\s*\)?\s*:?\s*(\{)?\s*(pass|;|\})/.test(code)) return { status: "Time Limit Exceeded", stdout: "", compile_output: "", stderr: "" };
  if (prob?.name === "Suma de dos números") {
    const [a = 0, b = 0] = tc.stdin.trim().split(/\s+/).map(Number);
    if (/\(\s*b\s*-\s*b\s*\)/.test(code)) return { status: "Runtime Error (NZEC)", stdout: "", compile_output: "", stderr: "ZeroDivisionError: integer division or modulo by zero" };
    if (/\ba\s*-\s*b\b/.test(code)) return { status: "Accepted", stdout: String(a - b), compile_output: "", stderr: "" };
    if (/\ba\s*\+\s*b\b/.test(code)) return { status: "Accepted", stdout: String(a + b), compile_output: "", stderr: "" };
    return { status: "Accepted", stdout: "", compile_output: "", stderr: "" };
  }
  let h = 0; for (const ch of code + tc.stdin) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ok = h % 100 < 70;
  return { status: "Accepted", stdout: ok ? (tc.expected ?? "") : "0", compile_output: "", stderr: "" };
}

function runCases(code: string, language: string, prob: Problem | null, cases: Array<{ stdin: string; expected?: string }>) {
  return cases.map((tc) => {
    const out = judgeCase(code, language, prob, tc);
    const res: Record<string, unknown> = { status: out.status, stdin: tc.stdin, stdout: out.stdout, stderr: out.stderr, compile_output: out.compile_output, time: (0.01 + Math.random() * 0.05).toFixed(3), memory: 3200 + Math.floor(Math.random() * 800) };
    if (tc.expected !== undefined) {
      res["expected"] = tc.expected;
      res["passed"] = out.status === "Accepted" && out.stdout.trim() === tc.expected.trim();
      if (out.status === "Accepted" && !res["passed"]) res["status"] = "Wrong Answer";
    }
    return res;
  });
}

function judgeSubmission(sub: Submission, forced?: { passed: number }) {
  const r = round(sub.round_id);
  const prob = problem(r?.problem_id ?? null);
  const cases = prob?.test_cases ?? [];
  let results: Array<{ passed: boolean; status: string }>;
  if (forced) {
    results = cases.map((_, i) => ({ passed: i < forced.passed, status: i < forced.passed ? "accepted" : "Wrong Answer" }));
  } else {
    results = runCases(sub.code, sub.language, prob, cases).map((x) => ({ passed: Boolean(x["passed"]), status: x["passed"] ? "accepted" : String(x["status"]) }));
  }
  const passed = results.filter((x) => x.passed).length;
  const total = results.length;
  const solved = total > 0 && passed === total;
  sub.verdict = solved ? "accepted" : (results.find((x) => !x.passed)?.status || "no_test_cases");
  sub.test_cases_passed = passed; sub.test_cases_total = total; sub.case_results = results;
  const rp = state.rps.find((x) => x.round_id === sub.round_id && x.participant_id === sub.participant_id);
  if (rp && r && r.status === "active") {
    const pct = total ? Math.round((passed / total) * 10000) / 100 : 0;
    rp.best_pass_percentage = Math.max(rp.best_pass_percentage, pct);
    if (!rp.solved_at) {
      if (solved) rp.solved_at = iso();
      else { rp.failed_attempts_count += 1; rp.penalty_seconds += PENALTY_S; }
    }
  }
  save();
  const p = participant(sub.participant_id);
  toRoom(sub.round_id, "submission:judged", { id: sub.id, round_id: sub.round_id, participant_id: sub.participant_id, display_name: p?.display_name ?? "", language: sub.language, verdict: sub.verdict, test_cases_passed: passed, test_cases_total: total, submitted_at: sub.submitted_at });
  // Igual que index.js: los casos de este envío, no el porcentaje acumulado.
  broadcast("participant:progress", { participant_id: sub.participant_id, test_cases_passed: passed, test_cases_total: total, solved });
  // Cupo lleno de resueltos: la ronda cierra sola.
  if (r && r.status === "active" && rpsOf(r.id).filter((x) => x.solved_at).length >= r.capacity) closeRound(r);
}

function queueSubmission(r: Round, p: Participant, code: string, language: string, forced?: { passed: number }) {
  const sub: Submission = { id: uid(), round_id: r.id, participant_id: p.id, code, language, verdict: "queued", test_cases_passed: 0, test_cases_total: 0, case_results: [], submitted_at: iso() };
  state.submissions.push(sub); save();
  broadcast("submission:queued", { id: sub.id, round_id: r.id, participant_id: p.id, display_name: p.display_name, language, submitted_at: sub.submitted_at, verdict: "queued" });
  setTimeout(() => judgeSubmission(sub, forced), 1200 + Math.random() * 1600);
  return sub;
}

// ---------------- Participantes simulados ----------------
let botsEnabled = true;
export function setBotsEnabled(on: boolean) { botsEnabled = on; }
export function botsAreEnabled() { return botsEnabled; }

function botTick() {
  if (!botsEnabled) return;
  const r = activeRound();
  if (!r || r.paused || (r.starts_at && Date.parse(r.starts_at) > now())) return;
  const candidates = rpsOf(r.id).filter((rp) => !rp.solved_at && state.users.find((u) => u.id === participant(rp.participant_id)?.user_id)?.bot);
  // Ritmo humano: un envío cada tanto, para que se pueda competir con los bots.
  if (!candidates.length || Math.random() < 0.6) return;
  const rp = candidates[Math.floor(Math.random() * candidates.length)]!;
  const total = problem(r.problem_id)?.test_cases.length ?? 5;
  const prevPassed = Math.round((rp.best_pass_percentage / 100) * total);
  const passed = Math.min(total, Math.random() < 0.4 ? prevPassed : prevPassed + 1);
  const langs = ["python", "cpp", "c"];
  queueSubmission(r, participant(rp.participant_id)!, "// bot", langs[Math.floor(Math.random() * 3)]!, { passed });
}

// Un bot nuevo canjea un código y entra a la primera ronda del torneo (sala de espera).
export function addBotParticipant() {
  const t = state.tournaments.find((x) => x.status !== "finished");
  if (!t) return null;
  const first = state.rounds.filter((r) => r.tournament_id === t.id).sort((a, b) => a.round_number - b.round_number)[0];
  const free = state.codes.find((c) => c.status === "unused" && c.tournament_id === t.id && (!c.expires_at || Date.parse(c.expires_at) > now()));
  if (!first || first.status === "closed" || !free) return null;
  const used = new Set(state.participants.map((p) => p.display_name));
  const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${state.participants.length + 1}`;
  free.status = "claimed"; free.display_name = name; free.claimed_at = iso();
  const u = makeBotUser(name, free); state.users.push(u);
  const p: Participant = { id: uid(), user_id: u.id, tournament_id: t.id, display_name: name, character: (state.participants.length * 11 + 3) % 48, status: "active", created_at: iso() };
  state.participants.push(p); state.rps.push(newRP(first.id, p.id)); save();
  broadcast("participant:joined", { round_id: first.id, participant_id: p.id, name });
  return name;
}

// ---------------- Router ----------------
type Ctx = { method: string; path: string; query: URLSearchParams; body: any; user: User | null };
type Handler = (ctx: Ctx, params: Record<string, string>) => [number, unknown] | Promise<[number, unknown]>;
const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler }> = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, pattern, keys, handler });
}
const ok = (body: unknown): [number, unknown] => [200, body];
const err = (status: number, error: string): [number, unknown] => [status, { error }];
const needAdmin = (ctx: Ctx) => (ctx.user?.role === "admin" ? null : err(403, "Solo el administrador"));

route("GET", "/health", () => ok({ status: "ok", now: now() }));
route("POST", "/auth/logout", () => ok({ ok: true }));

route("GET", "/tournaments", (ctx) => {
  if (ctx.query.get("status") === "finished") {
    return ok(state.tournaments.filter((t) => t.status === "finished").map((t) => {
      const rounds = state.rounds.filter((r) => r.tournament_id === t.id);
      return { ...t, rounds_count: rounds.length, participants_count: state.participants.filter((p) => p.tournament_id === t.id).length, submissions_count: state.submissions.filter((s) => rounds.some((r) => r.id === s.round_id)).length, orphaned_users_count: 0 };
    }));
  }
  return ok(state.tournaments.filter((t) => t.status !== "finished").map((t) => {
    const rounds = state.rounds.filter((r) => r.tournament_id === t.id);
    return { ...t, rounds_count: rounds.length, played_rounds_count: rounds.filter((r) => r.status !== "pending").length };
  }));
});
route("POST", "/tournaments", (ctx) => {
  const name = String(ctx.body?.name ?? "").trim();
  if (!name) return err(400, "Falta el nombre del torneo");
  if (state.tournaments.some((t) => t.name === name && t.status !== "finished")) return err(409, "Ya hay un torneo abierto con ese nombre");
  const t: Tournament = { id: uid(), name, status: "pending", created_at: iso() };
  state.tournaments.unshift(t); save();
  return ok({ id: t.id, name: t.name });
});
route("GET", "/tournaments/:id/rounds", (_ctx, p) => ok(state.rounds.filter((r) => r.tournament_id === p["id"]).sort((a, b) => a.round_number - b.round_number).map(roundRow)));
// Propuesta: planificar todas las rondas de una vez. Solo toca rondas pendientes.
route("PUT", "/tournaments/:id/plan", (ctx, p) => {
  const t = tournament(p["id"]!); if (!t) return err(404, "Torneo no encontrado");
  const plan = Array.isArray(ctx.body?.rounds) ? ctx.body.rounds : [];
  if (!plan.length) return err(400, "El plan no tiene rondas");
  for (const item of plan) {
    const number = Number(item.round_number);
    const existing = state.rounds.find((r) => r.tournament_id === t.id && r.round_number === number);
    if (existing && existing.status !== "pending") continue;
    const prob = problem(item.problemId ?? null);
    const fields = { problem_id: prob?.id ?? null, problem_name: prob?.name ?? "", capacity: Math.max(1, Number(item.capacity) || 1), time_limit_seconds: Math.max(60, Number(item.timeLimitSeconds) || 600), difficulty: (item.difficulty ?? null) as Difficulty | null };
    if (existing) Object.assign(existing, fields);
    else state.rounds.push({ id: uid(), tournament_id: t.id, round_number: number, status: "pending", paused: false, paused_at: null, started_at: null, starts_at: null, ends_at: null, created_at: iso(), ...fields });
  }
  // Rondas pendientes que ya no están en el plan, se borran.
  const keep = new Set(plan.map((x: any) => Number(x.round_number)));
  state.rounds = state.rounds.filter((r) => r.tournament_id !== t.id || r.status !== "pending" || keep.has(r.round_number) || rpsOf(r.id).length > 0);
  save();
  return ok(state.rounds.filter((r) => r.tournament_id === t.id).sort((a, b) => a.round_number - b.round_number).map(roundRow));
});
route("POST", "/tournaments/:id/finish", (_ctx, p) => {
  const t = tournament(p["id"]!); if (!t) return err(404, "Torneo no encontrado");
  t.status = "finished";
  let expired = 0;
  state.codes.forEach((c) => { if (c.tournament_id === t.id && c.status === "unused") { c.status = "expired"; expired += 1; } });
  save();
  return ok({ tournament: { id: t.id, name: t.name, status: t.status }, expiredAccessCodes: expired });
});
const tournamentDeleteRow = (t: Tournament) => {
  const rounds = state.rounds.filter((r) => r.tournament_id === t.id);
  return { id: t.id, name: t.name, status: t.status, rounds: rounds.length, live_rounds: rounds.filter((r) => r.status === "active").length, participants: state.participants.filter((p) => p.tournament_id === t.id).length, access_codes: state.codes.filter((c) => c.tournament_id === t.id).length, submissions: state.submissions.filter((s) => rounds.some((r) => r.id === s.round_id)).length, orphaned_users: 0 };
};
const deletePreview = (ids: string[]) => {
  const rows = ids.map((id) => tournament(id)).filter(Boolean) as Tournament[];
  const blocked = rows.filter((t) => t.status !== "finished" && state.rounds.some((r) => r.tournament_id === t.id && r.status !== "pending"));
  const deletable = rows.filter((t) => !blocked.includes(t));
  const d = deletable.map(tournamentDeleteRow);
  return { deletable: d, blocked: blocked.map((t) => ({ ...tournamentDeleteRow(t), reason: `“${t.name}” tiene rondas jugadas.` })), missing: ids.filter((id) => !tournament(id)), totals: { tournaments: d.length, rounds: d.reduce((a, x) => a + x.rounds, 0), participants: d.reduce((a, x) => a + x.participants, 0), access_codes: d.reduce((a, x) => a + x.access_codes, 0), submissions: d.reduce((a, x) => a + x.submissions, 0), orphaned_users: 0 } };
};
const removeTournaments = (ids: string[]) => {
  const roundIds = new Set(state.rounds.filter((r) => ids.includes(r.tournament_id)).map((r) => r.id));
  state.tournaments = state.tournaments.filter((t) => !ids.includes(t.id));
  state.rounds = state.rounds.filter((r) => !roundIds.has(r.id));
  state.rps = state.rps.filter((rp) => !roundIds.has(rp.round_id));
  state.submissions = state.submissions.filter((s) => !roundIds.has(s.round_id));
  state.participants = state.participants.filter((p) => !ids.includes(p.tournament_id));
  state.codes = state.codes.filter((c) => !c.tournament_id || !ids.includes(c.tournament_id));
  save();
};
route("POST", "/tournaments/delete-preview", (ctx) => ok(deletePreview(ctx.body?.ids ?? [])));
route("DELETE", "/tournaments", (ctx) => { const prev = deletePreview(ctx.body?.ids ?? []); removeTournaments(prev.deletable.map((x) => x.id)); return ok({ deleted: prev.deletable, skipped: prev.blocked, missing: prev.missing, totals: prev.totals }); });
route("DELETE", "/tournaments/:id", (_ctx, p) => { const t = tournament(p["id"]!); if (!t) return err(404, "Torneo no encontrado"); const row = tournamentDeleteRow(t); removeTournaments([t.id]); return ok({ deleted: true, rounds: row.rounds, participants: row.participants, submissions: row.submissions }); });
route("GET", "/users/orphans", () => ok([]));
route("DELETE", "/users/orphans", () => ok({ deleted: 0, users: [] }));

// Códigos. Propuesta: los vencidos o invalidados ya no se listan.
const liveCode = (c: Code) => c.status !== "expired" && !(c.status === "unused" && c.expires_at && Date.parse(c.expires_at) <= now());
route("GET", "/access-codes", (ctx) => {
  const tid = ctx.query.get("tournamentId");
  return ok(state.codes.filter((c) => (!tid || c.tournament_id === tid) && liveCode(c)).sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((c) => ({ ...c, tournament_name: c.tournament_id ? tournament(c.tournament_id)?.name ?? null : null })));
});
route("POST", "/access-codes/generate", (ctx) => {
  const count = Math.min(500, Math.max(1, Number(ctx.body?.count) || 1));
  const ttl = Number(ctx.body?.ttlMinutes) || null;
  const created: Code[] = Array.from({ length: count }, () => ({ id: uid(), code: codeString(), status: "unused" as const, display_name: null, claimed_at: null, created_at: iso(), tournament_id: ctx.body?.tournamentId ?? null, expires_at: ttl ? iso(now() + ttl * 60000) : null }));
  state.codes.push(...created); save();
  return ok({ codes: created.map((c) => ({ ...c, tournament_name: c.tournament_id ? tournament(c.tournament_id)?.name ?? null : null })) });
});
route("POST", "/access-codes/revoke", (ctx) => {
  const revoked: string[] = [];
  state.codes.forEach((c) => {
    const match = ctx.body?.codes ? ctx.body.codes.includes(c.code) : c.tournament_id === ctx.body?.tournamentId;
    if (match && c.status === "unused") { c.status = "expired"; revoked.push(c.code); }
  });
  save();
  return ok({ revoked: revoked.length, codes: revoked });
});

// Problemas
route("GET", "/problems", () => ok(state.problems.map((p) => ({ id: p.id, name: p.name, difficulty: p.difficulty }))));
route("POST", "/problems", (ctx) => {
  const b = ctx.body || {};
  if (!b.name || !b.statement || !Array.isArray(b.testCases) || !b.testCases.length) return err(400, "Faltan datos del problema");
  const p: Problem = { id: uid(), name: b.name, statement: b.statement, difficulty: b.difficulty || "easy", test_cases: b.testCases, created_at: iso() };
  state.problems.unshift(p); save();
  return ok({ id: p.id, name: p.name, difficulty: p.difficulty });
});
const problemRounds = (id: string) => state.rounds.filter((r) => r.problem_id === id).map((r) => ({ id: r.id, round_number: r.round_number, status: r.status, tournament_name: tournament(r.tournament_id)?.name ?? "", tournament_status: tournament(r.tournament_id)?.status ?? "" }));
route("GET", "/problems/:id/full", (_ctx, p) => { const pr = problem(p["id"]!); return pr ? ok({ ...pr, rounds: problemRounds(pr.id) }) : err(404, "Problema no encontrado"); });
route("PUT", "/problems/:id", (ctx, p) => { const pr = problem(p["id"]!); if (!pr) return err(404, "Problema no encontrado"); Object.assign(pr, { name: ctx.body.name, statement: ctx.body.statement, difficulty: ctx.body.difficulty, test_cases: ctx.body.testCases }); save(); return ok({ id: pr.id, name: pr.name, difficulty: pr.difficulty }); });
const problemBlocked = (id: string) => problemRounds(id).filter((r) => r.tournament_status !== "finished" && r.status !== "pending");
route("DELETE", "/problems/:id", (_ctx, p) => {
  const id = p["id"]!; if (problemBlocked(id).length) return err(409, "Lo usa una ronda jugada de un torneo abierto");
  state.problems = state.problems.filter((x) => x.id !== id); state.rounds.forEach((r) => { if (r.problem_id === id) r.problem_id = null; }); save();
  return ok({ deleted: true, roundsKept: 0 });
});
const problemPreview = (ids: string[]) => ({
  deletable: ids.filter((id) => problem(id) && !problemBlocked(id).length).map((id) => ({ id, name: problem(id)!.name, rounds_kept: 0 })),
  blocked: ids.filter((id) => problem(id) && problemBlocked(id).length).map((id) => ({ id, name: problem(id)!.name, reason: `“${problem(id)!.name}” lo usa una ronda jugada.`, blocking: problemBlocked(id) })),
  missing: ids.filter((id) => !problem(id)),
});
route("POST", "/problems/delete-preview", (ctx) => ok(problemPreview(ctx.body?.ids ?? [])));
route("DELETE", "/problems", (ctx) => { const prev = problemPreview(ctx.body?.ids ?? []); const del = new Set(prev.deletable.map((x) => x.id)); state.problems = state.problems.filter((x) => !del.has(x.id)); save(); return ok({ deleted: prev.deletable, skipped: prev.blocked, missing: prev.missing }); });

// Rondas
route("POST", "/rounds", (ctx) => {
  const b = ctx.body || {};
  const t = tournament(b.tournamentId); if (!t) return err(404, "Torneo no encontrado");
  if (state.rounds.some((r) => r.tournament_id === t.id)) return err(409, "Este torneo ya tiene rondas: las siguientes salen de la anterior.");
  const prob = problem(b.problemId);
  const r: Round = { id: uid(), tournament_id: t.id, round_number: Number(b.roundNumber) || 1, problem_id: prob?.id ?? null, problem_name: prob?.name ?? "", capacity: Number(b.capacity) || 1, time_limit_seconds: Number(b.timeLimitSeconds) || 600, status: "pending", paused: false, paused_at: null, started_at: null, starts_at: null, ends_at: null, difficulty: prob?.difficulty ?? null, created_at: iso() };
  state.rounds.push(r); save();
  return ok({ id: r.id, status: r.status });
});
route("PUT", "/rounds/:id", (ctx, p) => { const r = round(p["id"]!); if (!r) return err(404, "Ronda no encontrada"); if (r.status !== "pending") return err(409, "La ronda ya empezó"); const prob = problem(ctx.body.problemId); Object.assign(r, { problem_id: prob?.id ?? r.problem_id, problem_name: prob?.name ?? r.problem_name, capacity: Number(ctx.body.capacity), time_limit_seconds: Number(ctx.body.timeLimitSeconds), difficulty: ctx.body.difficulty ?? r.difficulty }); save(); return ok({ id: r.id, problem_id: r.problem_id, capacity: r.capacity, time_limit_seconds: r.time_limit_seconds }); });
route("DELETE", "/rounds/:id", (_ctx, p) => { const r = round(p["id"]!); if (!r) return err(404, "Ronda no encontrada"); if (r.status !== "pending") return err(409, "Solo se borran rondas pendientes"); state.rounds = state.rounds.filter((x) => x.id !== r.id); state.rps = state.rps.filter((x) => x.round_id !== r.id); save(); return ok({ deleted: true }); });
route("POST", "/rounds/:id/start", (ctx, p) => { const deny = needAdmin(ctx); if (deny) return deny; const r = round(p["id"]!); if (!r) return err(404, "Ronda no encontrada"); if (r.status !== "pending") return err(409, "La ronda ya empezó"); const reason = startBlockReason(r); if (reason) return err(409, reason); return ok(startRound(r)); });
route("POST", "/rounds/:id/pause", (_ctx, p) => {
  const r = round(p["id"]!); if (!r || r.status !== "active") return err(409, "La ronda no está activa");
  if (!r.paused) { r.paused = true; r.paused_at = now(); }
  else { const delta = now() - (r.paused_at ?? now()); r.paused = false; r.paused_at = null; if (r.ends_at) r.ends_at = iso(Date.parse(r.ends_at) + delta); }
  save(); toRoom(r.id, "round:paused", { id: r.id, paused: r.paused }); toRoom(r.id, "round:snapshot", snapshot(r.id));
  return ok({ paused: r.paused });
});
route("POST", "/rounds/:id/close", (_ctx, p) => { const r = round(p["id"]!); if (!r) return err(404, "Ronda no encontrada"); closeRound(r); return ok(roundRow(r)); });
route("GET", "/rounds/:id/state", (_ctx, p) => { const r = round(p["id"]!); return ok(r ? { ...r, problem_name: problem(r.problem_id)?.name ?? r.problem_name } : null); });
route("GET", "/rounds/:id/leaderboard", (_ctx, p) => ok(leaderboard(p["id"]!)));
route("GET", "/rounds/:id/submissions", (_ctx, p) => ok(state.submissions.filter((s) => s.round_id === p["id"]).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)).slice(0, 200).map((s) => ({ ...s, display_name: participant(s.participant_id)?.display_name ?? "" }))));
route("GET", "/rounds/:id/submissions/mine", (ctx, p) => {
  const mine = state.participants.find((x) => x.user_id === ctx.user?.id);
  return ok(state.submissions.filter((s) => s.round_id === p["id"] && s.participant_id === mine?.id).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)));
});
const nextPreview = (r: Round) => {
  const t = tournament(r.tournament_id)!;
  const advancing = rank(rpsOf(r.id)).filter((rp) => rp.final_status === "advanced").map((rp) => ({ participant_id: rp.participant_id, display_name: participant(rp.participant_id)!.display_name, final_rank: rp.final_rank!, best_pass_percentage: String(rp.best_pass_percentage) }));
  const next = state.rounds.find((x) => x.tournament_id === t.id && x.round_number === r.round_number + 1) || null;
  const planned = next && next.status === "pending" && rpsOf(next.id).length === 0;
  let reason: string | undefined;
  if (r.status !== "closed") reason = "La ronda todavía no cerró.";
  else if (t.status === "finished") reason = advancing.length === 1 ? `El torneo terminó: ganó ${advancing[0]!.display_name}.` : "El torneo ya terminó.";
  else if (advancing.length <= 1) reason = "Queda un solo clasificado: el torneo terminó.";
  else if (next && !planned) reason = `La ronda ${next.round_number} ya existe.`;
  return { available: !reason, reason, nextRoundNumber: r.round_number + 1, tournamentId: t.id, tournamentStatus: t.status, roundStatus: r.status, advancingCount: advancing.length, advancing, existing: next ? { id: next.id, round_number: next.round_number, status: next.status, planned: Boolean(planned), problem_id: next.problem_id, capacity: next.capacity, time_limit_seconds: next.time_limit_seconds, difficulty: next.difficulty } : null };
};
route("GET", "/rounds/:id/next", (_ctx, p) => { const r = round(p["id"]!); return r ? ok(nextPreview(r)) : err(404, "Ronda no encontrada"); });
route("POST", "/rounds/:id/next", (ctx, p) => {
  const r = round(p["id"]!); if (!r) return err(404, "Ronda no encontrada");
  const prev = nextPreview(r); if (!prev.available) return err(409, prev.reason ?? "No se puede avanzar");
  const prob = problem(ctx.body?.problemId) ?? problem(prev.existing?.problem_id ?? null);
  let next = prev.existing ? round(prev.existing.id) : null;
  const cap = Math.min(prev.advancingCount, Number(ctx.body?.capacity) || prev.existing?.capacity || prev.advancingCount);
  if (!next) {
    next = { id: uid(), tournament_id: r.tournament_id, round_number: r.round_number + 1, problem_id: prob?.id ?? null, problem_name: prob?.name ?? "", capacity: cap, time_limit_seconds: Number(ctx.body?.timeLimitSeconds) || 600, status: "pending", paused: false, paused_at: null, started_at: null, starts_at: null, ends_at: null, difficulty: prob?.difficulty ?? null, created_at: iso() };
    state.rounds.push(next);
  } else {
    Object.assign(next, { problem_id: prob?.id ?? next.problem_id, problem_name: prob?.name ?? next.problem_name, capacity: cap, time_limit_seconds: Number(ctx.body?.timeLimitSeconds) || next.time_limit_seconds });
  }
  prev.advancing.forEach((a) => state.rps.push(newRP(next!.id, a.participant_id)));
  save();
  return ok({ round: { id: next.id, round_number: next.round_number, capacity: next.capacity, status: next.status }, participants: prev.advancing.length, advancing: prev.advancing });
});
route("GET", "/public/rounds/active", () => ok(publicActive()));
// Propuesta: la próxima ronda pendiente del torneo abierto, para la sala de espera.
route("GET", "/public/rounds/upcoming", (ctx) => {
  if (activeRound()) return ok(null);
  const t = state.tournaments.find((x) => x.status !== "finished");
  if (!t) return ok(null);
  const mine = state.participants.find((x) => x.user_id === ctx.user?.id && x.tournament_id === t.id);
  const pending = state.rounds.filter((r) => r.tournament_id === t.id && r.status === "pending").sort((a, b) => a.round_number - b.round_number)
    .find((r) => r.round_number === 1 || (mine && rpsOf(r.id).some((x) => x.participant_id === mine.id)));
  return ok(pending ? { id: pending.id, round_number: pending.round_number, tournament_name: t.name, capacity: pending.capacity } : null);
});
route("GET", "/queue/stats", () => ok(queueStats()));
// Sala de espera: un participante puede unirse a la primera ronda pendiente.
function joinTarget(roundId: string) {
  const r = round(roundId);
  if (r) return r;
  return null;
}
route("POST", "/rounds/:id/participants/join", (ctx, p) => {
  if (!ctx.user) return err(401, "Sesión inválida");
  const r = joinTarget(p["id"]!); if (!r) return err(404, "Ronda no encontrada");
  let part = state.participants.find((x) => x.user_id === ctx.user!.id && x.tournament_id === r.tournament_id);
  if (!part) {
    if (r.round_number > 1) return err(403, "Esta ronda es solo para los clasificados");
    part = { id: uid(), user_id: ctx.user.id, tournament_id: r.tournament_id, display_name: ctx.body?.displayName || ctx.user.username, character: Number(ctx.body?.character) || 0, status: "active", created_at: iso() };
    state.participants.push(part);
  }
  if (!state.rps.some((x) => x.round_id === r.id && x.participant_id === part!.id)) {
    if (r.round_number > 1) return err(403, "Esta ronda es solo para los clasificados");
    state.rps.push(newRP(r.id, part.id));
    broadcast("participant:joined", { round_id: r.id, participant_id: part.id, name: part.display_name });
  }
  save();
  return ok({ id: part.id, display_name: part.display_name, character: part.character });
});
route("POST", "/rounds/:id/submissions", (ctx, p) => {
  const r = round(p["id"]!);
  if (!r || r.status !== "active") return err(409, "La ronda no está activa");
  if (r.paused) return err(409, "La ronda está pausada");
  if (r.starts_at && Date.parse(r.starts_at) > now()) return err(409, "La ronda todavía no empezó");
  const part = participant(ctx.body?.participantId);
  if (!part || part.user_id !== ctx.user?.id) return err(403, "Participante no válido para esta ronda");
  const sub = queueSubmission(r, part, String(ctx.body.code), String(ctx.body.language));
  return [202, { id: sub.id, round_id: r.id, participant_id: part.id, display_name: part.display_name, language: sub.language, submitted_at: sub.submitted_at, verdict: sub.verdict }];
});
const lastRun = new Map<string, number>();
route("POST", "/rounds/:id/run", async (ctx, p) => {
  const r = round(p["id"]!);
  if (!r || r.status !== "active") return err(409, "La ronda no está activa");
  if (r.paused) return err(409, "La ronda está pausada");
  if (r.starts_at && Date.parse(r.starts_at) > now()) return err(409, "La ronda todavía no empezó");
  const key = ctx.user?.id ?? "";
  if (now() - (lastRun.get(key) ?? 0) < 3000) return err(429, "Espera unos segundos antes de volver a probar");
  lastRun.set(key, now());
  const prob = problem(r.problem_id);
  const custom = typeof ctx.body?.stdin === "string";
  const cases = custom ? [{ stdin: ctx.body.stdin }] : (prob?.test_cases ?? []).filter((c) => c.is_sample).map((c) => ({ stdin: c.stdin, expected: c.expected }));
  if (!cases.length) return err(409, "Este problema no tiene casos de ejemplo: prueba con una entrada personalizada");
  await new Promise((res) => setTimeout(res, 700 + Math.random() * 700));
  const results = runCases(String(ctx.body.code), String(ctx.body.language), prob, cases);
  const graded = results.filter((x) => typeof x["passed"] === "boolean");
  return ok({ mode: custom ? "custom" : "samples", results, passed: graded.filter((x) => x["passed"]).length, total: graded.length });
});

// ---------------- Instalación ----------------
const realFetch = window.fetch.bind(window);
export function installFakeBackend(demo: DemoKind) {
  kind = demo;
  state = load() ?? seed();
  save();
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const isApi = url.origin === location.origin && routes.some((r) => r.pattern.test(url.pathname));
    if (!isApi) return realFetch(input, init);
    const method = (init?.method || "GET").toUpperCase();
    const auth = new Headers(init?.headers).get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
    const ctx: Ctx = { method, path: url.pathname, query: url.searchParams, body, user: userByToken(auth) };
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.pathname.match(r.pattern);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]!); });
      await new Promise((res) => setTimeout(res, 60 + Math.random() * 120));
      const [status, payload] = await r.handler(ctx, params);
      return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", date: new Date().toUTCString() } });
    }
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
  };
  // Pedidos del cliente por socket: unirse a la sala y pedir el snapshot.
  onClientEmit((socket, event, payload) => {
    if (event === "round:snapshot" && typeof payload === "string") socket.deliver("round:snapshot", snapshot(payload));
  });
  setInterval(tick, 1000);
  setInterval(botTick, 4000);
}

// Acceso de la demo (paneles de simulación).
export const demo = {
  state: () => state,
  activeRound: () => activeRound(),
  rounds: () => state.rounds,
  tournaments: () => state.tournaments,
  start: (roundId: string) => { const r = round(roundId); if (r && r.status === "pending" && !startBlockReason(r)) startRound(r); },
  close: (roundId: string) => { const r = round(roundId); if (r) closeRound(r); },
  pause: (roundId: string) => { const r = round(roundId); if (r && r.status === "active") { if (!r.paused) { r.paused = true; r.paused_at = now(); } else { const d = now() - (r.paused_at ?? now()); r.paused = false; r.paused_at = null; if (r.ends_at) r.ends_at = iso(Date.parse(r.ends_at) + d); } save(); toRoom(r.id, "round:paused", { id: r.id, paused: r.paused }); toRoom(r.id, "round:snapshot", snapshot(r.id)); } },
  nextRound: (roundId: string) => { const r = round(roundId); if (!r) return "Ronda no encontrada"; const prev = nextPreview(r); if (!prev.available) return prev.reason ?? "No se puede avanzar"; let next = prev.existing ? round(prev.existing.id) : null; if (!next) { const prob = state.problems.find((x) => x.difficulty === "medium") ?? state.problems[0]!; next = { id: uid(), tournament_id: r.tournament_id, round_number: r.round_number + 1, problem_id: prob.id, problem_name: prob.name, capacity: Math.max(1, Math.floor(prev.advancingCount / 2)), time_limit_seconds: 900, status: "pending", paused: false, paused_at: null, started_at: null, starts_at: null, ends_at: null, difficulty: prob.difficulty, created_at: iso() }; state.rounds.push(next); } prev.advancing.forEach((a) => state.rps.push(newRP(next!.id, a.participant_id))); save(); return null; },
  startBlock: (roundId: string) => { const r = round(roundId); return r ? startBlockReason(r) : "Ronda no encontrada"; },
};
