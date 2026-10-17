import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { TallyBars, VoteQr } from "@/components/hits/Grada";
import { PixelIcon } from "@/components/PixelIcon";
import { ProblemStatement } from "@/components/ProblemStatement";
import {
  ProjectedTrack,
  type Entry,
  type FeedEvent,
  type TrackRound,
} from "@/components/ProjectedTrack";
import { CHARACTERS } from "@/lib/characters";
import { formatLeft, hitInfo, type HitId, type HitPoll } from "@/lib/hits";
import { applyPalette, PALETTES, storedPalette } from "@/lib/palette";
import { formatClock } from "@/lib/runit";
import { cn } from "@/lib/utils";

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
type Active = { id: number; hit: HitId; startsAt: number; endsAt: number | null };
type Sim = {
  round: TrackRound;
  runners: Runner[];
  events: FeedEvent[];
  polls: Poll[];
  active: Active[];
  nextSubmitAt: number;
  nextTallyAt: number;
  autoPollAt: number | null;
  speed: number;
  seq: number;
};

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)] as T;

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
  sim.active.some((a) => a.hit === hit && a.startsAt <= now && (a.endsAt === null || a.endsAt > now));

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
    solved_at: runner.solvedAt === null ? null : new Date(runner.solvedAt).toISOString(),
    penalty_seconds: runner.penalty,
  }));
}

/** Un envío de un participante al azar que todavía no resolvió. */
function submit(sim: Sim, now: number) {
  const pending = sim.runners.filter((r) => r.solvedAt === null);
  if (!pending.length || sim.round.closed) return;
  const runner = pick(pending);
  const base = { id: ++sim.seq, at: now, name: runner.name, character: runner.character };
  const roll = Math.random();
  if (runner.best >= 70 && roll < 0.3) {
    runner.best = 100;
    runner.solvedAt = now;
    const arrival = sim.runners.filter((r) => r.solvedAt !== null).length;
    sim.events = [{ ...base, kind: "solved" as const, arrival }, ...sim.events].slice(0, 40);
    return;
  }
  if (roll < 0.75 && runner.best < 90) {
    runner.best = Math.min(90, runner.best + pick([10, 10, 20, 20, 30]));
    const passed = Math.round((runner.best / 100) * TESTS);
    sim.events = [
      { ...base, kind: "progress" as const, passed, total: TESTS },
      ...sim.events,
    ].slice(0, 40);
    return;
  }
  runner.fails += 1;
  runner.penalty += isOn(sim, "amnistia", now) ? 0 : isOn(sim, "penal-doble", now) ? 60 : 30;
  const passed = Math.round((Math.max(0, runner.best - 20) / 100) * TESTS);
  sim.events = [{ ...base, kind: "fail" as const, passed, total: TESTS }, ...sim.events].slice(
    0,
    40,
  );
}

/** Por qué no se puede anunciar ese par ahora (pollBlockReason del backend). */
function blockReason(sim: Sim, pairIndex: number, now: number) {
  const pair = PAIRS[pairIndex];
  if (!pair) return "El par no existe";
  if (sim.round.closed) return "La ronda no está en curso";
  if (sim.polls.some((p) => p.status === "open")) return "Ya hay una votación en curso";
  if (sim.polls.length >= MAX_POLLS) return `Ya hubo ${MAX_POLLS} votaciones en esta ronda`;
  if (now - sim.round.startsAt < QUIET_START_MS) return "Sin votaciones en el primer minuto";
  if (sim.round.endsAt - now < QUIET_END_MS + ANNOUNCE_MS + POLL_MS)
    return "Sin votaciones en los últimos 2 minutos";
  if (sim.polls.some((p) => p.good === pair.good)) return "Ese par ya se usó en esta ronda";
  if (pair.weight === 3) {
    const solved = sim.runners.filter((r) => r.solvedAt !== null).length;
    if (sim.round.capacity <= 2) return "Con cupo 2 o menos no se tocan los cupos";
    if (sim.round.capacity + 1 >= sim.runners.length) return "Con este cupo pasarían todos";
    if (solved >= sim.round.capacity - 1) return "Ya casi se llenó el cupo";
  }
  return null;
}

/** Lo que haría el admin desde "Progreso del torneo": anunciar un par permitido. */
function announce(sim: Sim, now: number) {
  const allowed = PAIRS.map((_, index) => index).filter((i) => !blockReason(sim, i, now));
  if (!allowed.length) return blockReason(sim, 0, now) ?? "No hay pares disponibles";
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
  if (hit === "extra") sim.round = { ...sim.round, endsAt: sim.round.endsAt + 60_000 };
  if (hit === "cupo-mas") sim.round = { ...sim.round, capacity: sim.round.capacity + 1 };
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
  if (poll && now >= poll.opensAt && now < poll.closesAt && now >= sim.nextTallyAt) {
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
    poll.winner = good === bad ? pick([poll.good, poll.bad]) : good > bad ? poll.good : poll.bad;
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
                Reloj oculto al público · {formatLeft(activeLeft(s, "reloj-oculto", now))}
              </p>
            )}
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="flex max-h-[38rem] flex-col rounded-xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <PixelIcon name="flag" className="h-4 w-4 text-primary" /> Enunciado
              </h2>
              {hint && (
                <p className="mt-3 rounded-lg border border-success/40 bg-success-soft px-3 py-2 text-sm text-success">
                  <b>Pista del organizador</b> (la ven los participantes): {hint}
                </p>
              )}
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                <ProblemStatement statement={PROBLEM.statement} />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <PixelIcon name="check" className="h-4 w-4 text-primary" /> Casos de prueba
                </h2>
                <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                  Ejemplos ({PROBLEM.samples.length})
                </span>
              </div>
              <div className="mt-3 space-y-3 text-xs">
                {PROBLEM.samples.map((sample, index) => (
                  <div key={index} className="rounded-lg border border-border p-3">
                    <p className="font-medium text-foreground">Ejemplo {index + 1}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Sample label="Entrada" text={sample.input} />
                      <Sample label="Salida esperada" text={sample.output} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <section className="rounded-xl border border-border bg-card p-3">
              <h2 className="flex items-center gap-2 px-2 pb-2 text-sm font-semibold text-foreground">
                <PixelIcon name="play" className="h-4 w-4 text-primary" /> Pista
                <span className="font-normal text-muted-foreground">· lo que ve el público</span>
                {isOn(s, "apagon", now) && (
                  <span className="ml-auto rounded-md bg-danger-soft px-2 py-0.5 text-xs text-danger">
                    Apagón en las pantallas del público ·{" "}
                    {formatLeft(activeLeft(s, "apagon", now))}
                  </span>
                )}
              </h2>
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
            </section>

            <VotePanel sim={s} now={now} />
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
        onReset={() =>
          act(() => {
            sim.current = newSim(Date.now());
          })
        }
      />
    </div>
  );
}

function activeLeft(sim: Sim, hit: HitId, now: number) {
  const entry = sim.active.find((a) => a.hit === hit && a.endsAt !== null && a.endsAt > now);
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
        phase === "announced" || phase === "open" ? "border-accent" : "border-border",
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
            <p className="mt-2 text-center text-xs text-muted-foreground">QR para votar</p>
          </div>
          <div className="min-w-0">
            <p
              className={cn("text-sm text-accent", phase === "announced" && "animate-run-it-blink")}
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
              {formatLeft(phase === "announced" ? poll.opensAt - now : poll.closesAt - now)}
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
              Cuando el organizador anuncie una votación aparecen acá el QR, la cuenta regresiva y
              el recuento en vivo.
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
                hitInfo(hit.hit).kind === "malo" ? "text-danger" : "text-success",
              )}
            >
              <span>
                <b>{hitInfo(hit.hit).name}</b>{" "}
                <span className="text-muted-foreground">· {hitInfo(hit.hit).scope}</span>
              </span>
              <span className="tabular-nums">
                {hit.endsAt === null ? "hasta el cierre" : formatLeft(hit.endsAt - now)}
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
      <p className={cn("font-semibold", hit.kind === "bueno" ? "text-success" : "text-danger")}>
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
          <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
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
  onReset,
}: {
  sim: Sim;
  notice: string;
  onAnnounce: () => void;
  onSubmit: () => void;
  onSpeed: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const button =
    "rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50";
  return (
    <div className={cn("fixed bottom-4 left-4 z-[70] rounded-xl border border-border bg-card/95 p-3 text-foreground shadow-lg backdrop-blur", open ? "w-72" : "w-56")}>
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
            Solo para la demo: en el torneo el admin anuncia la votación y los envíos son reales.
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
