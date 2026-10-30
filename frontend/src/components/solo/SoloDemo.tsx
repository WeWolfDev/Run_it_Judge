import { useEffect, useRef, useState, type ReactNode } from "react";

import { CharacterCarousel } from "@/components/CharacterCarousel";
import { CodeEditor } from "@/components/CodeEditor";
import { PixelIcon } from "@/components/PixelIcon";
import { ProblemStatement } from "@/components/ProblemStatement";
import { Sprite } from "@/components/Sprite";
import { WaitingScreen } from "@/components/WaitingScreen";
import { characterAt } from "@/lib/characters";
import { confetti } from "@/lib/confetti";
import { applyPalette, PALETTES, storedPalette } from "@/lib/palette";
import { formatClock, verdictLabel, verdictTone } from "@/lib/runit";
import { getSelectedCharacter } from "@/lib/session";
import { onSoundChange, play, setSoundOn, soundOn } from "@/lib/sfx";

import { caseVerdict, execute, judge } from "./judge";
import {
  isUntouchedTemplate,
  LANGUAGES,
  LEVELS,
  PROBLEMS,
  TEMPLATES,
  TESTS,
  type Language,
  type Level,
  type Problem,
} from "./problems";

// Demo solo: practicar contra el reloj sin cuenta y sin el servidor del torneo.
// Usa los componentes de la vista del participante (carrusel, sala de espera
// CRT, editor, Game Over, ceremonia) y corrige en el navegador.
// Flujo: personaje (con tiempo y dificultad) → cuenta regresiva → ejercicio →
// ganaste o perdiste → volver a jugar o al menú. Se entra desde el login
// (/practica) y solo fuera del torneo: con una ronda en juego no está. También
// se publica sola en GitHub Pages (src/solo-main.tsx): ahí onExit vuelve a su
// pantalla de inicio y `account` trae la cuenta opcional.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
const USER = "demo-solo";
const COUNTDOWN_MS = 5000;
const PENALTY_S = 30;
/** Igual que Eliminated.tsx: cuánto dura la animación antes de la pantalla CRT. */
const OUT_MS = 4800;
const RECORDS_KEY = "run-it-demo-solo-records";

type Phase = "pick" | "wait" | "play" | "won" | "lost";
type Sub = {
  id: number;
  at: number;
  language: Language;
  verdict: string;
  passed: number;
};
type RunRow = {
  passed: boolean;
  stdout: string;
  stderr: string;
  verdict: string;
};
type Moment = { kind: "solved" | "pass" | "fail"; text: string; key: number };

const VERDICT_TONE_CLASS = {
  pending: "text-info",
  success: "text-success",
  danger: "text-danger",
} as const;

function readRecords(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

export function SoloDemo({ onExit, account }: { onExit?: () => void; account?: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [character, setCharacter] = useState(0);
  const [minutes, setMinutes] = useState(10);
  const [level, setLevel] = useState<Level>("easy");
  const [problem, setProblem] = useState<Problem>(PROBLEMS[0]!);
  const [result, setResult] = useState<Result | null>(null);
  const last = useRef("");

  useEffect(() => setCharacter(getSelectedCharacter(USER)), []);

  const start = () => {
    // Otro ejercicio al azar de la dificultad elegida, distinto del anterior.
    const options = PROBLEMS.filter((p) => p.level === level && p.id !== last.current);
    const next = options[Math.floor(Math.random() * options.length)]!;
    last.current = next.id;
    setProblem(next);
    setPhase("wait");
  };

  const home = () => setPhase("pick");

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <TopBar onHome={home} onExit={onExit} account={account} />
      <div className="mx-auto max-w-7xl px-5 py-8">
        {phase === "pick" && (
          <section className="animate-run-it-rise rounded-xl border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Demo solo</p>
            <h1 className="mt-1 text-lg font-semibold text-foreground">Elige tu personaje</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Es el que corre hacia la meta mientras resuelves. Cada 6 tests avanza un tramo.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm">
              <Choice
                label="Tiempo"
                options={[10, 15, 20].map((m) => ({ id: m, label: `${m} min` }))}
                value={minutes}
                onChange={setMinutes}
              />
              <Choice
                label="Dificultad"
                options={LEVELS}
                value={level}
                onChange={setLevel}
                colorOf={(id) => LEVEL_COLOR[id]}
              />
            </div>
            <CharacterCarousel
              username={USER}
              onSelect={(index) => {
                setCharacter(index);
                start();
              }}
            />
          </section>
        )}
        {phase === "wait" && <Countdown character={character} onDone={() => setPhase("play")} />}
        {phase === "play" && (
          <Play
            key={problem.id + String(Date.now())}
            problem={problem}
            character={character}
            minutes={minutes}
            onEnd={(r) => {
              setResult(r);
              setPhase(r.won ? "won" : "lost");
            }}
          />
        )}
        {phase === "won" && result && (
          <Won result={result} character={character} onAgain={start} onMenu={home} />
        )}
        {phase === "lost" && result && (
          <Lost result={result} character={character} onAgain={start} onMenu={home} />
        )}
      </div>
    </div>
  );
}

// Color de cada dificultad, sacado de la paleta: verde de éxito, ámbar entre el
// oro y el rojo, y un rojo de peligro apagado.
const LEVEL_COLOR: Record<Level, string> = {
  easy: "var(--success)",
  medium: "color-mix(in oklch, var(--gold) 70%, var(--danger))",
  hard: "color-mix(in oklch, var(--danger) 75%, var(--muted-foreground))",
};

// Selector de opciones con el estilo de las pestañas de "Casos de prueba". La
// opción elegida se pinta con su color (por defecto, el primario de la paleta).
function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
  colorOf = () => "var(--primary)",
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  colorOf?: (id: T) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground">{label}:</span>
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              value === option.id
                ? "font-semibold shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={
              value === option.id
                ? {
                    background: colorOf(option.id),
                    color: "var(--primary-foreground)",
                  }
                : undefined
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Barra de arriba: la misma de la app (logo, paleta, sonido y salir). La demo
// solo es para quien está fuera del torneo: con sesión se ve "Mi carrera" y nada
// más; sin sesión, "Demo solo", y Salir vuelve al login (en GitHub Pages, a su
// pantalla de inicio). Sin onExit el botón no aparece.
function TopBar({
  onHome,
  onExit,
  account,
}: {
  onHome: () => void;
  onExit: (() => void) | undefined;
  account: ReactNode;
}) {
  const [palette, setPalette] = useState("");
  const [sound, setSound] = useState(false);
  useEffect(() => {
    setPalette(storedPalette());
    setSound(soundOn());
    return onSoundChange(() => setSound(soundOn()));
  }, []);
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <button type="button" onClick={onHome} className="text-sm text-primary" style={PIXEL}>
          Run&nbsp;It
        </button>
        <button
          type="button"
          onClick={onHome}
          className="flex items-center gap-1.5 text-sm font-medium text-foreground"
        >
          <PixelIcon name="gamepad" className="h-4 w-4 text-primary" /> Demo solo
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            Paleta
            <select
              value={palette}
              onChange={(event) => {
                setPalette(event.target.value);
                applyPalette(event.target.value);
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-ring"
            >
              {PALETTES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setSoundOn(!sound)}
            aria-pressed={sound}
            className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground"
          >
            Sonido: {sound ? "sí" : "no"}
          </button>
          {account}
        </div>
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Volver al login
          </button>
        )}
      </div>
    </header>
  );
}

function Countdown({ character, onDone }: { character: number; onDone: () => void }) {
  const [left, setLeft] = useState(COUNTDOWN_MS);
  useEffect(() => {
    const end = Date.now() + COUNTDOWN_MS;
    const id = setInterval(() => setLeft(Math.max(0, end - Date.now())), 200);
    const done = setTimeout(onDone, COUNTDOWN_MS + 900);
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
    // onDone es estable para esta pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <WaitingScreen
      roundNumber={null}
      tournamentName="Demo solo"
      character={character}
      countdownMs={left}
    />
  );
}

type Result = {
  won: boolean;
  problem: Problem;
  best: number;
  subs: number;
  fails: number;
  playedMs: number;
  record: boolean;
  previous: number | null;
};

// ---------------------------------------------------------------- ejercicio

function Play({
  problem,
  character,
  minutes,
  onEnd,
}: {
  problem: Problem;
  character: number;
  minutes: number;
  onEnd: (result: Result) => void;
}) {
  const [language, setLanguage] = useState<Language>("cpp");
  const [codes, setCodes] = useState<Partial<Record<Language, string>>>({});
  const code = codes[language] ?? TEMPLATES[language];
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [history, setHistory] = useState<Sub[]>([]);
  const [best, setBest] = useState(0);
  const [moment, setMoment] = useState<Moment | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [running, setRunning] = useState(false);
  /** Qué está haciendo el juez (descargar, compilar, caso N de 30). */
  const [stage, setStage] = useState("");
  const busy = running || sending;
  const [runTab, setRunTab] = useState<"samples" | "custom">("samples");
  const [customInput, setCustomInput] = useState(problem.samples[0] ?? "");
  const [runRows, setRunRows] = useState<RunRow[] | null>(null);
  const [customRow, setCustomRow] = useState<RunRow | null>(null);
  const [solved, setSolved] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const ended = useRef(false);

  const total = minutes * 60_000;
  const remaining = Math.max(0, startedAt + total - now);

  const finish = (won: boolean, rows: Sub[], bestPassed: number) => {
    if (ended.current) return;
    ended.current = true;
    const fails = rows.filter((row) => verdictTone(row.verdict) === "danger").length;
    const playedMs = Date.now() - startedAt + (won ? fails * PENALTY_S * 1000 : 0);
    const records = readRecords();
    const previous = records[problem.id] ?? null;
    const record = won && (previous === null || playedMs < previous);
    if (record) {
      try {
        localStorage.setItem(RECORDS_KEY, JSON.stringify({ ...records, [problem.id]: playedMs }));
      } catch {
        // Sin almacenamiento: el récord dura esta partida.
      }
    }
    onEnd({
      won,
      problem,
      best: bestPassed,
      subs: rows.length,
      fails,
      playedMs,
      record,
      previous,
    });
  };

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  // Se acabó el tiempo: pierde con lo que haya pasado.
  useEffect(() => {
    if (remaining === 0 && !solved) finish(false, history, best);
  });

  const setCode = (value: string) => setCodes((current) => ({ ...current, [language]: value }));

  // Probar: corre los ejemplos (o la entrada propia) con el juez del navegador.
  const run = async (mode: "samples" | "custom" = runTab) => {
    if (busy) return;
    if (isUntouchedTemplate(code)) {
      setMessage("Escribe tu solución antes de probar: la plantilla sola no resuelve nada.");
      return;
    }
    setMessage("");
    setRunning(true);
    const inputs = mode === "custom" ? [customInput] : problem.samples;
    try {
      const { runs, compileError } = await execute(
        language,
        code,
        inputs,
        problem.seconds,
        setStage,
      );
      if (ended.current) return;
      const rows: RunRow[] =
        compileError !== undefined
          ? inputs.map(() => ({
              passed: false,
              stdout: "",
              stderr: compileError,
              verdict: language === "python" ? "Runtime Error (NZEC)" : "Compilation Error",
            }))
          : runs.map((result, index) => {
              const verdict =
                mode === "custom"
                  ? result.verdict === "ok"
                    ? `Terminó en ${result.ms} ms`
                    : result.verdict
                  : caseVerdict(result, problem.solve(inputs[index] ?? ""));
              return {
                passed: verdict === "Accepted" || mode === "custom",
                stdout: result.stdout,
                stderr: result.stderr,
                verdict,
              };
            });
      if (mode === "custom") setCustomRow(rows[0] ?? null);
      else setRunRows(rows);
      play(rows.every((row) => row.passed) ? "coin" : "error");
    } catch (error) {
      setMessage(`No se pudo ejecutar en este navegador: ${(error as Error).message}`);
      play("error");
    } finally {
      setRunning(false);
      setStage("");
    }
  };

  const send = async () => {
    if (busy) return;
    if (isUntouchedTemplate(code)) {
      setMessage("Escribe tu solución antes de enviar: la plantilla no cuenta como envío.");
      return;
    }
    setMessage("");
    setSending(true);
    const id = history.length + 1;
    const queued: Sub = {
      id,
      at: Date.now(),
      language,
      verdict: "queued",
      passed: 0,
    };
    setHistory((rows) => [queued, ...rows]);
    let result: Awaited<ReturnType<typeof judge>>;
    try {
      result = await judge(problem, language, code, setStage);
    } catch (error) {
      // Falló el juez, no el código: el envío no cuenta.
      setHistory((rows) => rows.filter((row) => row.id !== id));
      setMessage(`No se pudo corregir en este navegador: ${(error as Error).message}`);
      play("error");
      return;
    } finally {
      setSending(false);
      setStage("");
    }
    if (ended.current) return;
    const { verdict, passed, detail } = result;
    const judged = { ...queued, verdict, passed };
    const rows = [judged, ...history];
    setHistory(rows);
    const gained = passed - best;
    const nextBest = Math.max(best, passed);
    setBest(nextBest);
    // Animación y sonido según el veredicto, como en ParticipantView.
    if (verdict === "accepted") {
      setMoment({
        kind: "solved",
        text: "¡Resuelto! Todos los casos",
        key: Date.now(),
      });
      setSolved(true);
      play("win");
      confetti({ x: 0.7, y: 0.35 });
      setTimeout(() => finish(true, rows, TESTS), 2600);
    } else if (gained > 0) {
      setMoment({
        kind: "pass",
        text: `+${gained} ${gained === 1 ? "test" : "tests"} · ${passed}/${TESTS}`,
        key: Date.now(),
      });
      play("coin");
    } else {
      setMoment({
        kind: "fail",
        text: `${verdictLabel(verdict)} · +${PENALTY_S} s`,
        key: Date.now(),
      });
      play("error");
    }
    setMessage(`Resultado: ${passed}/${TESTS} casos.${detail ? ` ${detail}` : ""}`);
  };

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    setRunRows(null);
    setCustomRow(null);
    setEditorKey((k) => k + 1);
  };

  return (
    <div className="space-y-5">
      {/* Barra: nombre del problema · pista hacia la meta · reloj. */}
      <header className="grid grid-cols-1 items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:gap-8">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Demo solo · {LEVELS.find((l) => l.id === problem.level)?.label} · {TESTS} tests
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-foreground">
            {problem.id}. {problem.name}
          </h1>
        </div>
        <Track character={character} best={best} solved={solved} />
        <p
          className={`flex items-center gap-2 font-mono text-4xl font-semibold tabular-nums ${
            remaining <= 10_000
              ? "animate-run-it-hurry text-danger"
              : remaining <= 60_000
                ? "text-danger"
                : "text-foreground"
          }`}
          role="timer"
        >
          <PixelIcon name="clock" className="h-7 w-7" />
          {formatClock(remaining)}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="flex max-h-[34rem] flex-col rounded-xl border border-border bg-card p-5 lg:order-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <PixelIcon name="flag" className="h-4 w-4 text-primary" /> Enunciado
          </h2>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
            <ProblemStatement statement={problem.statement} />
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-editor lg:order-2">
          <div className="flex items-end justify-between gap-3 border-b border-editor-border pl-2 pr-4 pt-2">
            <div className="flex items-center gap-2 rounded-t-md border border-b-0 border-editor-border bg-editor px-3 py-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />
              <span className="font-mono text-xs text-editor-foreground">
                {LANGUAGES[language].file}
              </span>
            </div>
            <select
              value={language}
              onChange={(event) => changeLanguage(event.target.value as Language)}
              disabled={solved}
              aria-label="Lenguaje"
              className="mb-1.5 rounded-md border border-editor-border bg-editor px-2 py-1 font-mono text-xs text-editor-foreground outline-none"
            >
              {(Object.keys(LANGUAGES) as Language[]).map((key) => (
                <option key={key} value={key}>
                  {LANGUAGES[key].label}
                </option>
              ))}
            </select>
          </div>
          {solved && (
            <div
              role="status"
              className="run-it-qualified flex items-center gap-4 border-b border-editor-border px-4 py-3"
            >
              <Sprite index={character} state="run" scale={0.6} />
              <div className="min-w-0">
                <p className="animate-run-it-zoom flex items-center gap-2 text-lg font-bold text-success">
                  <PixelIcon name="trophy" className="h-5 w-5" /> ¡Llegaste a la meta!
                </p>
                <p className="mt-0.5 text-sm text-editor-foreground">
                  Completaste los {TESTS} casos. Un momento…
                </p>
              </div>
            </div>
          )}
          <CodeEditor
            key={`${language}-${editorKey}`}
            value={code}
            onChange={setCode}
            language={language}
            readOnly={solved}
            onRunShortcut={() => run()}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-editor-border px-4 py-3">
            <p className="text-xs text-editor-muted">
              Probar no cuenta como envío · Ctrl/Cmd + Enter
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => run()}
                disabled={busy || solved}
                className="rounded-lg border border-editor-border px-4 py-2 text-sm font-medium text-editor-foreground transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  <PixelIcon name="play" className="h-4 w-4" />
                  {running ? "Probando…" : "Probar"}
                </span>
              </button>
              <button
                type="button"
                onClick={send}
                disabled={busy || solved}
                className="rounded-lg bg-info px-4 py-2 text-sm font-medium text-info-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  <PixelIcon name="zap" className="h-4 w-4" /> Enviar solución
                </span>
              </button>
            </div>
          </div>
          {(stage || message) && (
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-editor-border px-4 py-2 font-mono text-xs text-editor-muted">
              {stage || message.slice(0, 1500)}
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 lg:order-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PixelIcon name="check" className="h-4 w-4 text-primary" /> Casos de prueba
            </h2>
            <div
              role="tablist"
              aria-label="Casos de prueba"
              className="flex gap-1 rounded-lg bg-muted p-1"
            >
              {(
                [
                  ["samples", `Ejemplos (${problem.samples.length})`],
                  ["custom", "Entrada propia"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={runTab === key}
                  onClick={() => setRunTab(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    runTab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1 text-xs">
            {running && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <span className="run-it-spinner" aria-hidden="true">
                  {Array.from({ length: 9 }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
                {stage || "Ejecutando en tu navegador…"}
              </p>
            )}
            {runTab === "samples" &&
              problem.samples.map((sample, index) => {
                const row = runRows?.[index];
                return (
                  <div key={index} className="rounded-lg border border-border p-3">
                    <p className="flex items-center justify-between gap-2 font-medium text-foreground">
                      Ejemplo {index + 1}
                      {row && (
                        <span className={row.passed ? "text-success" : "text-danger"}>
                          {row.passed ? "Correcto" : verdictLabel(row.verdict)}
                        </span>
                      )}
                    </p>
                    <div className={`mt-2 grid gap-2 ${row ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                      <div>
                        <p className="text-muted-foreground">Entrada</p>
                        <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-foreground">
                          {sample}
                        </pre>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Salida esperada</p>
                        <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-foreground">
                          {problem.solve(sample)}
                        </pre>
                      </div>
                      {row && (
                        <div>
                          <p className="text-muted-foreground">Tu salida</p>
                          <pre
                            className={`mt-1 overflow-x-auto rounded-md px-3 py-2 font-mono ${
                              row.passed
                                ? "bg-success-soft text-success"
                                : "bg-danger-soft text-danger"
                            }`}
                          >
                            {row.stdout || "(vacía)"}
                          </pre>
                        </div>
                      )}
                      {row?.stderr && <ErrorOutput text={row.stderr} />}
                    </div>
                  </div>
                );
              })}
            {runTab === "custom" && (
              <>
                <label className="block">
                  <span className="text-muted-foreground">Entrada (stdin)</span>
                  <textarea
                    value={customInput}
                    onChange={(event) => setCustomInput(event.target.value)}
                    spellCheck={false}
                    rows={4}
                    placeholder="Escribe aquí la entrada que leerá tu programa"
                    className="mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring"
                  />
                </label>
                {customRow && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="flex justify-between font-medium text-foreground">
                      Tu salida
                      <span className="text-muted-foreground">
                        {verdictLabel(customRow.verdict)}
                      </span>
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-foreground">
                      {customRow.stdout || "(vacía)"}
                    </pre>
                    {customRow.stderr && <ErrorOutput text={customRow.stderr} />}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => run("custom")}
                  disabled={busy || solved}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  Probar con esta entrada
                </button>
              </>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 lg:order-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <PixelIcon name="zap" className="h-4 w-4 text-primary" /> Tus envíos
          </h2>
          {moment && (
            <p
              key={moment.key}
              className={`animate-run-it-rise mt-2 flex items-center gap-2 text-sm font-bold ${
                moment.kind === "fail" ? "text-danger" : "text-success"
              }`}
            >
              <PixelIcon
                name={
                  moment.kind === "fail" ? "close" : moment.kind === "solved" ? "trophy" : "check"
                }
                className="h-4 w-4"
              />
              {moment.text}
            </p>
          )}
          {history.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Todavía no enviaste nada. Cada envío fallido suma {PENALTY_S} s de penalización.
            </p>
          ) : (
            <div className="mt-3 max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Hora</th>
                    <th className="pb-2 font-medium">Lenguaje</th>
                    <th className="pb-2 font-medium">Estado</th>
                    <th className="pb-2 text-right font-medium">Casos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 font-mono tabular-nums text-muted-foreground">
                        {new Date(row.at).toLocaleTimeString("es", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>
                      <td className="py-2">{LANGUAGES[row.language].label}</td>
                      <td
                        className={`py-2 font-medium ${VERDICT_TONE_CLASS[verdictTone(row.verdict)]}`}
                      >
                        {verdictLabel(row.verdict)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {row.verdict === "queued" ? "—" : `${row.passed}/${TESTS}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <p className="text-xs text-muted-foreground">
        Tu código corre de verdad en tu navegador, contra {TESTS} casos de prueba. Python usa
        Pyodide y C/C++ se compilan con Clang (la primera vez se descargan, después quedan
        guardados).
      </p>
    </div>
  );
}

// Salida de error o del compilador, como en la vista del participante.
function ErrorOutput({ text }: { text: string }) {
  return (
    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-danger-soft px-3 py-2 font-mono text-danger sm:col-span-3">
      {text.slice(0, 3000)}
    </pre>
  );
}

// Tira de la barra: el personaje avanza un tramo cada 6 tests hacia la meta.
function Track({ character, best, solved }: { character: number; best: number; solved: boolean }) {
  const p = best / TESTS;
  return (
    <div
      className="relative h-20 overflow-hidden rounded-lg border border-border bg-muted"
      aria-label={`Avance: ${best} de ${TESTS} tests`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-3 border-t-2 border-dashed border-border"
      />
      {[6, 12, 18, 24].map((t) => (
        <span
          key={t}
          aria-hidden="true"
          className="absolute bottom-0 -translate-x-1/2 font-mono text-[10px] text-muted-foreground"
          style={{ left: `calc(1rem + ${t / TESTS} * (100% - 4rem))` }}
        >
          {t}
        </span>
      ))}
      <PixelIcon name="flag" className="absolute right-2 top-3 h-8 w-8 text-primary" />
      <div
        className="absolute bottom-3 transition-[left] duration-700 ease-[steps(8)]"
        style={{ left: `calc(${p} * (100% - 5rem))` }}
      >
        <Sprite index={character} state={solved ? "idle" : "run"} scale={0.5} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- finales

function Stats({ result, won }: { result: Result; won: boolean }) {
  return (
    <div className="flex flex-wrap justify-center gap-2 text-sm">
      <span className="elim-chip text-foreground">
        <PixelIcon name="check" className="h-4 w-4 text-success" /> Tests: {result.best}/{TESTS}
      </span>
      <span className="elim-chip text-foreground">
        <PixelIcon name="clock" className="h-4 w-4 text-primary" />{" "}
        {won ? "Tiempo final" : "Tiempo jugado"}: {formatClock(result.playedMs)}
      </span>
      <span className="elim-chip text-foreground">
        <PixelIcon name="close" className="h-4 w-4 text-danger" /> Envíos fallidos: {result.fails}
        {won && result.fails > 0 ? ` (+${result.fails * PENALTY_S} s)` : ""}
      </span>
    </div>
  );
}

function EndButtons({ onAgain, onMenu }: { onAgain: () => void; onMenu: () => void }) {
  return (
    <div className="mt-2 flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => {
          play("click");
          onAgain();
        }}
        className="elim-exit bg-primary px-6 py-3 text-xs text-primary-foreground sm:text-sm"
        style={PIXEL}
      >
        Volver a jugar
      </button>
      <span className="text-xs text-muted-foreground">Te toca otro ejercicio al azar</span>
      <button
        type="button"
        onClick={onMenu}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        Volver al inicio
      </button>
    </div>
  );
}

// Victoria: la pantalla del campeón de la ceremonia, con confeti y fanfarria.
function Won({
  result,
  character,
  onAgain,
  onMenu,
}: {
  result: Result;
  character: number;
  onAgain: () => void;
  onMenu: () => void;
}) {
  useEffect(() => {
    confetti({ x: 0.5, y: 0.35 });
    play("win");
  }, []);
  return (
    <div className="cer-crt cer-compact relative overflow-hidden">
      <div className="cer-scan pointer-events-none absolute inset-0" />
      <div className="run-it-crt-sweep" />
      <div className="relative z-10 flex min-h-[28rem] flex-col items-center justify-center gap-5 px-6 py-10 text-center">
        <PixelIcon name="trophy" className="animate-run-it-pop h-16 w-16 text-[var(--gold)]" />
        <div className="animate-run-it-rise">
          <Sprite index={character} state="run" scale={1.6} />
        </div>
        <p
          className="cer-title animate-run-it-zoom text-[clamp(1.4rem,5vw,3.4rem)] leading-tight text-[var(--gold)]"
          style={PIXEL}
        >
          ¡Lo conseguiste!
        </p>
        <p className="max-w-xl text-base text-foreground sm:text-lg">
          {characterAt(character).name} cruzó la meta en <b>{result.problem.name}</b> con los{" "}
          {TESTS} tests.
        </p>
        <Stats result={result} won />
        {result.record ? (
          <p className="animate-run-it-blink text-xs text-[var(--gold)] sm:text-sm" style={PIXEL}>
            ¡Nuevo récord!
          </p>
        ) : result.previous !== null ? (
          <p className="text-sm text-muted-foreground">
            Tu récord en este ejercicio: {formatClock(result.previous)}
          </p>
        ) : null}
        <EndButtons onAgain={onAgain} onMenu={onMenu} />
      </div>
    </div>
  );
}

// Derrota: la misma animación de Eliminated (temblor, destello, derrota y GAME
// OVER) y después la pantalla CRT con el puntaje.
function Lost({
  result,
  character,
  onAgain,
  onMenu,
}: {
  result: Result;
  character: number;
  onAgain: () => void;
  onMenu: () => void;
}) {
  const [crt, setCrt] = useState(false);
  useEffect(() => {
    play("over");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = setTimeout(() => setCrt(true), reduced ? 800 : OUT_MS);
    return () => clearTimeout(id);
  }, []);
  if (!crt) {
    return (
      <section className="elim-stage animate-run-it-shake relative grid min-h-[28rem] place-items-center overflow-hidden rounded-xl">
        <div className="animate-run-it-flash pointer-events-none absolute inset-0 bg-danger" />
        <div className="relative z-10 flex flex-col items-center gap-6 text-center">
          <div className="elim-fall">
            <Sprite index={character} state="out" scale={2} speed={0.4} />
          </div>
          <p
            className="elim-glitch text-[clamp(1.4rem,4vw,3rem)] leading-none text-danger"
            style={PIXEL}
            data-text="GAME OVER"
          >
            GAME OVER
          </p>
          <p
            className="animate-run-it-rise text-sm text-foreground sm:text-base"
            style={{ animationDelay: "0.9s" }}
          >
            Se acabó el tiempo
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="elim-crt relative overflow-hidden">
      <div className="elim-scan pointer-events-none absolute inset-0" />
      <div className="run-it-crt-sweep" />
      <div className="animate-run-it-flicker relative z-10 flex min-h-[28rem] flex-col items-center justify-center gap-5 px-6 py-10 text-center">
        <Sprite index={character} state="out" scale={2.6} />
        <p
          className="elim-title text-[clamp(1.2rem,4vw,2.6rem)] leading-tight text-danger"
          style={PIXEL}
        >
          Se acabó el tiempo
        </p>
        <p className="max-w-xl text-base text-foreground sm:text-lg">
          {characterAt(character).name} no llegó a la meta en <b>{result.problem.name}</b>. Pasaste{" "}
          <b>
            {result.best} de {TESTS}
          </b>{" "}
          tests.
        </p>
        <Stats result={result} won={false} />
        <p className="animate-run-it-blink text-xs text-muted-foreground sm:text-sm" style={PIXEL}>
          ¡Gracias por correr!
        </p>
        <EndButtons onAgain={onAgain} onMenu={onMenu} />
      </div>
    </section>
  );
}
