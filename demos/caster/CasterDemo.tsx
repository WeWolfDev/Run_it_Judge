import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { CodeEditor } from "@/components/CodeEditor";
import { TallyBars, VoteQr } from "@/components/hits/Grada";
import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import { ProblemStatement } from "@/components/ProblemStatement";
import {
  ProjectedTrack,
  type Entry,
  type FeedEvent,
  type TrackRound,
} from "@/components/ProjectedTrack";
import { characterAt, CHARACTERS } from "@/lib/characters";
import { formatLeft, hitInfo, type HitId, type HitPoll } from "@/lib/hits";
import { applyPalette, PALETTES, storedPalette } from "@/lib/palette";
import { formatClock, verdictLabel } from "@/lib/runit";
import { cn } from "@/lib/utils";

import { caseResults, codeFor, type SubLanguage } from "./submissionCode";
import { useBoard, Whiteboard } from "./Whiteboard";

// Vista del caster: quien narra el torneo en vivo. Ve el enunciado de la ronda
// con los ejemplos, la pista como la ve el público y la votación de la grada
// con su QR. No programa ni vota.
// Demo: la ronda, los envíos y las votaciones se simulan en el navegador, con
// las mismas reglas de run-it-backend/hits.js.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
const ROUND_MS = 15 * 60_000;
const TESTS = 30;

// Reglas del voto (run-it-backend/hits.js).
const ANNOUNCE_MS = 15_000;
const POLL_MS = 40_000;
const QUIET_START_MS = 60_000;
const QUIET_END_MS = 120_000;
const MAX_POLLS = 2;
const RESULT_MS = 8000;
const PAIRS: { weight: number; good: HitId; bad: HitId }[] = [
  { weight: 2, good: "extra", bad: "niebla" },
  { weight: 2, good: "amnistia", bad: "penal-doble" },
  { weight: 3, good: "cupo-mas", bad: "cupo-menos" },
  { weight: 1, good: "pista", bad: "reloj-oculto" },
  { weight: 1, good: "aliento", bad: "apagon" },
];
/** 0: se aplica de una vez; null: hasta que cierra la ronda. */
const DURATION: Record<HitId, number | null> = {
  extra: 0,
  amnistia: 90_000,
  "cupo-mas": 0,
  pista: null,
  aliento: 10_000,
  "penal-doble": 120_000,
  "reloj-oculto": 60_000,
  apagon: 45_000,
  niebla: 75_000,
  "cupo-menos": 0,
};

const PROBLEM = {
  name: "A. El marcador de Leo",
  hint: "Separa los números por el +, ordénalos y vuelve a unirlos con +.",
  statement: `Límite de tiempo por prueba: **2 segundos**  \nLímite de memoria por prueba: **256 megabytes**

El marcador electrónico del torneo muestra, entre ronda y ronda, una suma de puntos de bonificación. Cada sumando vale $1$, $2$ o $3$.

El problema es que el marcador es viejo: solo puede mostrar una suma si sus sumandos están ordenados de menor a mayor (puede haber repetidos). Por ejemplo, puede mostrar $1+1+2$ o $3+3$, pero no $1+3+2+1$.

Leo, el organizador, te pasa la suma tal como la anotó. Reordena los sumandos para que el marcador pueda mostrarla. El resultado de la suma no cambia.

**Entrada**

Una línea con una cadena no vacía $s$: la suma anotada. Solo tiene dígitos \`1\`, \`2\`, \`3\` y signos \`+\`, sin espacios, y es una suma bien escrita. Su longitud es como mucho $100$.

**Salida**

La misma suma con los sumandos en orden no decreciente.`,
  samples: [
    { input: "3+2+1", output: "1+2+3" },
    { input: "1+1+3+1+3", output: "1+1+1+3+3" },
  ],
};

const NAMES = [
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

// ── Simulación ──────────────────────────────────────────────────────────────

type Runner = {
  id: string;
  name: string;
  character: number;
  best: number;
  fails: number;
  solvedAt: number | null;
  penalty: number;
};
type Poll = {
  id: number;
  pair: number;
  good: HitId;
  bad: HitId;
  announcedAt: number;
  opensAt: number;
  closesAt: number;
  tally: { good: number; bad: number };
  /** Hacia dónde se inclina la grada simulada (0..1, más alto = bueno). */
  lean: number;
  status: "open" | "closed";
  winner: HitId | null;
};
type Active = {
  id: number;
  hit: HitId;
  startsAt: number;
  endsAt: number | null;
};
/** Un envío, con el veredicto de Judge0 (lo que el caster quiere ver). */
type Sub = {
  id: number;
  at: number;
  name: string;
  character: number;
  verdict: string;
  passed: number;
  penalty: number;
  language: SubLanguage;
  code: string;
  /** Resultado de cada caso: "ok" o su veredicto (submissions.case_results). */
  cases: string[];
};
type Sim = {
  round: TrackRound;
  runners: Runner[];
  events: FeedEvent[];
  subs: Sub[];
  polls: Poll[];
  active: Active[];
  nextSubmitAt: number;
  nextTallyAt: number;
  autoPollAt: number | null;
  speed: number;
  seq: number;
};

const pick = <T,>(list: T[]) =>
  list[Math.floor(Math.random() * list.length)] as T;

function newSim(now: number): Sim {
  // La ronda ya va por el minuto 1:10: la grada puede votar enseguida.
  const startsAt = now - 70_000;
  const runners = NAMES.map((name, index) => ({
    id: `p${index}`,
    name,
    character: (index * 7 + 3) % CHARACTERS.length,
    best: pick([0, 0, 10, 20, 30]),
    fails: Math.floor(Math.random() * 2),
    solvedAt: null,
    penalty: 0,
  }));
  runners.forEach((runner) => (runner.penalty = runner.fails * 30));
  return {
    round: {
      number: 1,
      problem: PROBLEM.name,
      capacity: 2,
      startsAt,
      endsAt: startsAt + ROUND_MS,
      closed: false,
    },
    runners,
    events: [],
    subs: seedSubs(runners, startsAt, now),
    polls: [],
    active: [],
    nextSubmitAt: now + 1500,
    nextTallyAt: now,
    autoPollAt: now + 20_000,
    speed: 1,
    seq: 0,
  };
}

const isOn = (sim: Sim, hit: HitId, now: number) =>
  sim.active.some(
    (a) =>
      a.hit === hit &&
      a.startsAt <= now &&
      (a.endsAt === null || a.endsAt > now),
  );

function standings(sim: Sim) {
  return [...sim.runners].sort((a, b) => {
    if (a.solvedAt !== null && b.solvedAt !== null)
      return a.solvedAt + a.penalty * 1000 - (b.solvedAt + b.penalty * 1000);
    if (a.solvedAt !== null) return -1;
    if (b.solvedAt !== null) return 1;
    return b.best - a.best || a.fails - b.fails || a.name.localeCompare(b.name);
  });
}

function board(sim: Sim): Entry[] {
  const solved = sim.runners.filter((r) => r.solvedAt !== null).length;
  return standings(sim).map((runner, index) => ({
    participant_id: runner.id,
    display_name: runner.name,
    character: runner.character,
    final_rank: sim.round.closed ? index + 1 : null,
    final_status: sim.round.closed
      ? runner.solvedAt !== null && index < Math.min(sim.round.capacity, solved)
        ? "advanced"
        : "eliminated"
      : null,
    best_pass_percentage: runner.best,
    failed_attempts_count: runner.fails,
    solved_at:
      runner.solvedAt === null ? null : new Date(runner.solvedAt).toISOString(),
    penalty_seconds: runner.penalty,
  }));
}

// Veredictos de los envíos fallidos, con su peso en la simulación.
const FAILS: [string, number][] = [
  ["Wrong Answer", 45],
  ["Time Limit Exceeded", 20],
  ["Compilation Error", 12],
  ["Runtime Error (SIGSEGV)", 9],
  ["Runtime Error (NZEC)", 8],
  ["Runtime Error (SIGFPE)", 6],
];

function failVerdict() {
  let roll = Math.random() * FAILS.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [verdict, weight] of FAILS) {
    roll -= weight;
    if (roll < 0) return verdict;
  }
  return "Wrong Answer";
}

/** Código y resultado por caso de un envío simulado (submissionCode.ts). */
function withCode(id: number, verdict: string, passed: number) {
  return {
    id,
    verdict,
    passed,
    ...codeFor(verdict, id, passed),
    cases: caseResults(id, verdict, passed, TESTS),
  };
}

/** Los envíos que ya hubo antes de que el caster abriera la vista. */
function seedSubs(runners: Runner[], startsAt: number, now: number) {
  const subs: Sub[] = [];
  runners.forEach((runner, index) => {
    for (let i = 0; i < runner.fails; i++) {
      const verdict = failVerdict();
      subs.push({
        at: startsAt + 10_000 + Math.random() * (now - startsAt - 15_000),
        name: runner.name,
        character: runner.character,
        ...withCode(
          -(index * 10 + i + 1),
          verdict,
          verdict === "Compilation Error"
            ? 0
            : Math.round((runner.best / 100) * TESTS),
        ),
        penalty: 30,
      });
    }
  });
  return subs.sort((a, b) => b.at - a.at);
}

/** Un envío de un participante al azar que todavía no resolvió. */
function submit(sim: Sim, now: number) {
  const pending = sim.runners.filter((r) => r.solvedAt === null);
  if (!pending.length || sim.round.closed) return;
  const runner = pick(pending);
  const base = {
    id: ++sim.seq,
    at: now,
    name: runner.name,
    character: runner.character,
  };
  const record = (verdict: string, passed: number, penalty: number) => {
    sim.subs = [
      { ...base, ...withCode(base.id, verdict, passed), penalty },
      ...sim.subs,
    ].slice(0, 200);
  };
  const roll = Math.random();
  if (runner.best >= 70 && roll < 0.3) {
    runner.best = 100;
    runner.solvedAt = now;
    record("accepted", TESTS, 0);
    const arrival = sim.runners.filter((r) => r.solvedAt !== null).length;
    sim.events = [
      { ...base, kind: "solved" as const, arrival },
      ...sim.events,
    ].slice(0, 40);
    return;
  }
  // Todo envío que no es Aceptado suma un intento fallido, aunque pase más tests.
  const penalty = isOn(sim, "amnistia", now)
    ? 0
    : isOn(sim, "penal-doble", now)
      ? 60
      : 30;
  runner.fails += 1;
  runner.penalty += penalty;
  const verdict = failVerdict();
  const improves =
    verdict !== "Compilation Error" && roll < 0.75 && runner.best < 90;
  if (improves)
    runner.best = Math.min(90, runner.best + pick([10, 10, 20, 20, 30]));
  const passed =
    verdict === "Compilation Error"
      ? 0
      : Math.round(
          ((improves ? runner.best : Math.max(0, runner.best - 20)) / 100) *
            TESTS,
        );
  record(verdict, passed, penalty);
  sim.events = [
    {
      ...base,
      kind: improves ? ("progress" as const) : ("fail" as const),
      passed,
      total: TESTS,
    },
    ...sim.events,
  ].slice(0, 40);
}

/** Por qué no se puede anunciar ese par ahora (pollBlockReason del backend). */
function blockReason(sim: Sim, pairIndex: number, now: number) {
  const pair = PAIRS[pairIndex];
  if (!pair) return "El par no existe";
  if (sim.round.closed) return "La ronda no está en curso";
  if (sim.polls.some((p) => p.status === "open"))
    return "Ya hay una votación en curso";
  if (sim.polls.length >= MAX_POLLS)
    return `Ya hubo ${MAX_POLLS} votaciones en esta ronda`;
  if (now - sim.round.startsAt < QUIET_START_MS)
    return "Sin votaciones en el primer minuto";
  if (sim.round.endsAt - now < QUIET_END_MS + ANNOUNCE_MS + POLL_MS)
    return "Sin votaciones en los últimos 2 minutos";
  if (sim.polls.some((p) => p.good === pair.good))
    return "Ese par ya se usó en esta ronda";
  if (pair.weight === 3) {
    const solved = sim.runners.filter((r) => r.solvedAt !== null).length;
    if (sim.round.capacity <= 2)
      return "Con cupo 2 o menos no se tocan los cupos";
    if (sim.round.capacity + 1 >= sim.runners.length)
      return "Con este cupo pasarían todos";
    if (solved >= sim.round.capacity - 1) return "Ya casi se llenó el cupo";
  }
  return null;
}

/** Lo que haría el admin desde "Progreso del torneo": anunciar un par permitido. */
function announce(sim: Sim, now: number) {
  const allowed = PAIRS.map((_, index) => index).filter(
    (i) => !blockReason(sim, i, now),
  );
  if (!allowed.length)
    return blockReason(sim, 0, now) ?? "No hay pares disponibles";
  const index = pick(allowed);
  const pair = PAIRS[index]!;
  sim.polls.push({
    id: ++sim.seq,
    pair: index,
    good: pair.good,
    bad: pair.bad,
    announcedAt: now,
    opensAt: now + ANNOUNCE_MS,
    closesAt: now + ANNOUNCE_MS + POLL_MS,
    tally: { good: 0, bad: 0 },
    lean: 0.3 + Math.random() * 0.4,
    status: "open",
    winner: null,
  });
  sim.autoPollAt = null;
  return null;
}

function applyHit(sim: Sim, hit: HitId, now: number) {
  if (hit === "extra")
    sim.round = { ...sim.round, endsAt: sim.round.endsAt + 60_000 };
  if (hit === "cupo-mas")
    sim.round = { ...sim.round, capacity: sim.round.capacity + 1 };
  if (hit === "cupo-menos")
    sim.round = { ...sim.round, capacity: Math.max(1, sim.round.capacity - 1) };
  const duration = DURATION[hit];
  if (duration !== 0)
    sim.active.push({
      id: ++sim.seq,
      hit,
      startsAt: now,
      endsAt: duration === null ? null : now + duration,
    });
}

/** Avanza la simulación hasta `now`: envíos, votos, cierre de votación y de ronda. */
function step(sim: Sim, now: number) {
  if (sim.round.closed) return;
  if (now >= sim.nextSubmitAt) {
    submit(sim, now);
    sim.nextSubmitAt = now + (1800 + Math.random() * 2200) / sim.speed;
  }
  if (sim.autoPollAt !== null && now >= sim.autoPollAt) announce(sim, now);
  const poll = sim.polls.find((p) => p.status === "open");
  if (
    poll &&
    now >= poll.opensAt &&
    now < poll.closesAt &&
    now >= sim.nextTallyAt
  ) {
    // La grada vota de a poco: más al principio y al final.
    const burst = Math.random() < 0.3 ? 4 : 1;
    for (let i = 0; i < burst; i++) {
      if (Math.random() < poll.lean) poll.tally.good += 1;
      else poll.tally.bad += 1;
    }
    sim.nextTallyAt = now + 350 + Math.random() * 500;
  }
  if (poll && now >= poll.closesAt) {
    poll.status = "closed";
    const { good, bad } = poll.tally;
    poll.winner =
      good === bad
        ? pick([poll.good, poll.bad])
        : good > bad
          ? poll.good
          : poll.bad;
    applyHit(sim, poll.winner, now);
  }
  const solved = sim.runners.filter((r) => r.solvedAt !== null).length;
  if (solved >= sim.round.capacity || now >= sim.round.endsAt) {
    sim.round = { ...sim.round, closed: true };
    sim.polls.forEach((p) => {
      if (p.status === "open") p.status = "closed";
    });
  }
}

// ── Vista ───────────────────────────────────────────────────────────────────

export function CasterDemo() {
  const sim = useRef<Sim | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState("");
  const [viewing, setViewing] = useState<Sub | null>(null);
  const [view, setView] = useState<"pista" | "pizarra">("pista");
  const whiteboard = useBoard();
  sim.current ??= newSim(now);

  useEffect(() => {
    const id = setInterval(() => {
      const at = Date.now();
      if (sim.current) step(sim.current, at);
      setNow(at);
    }, 250);
    return () => clearInterval(id);
  }, []);

  const s = sim.current;
  const entries = board(s);
  const solved = entries.filter((e) => e.solved_at).length;
  const fogOn = isOn(s, "niebla", now);
  const clockHidden = isOn(s, "reloj-oculto", now);
  const left = Math.max(0, s.round.endsAt - now);
  const hint = isOn(s, "pista", now) ? PROBLEM.hint : null;

  const act = (action: () => string | null | void) => {
    setNotice(action() ?? "");
    setNow(Date.now());
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <TopBar />
      <main className="mx-auto max-w-[110rem] space-y-5 px-5 py-6">
        {/* Barra: ronda · problema · clasificados · reloj. */}
        <header className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Ronda {s.round.number} · Cupo {s.round.capacity}
            </p>
            <h1 className="mt-1 truncate text-2xl font-semibold text-foreground">
              {PROBLEM.name}
            </h1>
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <PixelIcon name="users" className="h-4 w-4 text-primary" />
            Participantes: <b className="text-foreground">{s.runners.length}</b>
          </p>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <PixelIcon name="trophy" className="h-4 w-4 text-primary" />
            Clasificados:{" "}
            <b className="text-foreground">
              {Math.min(solved, s.round.capacity)}/{s.round.capacity}
            </b>
          </p>
          <div className="text-right">
            <p
              className={cn(
                "flex items-center gap-2 font-mono text-4xl font-semibold tabular-nums",
                s.round.closed
                  ? "text-muted-foreground"
                  : left <= 10_000
                    ? "animate-run-it-hurry text-danger"
                    : left <= 60_000
                      ? "text-danger"
                      : "text-foreground",
              )}
              role="timer"
            >
              <PixelIcon name="clock" className="h-7 w-7" />
              {s.round.closed ? "Cerrada" : formatClock(left)}
            </p>
            {clockHidden && !s.round.closed && (
              <p className="mt-1 text-xs text-danger">
                Reloj oculto al público ·{" "}
                {formatLeft(activeLeft(s, "reloj-oculto", now))}
              </p>
            )}
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="flex max-h-[38rem] flex-col rounded-xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <PixelIcon name="flag" className="h-4 w-4 text-primary" />{" "}
                Enunciado
              </h2>
              {hint && (
                <p className="mt-3 rounded-lg border border-success/40 bg-success-soft px-3 py-2 text-sm text-success">
                  <b>Pista del organizador</b> (la ven los participantes):{" "}
                  {hint}
                </p>
              )}
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                <ProblemStatement statement={PROBLEM.statement} />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <PixelIcon name="check" className="h-4 w-4 text-primary" />{" "}
                  Casos de prueba
                </h2>
                <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                  Ejemplos ({PROBLEM.samples.length})
                </span>
              </div>
              <div className="mt-3 space-y-3 text-xs">
                {PROBLEM.samples.map((sample, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-border p-3"
                  >
                    <p className="font-medium text-foreground">
                      Ejemplo {index + 1}
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Sample label="Entrada" text={sample.input} />
                      <Sample label="Salida esperada" text={sample.output} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <VotePanel sim={s} now={now} />
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <section className="rounded-xl border border-border bg-card p-3">
              <h2 className="flex flex-wrap items-center gap-2 px-2 pb-2 text-sm font-semibold text-foreground">
                {/* Pestañas: solo cambia esta escena; los envíos quedan debajo. */}
                <span
                  role="tablist"
                  aria-label="Escena"
                  className="flex gap-1 rounded-lg bg-muted p-1"
                >
                  {(
                    [
                      ["pista", "Pista", "play"],
                      ["pizarra", "Pizarra", "code"],
                    ] as const
                  ).map(([id, label, icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={view === id}
                      onClick={() => setView(id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium",
                        view === id
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <PixelIcon name={icon} className="h-3.5 w-3.5" /> {label}
                    </button>
                  ))}
                </span>
                <span className="font-normal text-muted-foreground">
                  {view === "pista"
                    ? "· la carrera en vivo"
                    : "· para explicar la solución"}
                </span>
                {view === "pista" && isOn(s, "apagon", now) && (
                  <span className="ml-auto rounded-md bg-danger-soft px-2 py-0.5 text-xs text-danger">
                    Apagón en las pantallas del público ·{" "}
                    {formatLeft(activeLeft(s, "apagon", now))}
                  </span>
                )}
              </h2>
              {view === "pizarra" ? (
                <Whiteboard board={whiteboard} />
              ) : (
                <Scaled>
                  <ProjectedTrack
                    round={s.round}
                    board={entries}
                    events={s.events}
                    fog={
                      fogOn
                        ? `Niebla · el ranking vuelve en ${formatLeft(activeLeft(s, "niebla", now))}`
                        : null
                    }
                    clockHidden={clockHidden}
                  />
                </Scaled>
              )}
              <Submissions
                subs={s.subs}
                startsAt={s.round.startsAt}
                fog={fogOn ? formatLeft(activeLeft(s, "niebla", now)) : null}
                onView={setViewing}
              />
            </section>
          </div>
        </div>
      </main>

      <SimControls
        sim={s}
        notice={notice}
        onAnnounce={() => act(() => announce(s, Date.now()))}
        onSubmit={() => act(() => submit(s, Date.now()))}
        onSpeed={() =>
          act(() => {
            s.speed = s.speed === 1 ? 4 : 1;
            s.nextSubmitAt = Date.now();
          })
        }
        onClose={() =>
          act(() => {
            s.round = { ...s.round, closed: true };
          })
        }
        onReset={() =>
          act(() => {
            sim.current = newSim(Date.now());
            setViewing(null);
          })
        }
      />
      {viewing && (
        <CodeViewer
          sub={viewing}
          attempt={
            s.subs.filter(
              (sub) => sub.name === viewing.name && sub.at <= viewing.at,
            ).length
          }
          startsAt={s.round.startsAt}
          closed={s.round.closed}
          onClose={() => setViewing(null)}
          onToBoard={() => {
            const style = verdictStyle(viewing.verdict);
            whiteboard.addCode(
              `${viewing.name} · ${style.code} ${viewing.passed}/${TESTS} · ${LANGUAGE_NAME[viewing.language]}`,
              viewing.code,
            );
            setViewing(null);
            setView("pizarra");
          }}
        />
      )}
    </div>
  );
}

function activeLeft(sim: Sim, hit: HitId, now: number) {
  const entry = sim.active.find(
    (a) => a.hit === hit && a.endsAt !== null && a.endsAt > now,
  );
  return entry?.endsAt ? entry.endsAt - now : 0;
}

function Sample({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-foreground">
        {text}
      </pre>
    </div>
  );
}

/**
 * La pista de /pista ocupa la pantalla entera (position: fixed y medidas en vw).
 * Acá se dibuja con el ancho de la ventana y alto 16:9 (como un proyector) y se
 * achica al ancho del recuadro: el transform hace que lo fixed quede adentro.
 */
function Scaled({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, vw: 1280 });
  useLayoutEffect(() => {
    const measure = () =>
      setBox({
        width: ref.current?.clientWidth ?? 0,
        vw: window.innerWidth,
      });
    measure();
    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const scale = box.width / box.vw;
  const height = (box.vw * 9) / 16;
  return (
    <div
      ref={ref}
      className="caster-pista relative overflow-hidden rounded-lg border border-border"
      style={{ height: height * scale }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: box.vw,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Veredicto corto y color de cada uno (los textos largos salen de verdictLabel).
// CE y RE van con colores fijos: en algunas paletas info y accent se parecen.
function verdictStyle(verdict: string) {
  if (verdict === "accepted") return { code: "AC", color: "var(--success)" };
  if (verdict === "Wrong Answer") return { code: "WA", color: "var(--danger)" };
  if (verdict === "Time Limit Exceeded")
    return { code: "TLE", color: "var(--gold)" };
  if (verdict === "Compilation Error") return { code: "CE", color: "#a78bfa" };
  return { code: "RE", color: "#fb923c" };
}

const FILTERS = ["Todos", "WA", "TLE", "CE", "RE", "AC"] as const;

/**
 * Envíos de la ronda con su veredicto, para que el caster cuente en qué fallan:
 * un resumen por veredicto y la lista con participante, tests y penalización.
 */
function Submissions({
  subs,
  startsAt,
  fog,
  onView,
}: {
  subs: Sub[];
  startsAt: number;
  fog: string | null;
  onView: (sub: Sub) => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Todos");
  const counts = new Map<string, number>();
  subs.forEach((sub) => {
    const code = verdictStyle(sub.verdict).code;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  });
  const shown = subs.filter(
    (sub) => filter === "Todos" || verdictStyle(sub.verdict).code === filter,
  );
  return (
    <div className="relative mt-3 rounded-lg border border-border bg-background/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <PixelIcon name="code" className="h-4 w-4 text-primary" /> Envíos
          <span className="text-sm font-normal text-muted-foreground">
            · {subs.length} en la ronda
          </span>
        </h3>
        <div
          role="tablist"
          aria-label="Filtrar envíos"
          className="flex flex-wrap gap-1.5"
        >
          {FILTERS.map((key) => {
            const color =
              key === "Todos"
                ? "var(--primary)"
                : verdictStyle(codeVerdict(key)).color;
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(key)}
                className="rounded-md border px-2.5 py-1 font-mono text-sm font-semibold"
                style={{
                  borderColor: color,
                  background: active ? color : "transparent",
                  color: active ? "var(--background)" : color,
                }}
              >
                {key}
                {key !== "Todos" && (
                  <span className="ml-1.5 opacity-80">
                    {counts.get(key) ?? 0}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 max-h-[26rem] overflow-y-auto pr-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Minuto</th>
              <th className="py-2 pr-3 font-medium">Participante</th>
              <th className="py-2 pr-3 font-medium">Veredicto</th>
              <th className="py-2 pr-3 font-medium">Tests</th>
              <th className="py-2 pr-3 text-right font-medium">Penalización</th>
              <th className="py-2 text-right font-medium">Código</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((sub) => {
              const style = verdictStyle(sub.verdict);
              return (
                <tr
                  key={sub.id}
                  className="animate-run-it-rise border-t border-border"
                >
                  <td className="py-2 pr-3 font-mono text-muted-foreground">
                    {formatClock(Math.max(0, sub.at - startsAt))}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <MiniSprite index={sub.character} />
                      <span className="truncate">{sub.name}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <span
                        className="rounded px-2 py-0.5 font-mono text-sm font-bold text-background"
                        style={{ background: style.color }}
                      >
                        {style.code}
                      </span>
                      <span style={{ color: style.color }}>
                        {verdictLabel(sub.verdict)}
                      </span>
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2 font-mono text-foreground">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${(sub.passed / TESTS) * 100}%`,
                            background: style.color,
                          }}
                        />
                      </span>
                      {sub.passed}/{TESTS}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
                    {sub.verdict === "accepted" ? "—" : `+${sub.penalty} s`}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onView(sub)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
                    >
                      <PixelIcon name="code" className="h-3.5 w-3.5" /> Ver
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Todavía no hay envíos con ese veredicto.
          </p>
        )}
      </div>

      {fog && (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-background/85 text-center backdrop-blur-sm">
          <p className="text-sm text-foreground" style={PIXEL}>
            Niebla · los envíos vuelven en {fog}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Personaje chico para la lista de envíos. Sprite no baja de su tamaño real
 * (factor 1), y cada hoja tiene otro tamaño de cuadro: se dibuja a tamaño real
 * y se achica con transform hasta entrar en la casilla de 40 px.
 */
function MiniSprite({ index }: { index: number }) {
  const character = characterAt(index);
  const width = character.gif ? character.gif.width : character.fw;
  const height = character.gif ? character.gif.height : character.fh;
  const zoom = 48 / Math.max(height, width * 0.8);
  return (
    <span className="relative block h-10 w-10 shrink-0 overflow-hidden">
      <span
        className="absolute bottom-0 left-1/2 block"
        style={{
          width,
          height,
          transform: `translateX(-50%) scale(${zoom})`,
          transformOrigin: "bottom center",
        }}
      >
        <Sprite index={index} scale={0.01} />
      </span>
    </span>
  );
}

const LANGUAGE_NAME: Record<SubLanguage, string> = {
  python: "Python 3",
  c: "C",
  cpp: "C++",
};

/**
 * Código de un envío para el caster: el editor en solo lectura y el resultado de
 * cada caso. Mientras la ronda sigue es privado (no va a la transmisión) y el de
 * un envío Aceptado no se muestra: sería la solución para los que siguen.
 */
function CodeViewer({
  sub,
  attempt,
  startsAt,
  closed,
  onClose,
  onToBoard,
}: {
  sub: Sub;
  attempt: number;
  startsAt: number;
  closed: boolean;
  onClose: () => void;
  onToBoard: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const style = verdictStyle(sub.verdict);
  const locked = sub.verdict === "accepted" && !closed;
  const firstFail = sub.cases.findIndex((result) => result !== "ok");
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Código de ${sub.name}`}
        className="max-h-[92dvh] w-full max-w-6xl overflow-y-auto rounded-xl border border-border bg-card text-foreground shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-4">
          <MiniSprite index={sub.character} />
          <div className="min-w-0">
            <p className="text-lg font-semibold">{sub.name}</p>
            <p className="text-xs text-muted-foreground">
              Envío {attempt} · minuto{" "}
              {formatClock(Math.max(0, sub.at - startsAt))} ·{" "}
              {LANGUAGE_NAME[sub.language]}
            </p>
          </div>
          <span className="flex items-center gap-2">
            <span
              className="rounded px-2 py-0.5 font-mono text-sm font-bold text-background"
              style={{ background: style.color }}
            >
              {style.code}
            </span>
            <span style={{ color: style.color }}>
              {verdictLabel(sub.verdict)}
            </span>
          </span>
          <span className="font-mono text-sm">
            {sub.passed}/{TESTS} tests
          </span>
          <button
            type="button"
            onClick={onToBoard}
            disabled={!closed}
            title={
              closed
                ? "Pega el código en la pizarra para explicarlo"
                : "Se habilita al cerrar la ronda: la pizarra sale en la transmisión"
            }
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PixelIcon name="code" className="h-3.5 w-3.5" /> Llevar a la
            pizarra
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
          >
            <PixelIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        <p
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 text-sm",
            closed
              ? "bg-success-soft text-success"
              : "bg-danger-soft text-danger",
          )}
        >
          <PixelIcon
            name={closed ? "check" : "skull"}
            className="h-4 w-4 shrink-0"
          />
          {closed
            ? "Ronda cerrada: ya puedes mostrar este código en la transmisión."
            : "Ronda en curso: este código es solo para tu pantalla. No lo muestres en la transmisión ni en el proyector."}
        </p>

        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]">
          <div className="caster-code overflow-hidden rounded-lg border border-editor-border bg-editor">
            <div className="flex items-center gap-2 border-b border-editor-border px-3 py-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-primary"
              />
              <span className="font-mono text-xs text-editor-foreground">
                solution.{sub.language === "python" ? "py" : sub.language}
              </span>
              <span className="ml-auto text-xs text-editor-muted">
                Solo lectura
              </span>
            </div>
            {locked ? (
              <div className="grid h-96 place-items-center px-6 text-center">
                <div>
                  <PixelIcon
                    name="trophy"
                    className="mx-auto h-8 w-8 text-success"
                  />
                  <p className="mt-3 text-sm text-editor-foreground">
                    Es una solución aceptada: se revela cuando cierre la ronda.
                  </p>
                  <p className="mt-1 text-xs text-editor-muted">
                    Así nadie la ve antes de terminar, ni siquiera de rebote en
                    la transmisión.
                  </p>
                </div>
              </div>
            ) : (
              <CodeEditor
                key={sub.id}
                value={sub.code}
                onChange={() => undefined}
                language={sub.language}
                readOnly
              />
            )}
          </div>

          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <PixelIcon name="check" className="h-4 w-4 text-primary" /> Casos
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {sub.verdict === "Compilation Error"
                ? "No compiló: no corrió ningún caso."
                : firstFail === -1
                  ? "Pasó los 30 casos."
                  : `Pasó ${sub.passed} de ${TESTS}. El primer caso que falla es el ${firstFail + 1}.`}
            </p>
            <div className="mt-3 grid grid-cols-6 gap-1.5">
              {sub.cases.map((result, index) => {
                const ok = result === "ok";
                return (
                  <span
                    key={index}
                    title={`Caso ${index + 1}: ${ok ? "correcto" : verdictLabel(result)}`}
                    className={cn(
                      "grid h-9 place-items-center rounded-md font-mono text-xs font-semibold",
                      ok ? "bg-success-soft text-success" : "text-background",
                      index === firstFail && "ring-2 ring-foreground",
                    )}
                    style={
                      ok
                        ? undefined
                        : { background: verdictStyle(result).color }
                    }
                  >
                    {index + 1}
                  </span>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-success-soft ring-1 ring-success" />{" "}
                Correcto
              </span>
              {firstFail !== -1 && (
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-3 w-3 rounded-sm"
                    style={{ background: style.color }}
                  />{" "}
                  {verdictLabel(sub.verdict)}
                </span>
              )}
            </div>
            <p className="mt-4 rounded-lg border border-border p-3 text-xs text-muted-foreground">
              Los casos van de los chicos a los más grandes: si falla desde la
              mitad, suele ser un borde o el tamaño de la entrada. Ningún caso
              muestra su entrada, igual que para los participantes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Un veredicto de ejemplo para cada código, para tomar su color. */
function codeVerdict(code: string) {
  return (
    {
      AC: "accepted",
      WA: "Wrong Answer",
      TLE: "Time Limit Exceeded",
      CE: "Compilation Error",
    }[code] ?? "Runtime Error (Other)"
  );
}

/** Votación de la grada: anuncio, votación abierta con QR, resultado y hits activos. */
function VotePanel({ sim, now }: { sim: Sim; now: number }) {
  const poll = sim.polls[sim.polls.length - 1];
  const phase = !poll
    ? "none"
    : poll.status === "open" && now < poll.opensAt
      ? "announced"
      : poll.status === "open"
        ? "open"
        : now - poll.closesAt < RESULT_MS
          ? "result"
          : "none";
  const timed = sim.active.filter((a) => a.endsAt === null || a.endsAt > now);

  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-5",
        phase === "announced" || phase === "open"
          ? "border-accent"
          : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <PixelIcon name="zap" className="h-4 w-4 text-primary" /> Votación
        </h2>
        <span className="text-xs text-muted-foreground">
          Votaciones en esta ronda: {sim.polls.length}/{MAX_POLLS}
        </span>
      </div>

      {poll && (phase === "announced" || phase === "open") && (
        <div className="mt-4 grid items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="mx-auto">
            <VoteQr size={180} />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              QR para votar
            </p>
          </div>
          <div className="min-w-0">
            <p
              className={cn(
                "text-sm text-accent",
                phase === "announced" && "animate-run-it-blink",
              )}
              style={PIXEL}
            >
              {phase === "announced" ? "Votación próxima" : "¡Vota el hit!"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {phase === "announced"
                ? "Pide a la grada que saque el celular. La votación abre en"
                : "La grada está votando. Cierra en"}
            </p>
            <p className="mt-1 text-4xl tabular-nums text-accent" style={PIXEL}>
              {formatLeft(
                phase === "announced"
                  ? poll.opensAt - now
                  : poll.closesAt - now,
              )}
            </p>
            {phase === "open" && (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  {poll.tally.good + poll.tally.bad} votos
                </p>
                <TallyBars
                  poll={asHitPoll(poll)}
                  good={hitInfo(poll.good)}
                  bad={hitInfo(poll.bad)}
                />
              </>
            )}
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <HitCard id={poll.good} />
              <HitCard id={poll.bad} />
            </div>
          </div>
        </div>
      )}

      {poll?.winner && phase === "result" && (
        <div
          className={cn(
            "animate-run-it-pop mt-4 rounded-lg p-4",
            hitInfo(poll.winner).kind === "bueno"
              ? "bg-success-soft text-success"
              : "bg-danger-soft text-danger",
          )}
        >
          <p className="text-xs uppercase" style={PIXEL}>
            La grada eligió · hit {hitInfo(poll.winner).kind}
          </p>
          <p className="mt-2 text-2xl" style={PIXEL}>
            {hitInfo(poll.winner).name}
          </p>
          <p className="mt-2 text-sm">{hitInfo(poll.winner).text}</p>
          <p className="mt-1 text-xs opacity-80">
            Votos: {poll.tally.good} contra {poll.tally.bad}
          </p>
        </div>
      )}

      {phase === "none" && (
        <div className="mt-4 flex items-center gap-4">
          <div className="opacity-30 grayscale">
            <VoteQr size={96} />
          </div>
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Sin votación en curso</p>
            <p className="mt-1">
              Cuando el organizador anuncie una votación aparecen acá el QR, la
              cuenta regresiva y el recuento en vivo.
            </p>
          </div>
        </div>
      )}

      {timed.length > 0 && phase !== "result" && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground" style={PIXEL}>
            Hits activos
          </p>
          {timed.map((hit) => (
            <p
              key={hit.id}
              className={cn(
                "mt-2 flex justify-between gap-3 text-sm",
                hitInfo(hit.hit).kind === "malo"
                  ? "text-danger"
                  : "text-success",
              )}
            >
              <span>
                <b>{hitInfo(hit.hit).name}</b>{" "}
                <span className="text-muted-foreground">
                  · {hitInfo(hit.hit).scope}
                </span>
              </span>
              <span className="tabular-nums">
                {hit.endsAt === null
                  ? "hasta el cierre"
                  : formatLeft(hit.endsAt - now)}
              </span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function HitCard({ id }: { id: HitId }) {
  const hit = hitInfo(id);
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        hit.kind === "bueno" ? "border-success/40" : "border-danger/40",
      )}
    >
      <p
        className={cn(
          "font-semibold",
          hit.kind === "bueno" ? "text-success" : "text-danger",
        )}
      >
        {hit.name} <span className="text-xs font-normal">· {hit.kind}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hit.text}</p>
    </div>
  );
}

function asHitPoll(poll: Poll): HitPoll {
  return {
    id: String(poll.id),
    good: poll.good,
    bad: poll.bad,
    announced_at: new Date(poll.announcedAt).toISOString(),
    opens_at: new Date(poll.opensAt).toISOString(),
    closes_at: new Date(poll.closesAt).toISOString(),
    status: poll.status,
    winner: poll.winner,
    tally: poll.tally,
    mine: null,
  };
}

function TopBar() {
  const [palette, setPalette] = useState("");
  useEffect(() => setPalette(storedPalette()), []);
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <span className="text-sm text-primary" style={PIXEL}>
          Run&nbsp;It
        </span>
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <PixelIcon name="star" className="h-4 w-4 text-primary" /> Caster
        </span>
        <span className="flex items-center gap-2 text-xs text-danger">
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-danger"
            aria-hidden="true"
          />
          En vivo
        </span>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            Paleta
            <select
              value={palette}
              onChange={(event) => {
                setPalette(event.target.value);
                applyPalette(event.target.value);
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
            >
              {PALETTES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <span className="text-muted-foreground">
            caster_wewolf <span className="text-xs">· solo lectura</span>
          </span>
        </div>
      </div>
    </header>
  );
}

/** Controles de la demo: en el torneo real, la votación la anuncia el admin. */
function SimControls({
  sim,
  notice,
  onAnnounce,
  onSubmit,
  onSpeed,
  onClose,
  onReset,
}: {
  sim: Sim;
  notice: string;
  onAnnounce: () => void;
  onSubmit: () => void;
  onSpeed: () => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const button =
    "rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50";
  return (
    <div
      className={cn(
        "fixed bottom-4 left-4 z-[70] rounded-xl border border-border bg-card/95 p-3 text-foreground shadow-lg backdrop-blur",
        open ? "w-72" : "w-56",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between text-xs text-muted-foreground"
      >
        <span style={PIXEL}>Simulación</span>
        <span>{open ? "Ocultar" : "Mostrar"}</span>
      </button>
      {open && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Solo para la demo: en el torneo el admin anuncia la votación, cierra
            la ronda y los envíos son reales.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={onAnnounce} className={button}>
              Anunciar votación
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={sim.round.closed}
              className={button}
            >
              Envío al azar
            </button>
            <button type="button" onClick={onSpeed} className={button}>
              Velocidad ×{sim.speed === 1 ? 4 : 1}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={sim.round.closed}
              className={button}
            >
              Cerrar ronda
            </button>
            <button type="button" onClick={onReset} className={button}>
              Reiniciar ronda
            </button>
          </div>
          {notice && <p className="mt-2 text-xs text-danger">{notice}</p>}
        </>
      )}
    </div>
  );
}
