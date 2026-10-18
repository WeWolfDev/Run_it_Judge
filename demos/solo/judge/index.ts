// Juez de la demo solo: corre el código en el navegador de quien juega, sin el
// servidor del torneo, así que no se satura con mucha gente a la vez.
// - Python: Pyodide en python.worker.ts.
// - C y C++: Clang en compiler.worker.ts y el programa en wasm.worker.ts.
// Cada caso tiene su límite de tiempo; si no termina, se mata el worker (Tiempo
// excedido) y los casos que faltaban cuentan como no resueltos.

import type { Language, Problem } from "../problems";
import type { CaseRun } from "./protocol";

export type { CaseRun };
export type Stage = (text: string) => void;

/** WebAssembly y Pyodide son más lentos que el binario nativo de Codeforces. */
const SLOWDOWN: Record<Language, number> = { python: 3, c: 2, cpp: 2 };
/** Margen antes de matar un caso colgado (el worker ya lo marca si se pasa). */
const GRACE_MS = 1500;

type Kind = "python" | "wasm";
const workers: Partial<Record<Kind, Worker>> = {};

function workerFor(kind: Kind) {
  workers[kind] ??=
    kind === "python"
      ? new Worker(new URL("./python.worker.ts", import.meta.url), {
          type: "module",
        })
      : new Worker(new URL("./wasm.worker.ts", import.meta.url), {
          type: "module",
        });
  return workers[kind];
}

let compiler: Worker | null = null;
let compileId = 0;
const compiled = new Map<string, Promise<WebAssembly.Module | string>>();

/** Compila C o C++. Devuelve el módulo o el texto del error de compilación. */
function compile(language: "c" | "cpp", code: string, stage: Stage) {
  const key = `${language}\n${code}`;
  const cached = compiled.get(key);
  if (cached) return cached;
  compiler ??= new Worker(new URL("./compiler.worker.ts", import.meta.url), {
    type: "module",
  });
  const worker = compiler;
  const id = ++compileId;
  stage("Compilando…");
  const result = new Promise<WebAssembly.Module | string>((resolve, reject) => {
    const listen = ({ data }: MessageEvent) => {
      if (data.id !== id) return;
      if (data.type === "download") {
        const percent = Math.min(
          99,
          Math.round((100 * data.done) / Math.max(1, data.total)),
        );
        stage(
          `Descargando el compilador de C/C++ (solo la primera vez)… ${percent}%`,
        );
        return;
      }
      worker.removeEventListener("message", listen);
      if (data.type === "done") {
        stage("Compilando…");
        WebAssembly.compile(data.wasm).then(resolve, reject);
      } else if (data.type === "error") resolve(data.stderr);
      else reject(new Error(data.message));
    };
    worker.addEventListener("message", listen);
    worker.postMessage({ id, language, code });
  });
  compiled.clear();
  compiled.set(key, result);
  result.catch(() => compiled.delete(key));
  return result;
}

/** Corre los casos en el worker; si uno no termina a tiempo, mata el worker. */
function runCases(
  kind: Kind,
  payload: object,
  count: number,
  limitMs: number,
  stage: Stage,
) {
  return new Promise<{ runs: CaseRun[]; compileError?: string }>(
    (resolve, reject) => {
      const worker = workerFor(kind);
      const runs: CaseRun[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (value: { runs: CaseRun[]; compileError?: string }) => {
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        resolve(value);
      };
      const kill = () => {
        worker.terminate();
        delete workers[kind];
        while (runs.length < count)
          runs.push({
            verdict: "Time Limit Exceeded",
            stdout: "",
            stderr: "",
            ms: limitMs,
          });
        done({ runs });
      };
      worker.onmessage = ({ data }) => {
        if (data.type === "loading")
          stage("Preparando Python (la primera vez tarda unos segundos)…");
        else if (data.type === "start") {
          stage(
            count > 1 ? `Caso ${data.index + 1} de ${count}…` : "Ejecutando…",
          );
          clearTimeout(timer);
          timer = setTimeout(kill, limitMs + GRACE_MS);
        } else if (data.type === "case") runs.push(data.result);
        else if (data.type === "end") done({ runs });
        else if (data.type === "compile")
          done({ runs, compileError: data.stderr });
        else if (data.type === "fail") {
          clearTimeout(timer);
          reject(new Error(data.message));
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        delete workers[kind];
        reject(new Error(event.message || "El worker del juez se detuvo."));
      };
      worker.postMessage(payload);
    },
  );
}

/**
 * Corre `code` con cada entrada. `compileError` llega con el texto del
 * compilador (C/C++) o el SyntaxError de Python, y entonces `runs` viene vacío.
 */
export async function execute(
  language: Language,
  code: string,
  inputs: string[],
  seconds: number,
  stage: Stage,
): Promise<{ runs: CaseRun[]; compileError?: string }> {
  const limitMs = seconds * 1000 * SLOWDOWN[language];
  if (language === "python")
    return runCases(
      "python",
      { code, inputs, limitMs },
      inputs.length,
      limitMs,
      stage,
    );
  const module = await compile(language, code, stage);
  if (typeof module === "string") return { runs: [], compileError: module };
  return runCases(
    "wasm",
    { module, inputs, limitMs },
    inputs.length,
    limitMs,
    stage,
  );
}

const tests = new Map<
  string,
  Promise<{ inputs: string[]; outputs: string[] }>
>();

/** Los 30 casos del problema (los mismos de los .zip), bajados al primer envío. */
export function testsOf(problem: Problem) {
  let pending = tests.get(problem.id);
  if (!pending) {
    pending = fetch(`/solo-tests/${problem.id}.json`).then((response) => {
      if (!response.ok)
        throw new Error(`No se pudieron bajar los casos (${response.status}).`);
      return response.json();
    });
    tests.set(problem.id, pending);
    pending.catch(() => tests.delete(problem.id));
  }
  return pending;
}

/** Compara como Codeforces: por palabras, sin importar espacios ni saltos de línea. */
export function sameOutput(actual: string, expected: string) {
  const a = actual.split(/\s+/).filter(Boolean);
  const b = expected.split(/\s+/).filter(Boolean);
  return a.length === b.length && a.every((word, index) => word === b[index]);
}

/** Veredicto de un caso: el de la ejecución, o Aceptado / Respuesta incorrecta. */
export function caseVerdict(run: CaseRun, expected: string) {
  if (run.verdict !== "ok") return run.verdict;
  return sameOutput(run.stdout, expected) ? "Accepted" : "Wrong Answer";
}

/** Envío: los 30 casos. Devuelve el primer veredicto que falla y cuántos pasaron. */
export async function judge(
  problem: Problem,
  language: Language,
  code: string,
  stage: Stage,
) {
  stage("Bajando los casos de prueba…");
  const { inputs, outputs } = await testsOf(problem);
  const { runs, compileError } = await execute(
    language,
    code,
    inputs,
    problem.seconds,
    stage,
  );
  if (compileError !== undefined)
    return {
      verdict:
        language === "python" ? "Runtime Error (NZEC)" : "Compilation Error",
      passed: 0,
      detail: compileError,
    };
  const verdicts = runs.map((run, index) =>
    caseVerdict(run, outputs[index] ?? ""),
  );
  const passed = verdicts.filter((verdict) => verdict === "Accepted").length;
  const failed = verdicts.findIndex((verdict) => verdict !== "Accepted");
  if (failed === -1) return { verdict: "accepted", passed, detail: "" };
  return {
    verdict: verdicts[failed] ?? "Wrong Answer",
    passed,
    detail: `Primer caso con error: el ${failed + 1}.${runs[failed]?.stderr ? `\n${runs[failed].stderr}` : ""}`,
  };
}
