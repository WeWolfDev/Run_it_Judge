import { useState } from "react";

import { CodeEditor } from "@/components/CodeEditor";
import { PixelIcon } from "@/components/PixelIcon";
import { ProblemStatement } from "@/components/ProblemStatement";
import { confetti } from "@/lib/confetti";
import { verdictLabel } from "@/lib/runit";
import { play } from "@/lib/sfx";

import { caseVerdict, execute, judge } from "../judge";
import { isUntouchedTemplate, LANGUAGES, TEMPLATES, type Language } from "../problems";
import type { Exercise } from "./content";

// Resolver un ejercicio del mapa, sin reloj (como LeetCode o Codeforces): leer
// el enunciado, probar con los ejemplos o una entrada propia y enviar contra
// todos los casos. El código corre en el navegador (judge/). El borrador se
// guarda en este navegador por ejercicio y lenguaje.

type RunRow = { passed: boolean; stdout: string; stderr: string; verdict: string };

const DRAFT_KEY = (id: string, language: Language) => `run-it-aprende-codigo:${id}:${language}`;

function readDraft(id: string, language: Language) {
  try {
    return localStorage.getItem(DRAFT_KEY(id, language)) ?? TEMPLATES[language];
  } catch {
    return TEMPLATES[language];
  }
}

export function Practice({
  exercise,
  solved,
  onAccepted,
  onBack,
  backLabel,
}: {
  exercise: Exercise;
  solved: boolean;
  /** Envío aceptado; `firstTime` si el ejercicio no estaba resuelto. */
  onAccepted: (firstTime: boolean) => void;
  onBack: () => void;
  backLabel: string;
}) {
  const [language, setLanguage] = useState<Language>("cpp");
  const [code, setCodeState] = useState(() => readDraft(exercise.id, "cpp"));
  const [stage, setStage] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [tab, setTab] = useState<"samples" | "custom">("samples");
  const [custom, setCustom] = useState(exercise.samples[0] ?? "");
  const [customRow, setCustomRow] = useState<RunRow | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  const setCode = (value: string) => {
    setCodeState(value);
    try {
      localStorage.setItem(DRAFT_KEY(exercise.id, language), value);
    } catch {
      // Sin almacenamiento el borrador dura hasta recargar.
    }
  };

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    setCodeState(readDraft(exercise.id, next));
    setRows(null);
    setCustomRow(null);
    setEditorKey((k) => k + 1);
  };

  const guard = (action: string) => {
    if (busy) return false;
    if (isUntouchedTemplate(code)) {
      setMessage(`Escribe tu solución antes de ${action}: la plantilla sola no resuelve nada.`);
      return false;
    }
    setMessage("");
    return true;
  };

  const run = async (mode: "samples" | "custom" = tab) => {
    if (!guard("probar")) return;
    setBusy(true);
    const inputs = mode === "custom" ? [custom] : exercise.samples;
    try {
      const { runs, compileError } = await execute(
        language,
        code,
        inputs,
        exercise.seconds,
        setStage,
      );
      const result: RunRow[] =
        compileError !== undefined
          ? inputs.map(() => ({
              passed: false,
              stdout: "",
              stderr: compileError,
              verdict: language === "python" ? "Runtime Error (NZEC)" : "Compilation Error",
            }))
          : runs.map((r, k) => {
              const v =
                mode === "custom"
                  ? r.verdict === "ok"
                    ? `Terminó en ${r.ms} ms`
                    : r.verdict
                  : caseVerdict(r, exercise.solve(inputs[k] ?? ""));
              return {
                passed: v === "Accepted" || mode === "custom",
                stdout: r.stdout,
                stderr: r.stderr,
                verdict: v,
              };
            });
      if (mode === "custom") setCustomRow(result[0] ?? null);
      else setRows(result);
      play(result.every((r) => r.passed) ? "coin" : "error");
    } catch (error) {
      setMessage(`No se pudo ejecutar en este navegador: ${(error as Error).message}`);
      play("error");
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  const send = async () => {
    if (!guard("enviar")) return;
    setBusy(true);
    setVerdict(null);
    try {
      const result = await judge(exercise, language, code, setStage);
      if (result.verdict === "accepted") {
        setVerdict({
          ok: true,
          text: solved
            ? `Aceptado otra vez · ${result.passed} casos`
            : `¡Aceptado! +${exercise.points} XP · ${result.passed} casos`,
        });
        if (!solved) confetti({ x: 0.7, y: 0.35 });
        play("win");
        onAccepted(!solved);
      } else {
        setVerdict({
          ok: false,
          text: `${verdictLabel(result.verdict)} · ${result.passed} casos correctos`,
        });
        setMessage(result.detail.slice(0, 1500));
        play("error");
      }
    } catch (error) {
      setMessage(`No se pudo corregir en este navegador: ${(error as Error).message}`);
      play("error");
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {backLabel}
        </button>
        <p className="flex items-center gap-2 text-sm">
          {solved && (
            <span className="rounded-md bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
              Resuelto
            </span>
          )}
          <span className="font-mono text-silk-2">+{exercise.points} XP</span>
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="flex max-h-[38rem] flex-col rounded-xl border border-border bg-card p-5">
          <h1 className="text-xl font-semibold text-foreground">{exercise.name}</h1>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <ProblemStatement statement={exercise.statement} />
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-editor">
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
          <CodeEditor
            key={`${exercise.id}-${language}-${editorKey}`}
            value={code}
            onChange={setCode}
            language={language}
            readOnly={busy}
            onRunShortcut={() => void run()}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-editor-border px-4 py-3">
            <p className="text-xs text-editor-muted">Probar usa los ejemplos · Ctrl/Cmd + Enter</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy}
                className="rounded-lg border border-editor-border px-4 py-2 text-sm font-medium text-editor-foreground hover:bg-white/5 disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  <PixelIcon name="play" className="h-4 w-4" /> Probar
                </span>
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy}
                className="rounded-lg bg-info px-4 py-2 text-sm font-medium text-info-foreground hover:opacity-90 disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  <PixelIcon name="zap" className="h-4 w-4" /> Enviar
                </span>
              </button>
            </div>
          </div>
          {verdict && (
            <p
              role="status"
              className={`animate-run-it-rise flex items-center gap-2 border-t border-editor-border px-4 py-2 text-sm font-bold ${verdict.ok ? "text-success" : "text-danger"}`}
            >
              <PixelIcon name={verdict.ok ? "trophy" : "close"} className="h-4 w-4" />
              {verdict.text}
            </p>
          )}
          {(stage || message) && (
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-editor-border px-4 py-2 font-mono text-xs text-editor-muted">
              {stage || message}
            </p>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
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
                ["samples", `Ejemplos (${exercise.samples.length})`],
                ["custom", "Entrada propia"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
          {tab === "samples" &&
            exercise.samples.map((sample, k) => {
              const row = rows?.[k];
              return (
                <div key={k} className="min-w-0 rounded-lg border border-border p-3">
                  <p className="flex items-center justify-between gap-2 font-medium text-foreground">
                    Ejemplo {k + 1}
                    {row && (
                      <span className={row.passed ? "text-success" : "text-danger"}>
                        {row.passed ? "Correcto" : verdictLabel(row.verdict)}
                      </span>
                    )}
                  </p>
                  <IO label="Entrada" text={sample} />
                  <IO label="Salida esperada" text={exercise.solve(sample)} />
                  {row && (
                    <IO
                      label="Tu salida"
                      text={row.stdout || "(vacía)"}
                      tone={row.passed ? "ok" : "bad"}
                    />
                  )}
                  {row?.stderr && <IO label="Errores" text={row.stderr} tone="bad" />}
                </div>
              );
            })}
          {tab === "custom" && (
            <>
              <label className="block min-w-0">
                <span className="text-muted-foreground">Entrada (stdin)</span>
                <textarea
                  id="aprende-entrada"
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                  spellCheck={false}
                  rows={5}
                  className="mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring"
                />
                <button
                  type="button"
                  onClick={() => void run("custom")}
                  disabled={busy}
                  className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  Probar con esta entrada
                </button>
              </label>
              {customRow && (
                <div className="min-w-0 rounded-lg border border-border p-3">
                  <p className="flex justify-between font-medium text-foreground">
                    Tu salida{" "}
                    <span className="text-muted-foreground">{verdictLabel(customRow.verdict)}</span>
                  </p>
                  <IO label="" text={customRow.stdout || "(vacía)"} />
                  {customRow.stderr && <IO label="Errores" text={customRow.stderr} tone="bad" />}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function IO({ label, text, tone }: { label: string; text: string; tone?: "ok" | "bad" }) {
  const color =
    tone === "ok"
      ? "bg-success-soft text-success"
      : tone === "bad"
        ? "bg-danger-soft text-danger"
        : "bg-muted text-foreground";
  return (
    <div className="mt-2">
      {label && <p className="text-muted-foreground">{label}</p>}
      <pre className={`mt-1 max-h-40 overflow-auto rounded-md px-3 py-2 font-mono ${color}`}>
        {text}
      </pre>
    </div>
  );
}
