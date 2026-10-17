// Python de la demo: Pyodide (CPython compilado a WebAssembly), bajado de
// jsDelivr la primera vez (~10 MB). Corre la solución caso por caso con stdin y
// stdout propios. Si un caso no termina, la página mata este worker.

import { OUTPUT_LIMIT } from "./protocol";

const PYODIDE = "https://cdn.jsdelivr.net/npm/pyodide@0.29.5/";

type RunJob = { code: string; inputs: string[]; limitMs: number };
// Lo poco que usamos de Pyodide (sin instalar el paquete).
type PyCallable = ((...args: unknown[]) => { toJs: () => unknown }) & {
  destroy?: () => void;
};
type Pyodide = {
  runPython: (code: string) => unknown;
  globals: { get: (name: string) => PyCallable };
};
type PyodideModule = {
  loadPyodide: (options: { indexURL: string }) => Promise<Pyodide>;
};

// Cada caso corre en un módulo __main__ nuevo, con sys.stdin y sys.stdout en
// memoria (texto y .buffer, como en Codeforces).
const RUNNER = `
import sys, io, traceback

def __run_it_case(source, data):
    out = io.BytesIO()
    sys.stdin = io.TextIOWrapper(io.BytesIO(data.encode()), encoding="utf-8")
    stdout = io.TextIOWrapper(out, encoding="utf-8", write_through=True)
    sys.stdout = stdout
    err = io.StringIO()
    sys.stderr = err
    status = "ok"
    try:
        exec(source, {"__name__": "__main__", "__builtins__": __builtins__})
    except SystemExit as stop:
        if stop.code not in (None, 0):
            status = "Runtime Error (NZEC)"
    except MemoryError:
        status = "Runtime Error (Other)"
    except RecursionError:
        traceback.print_exc()
        status = "Runtime Error (SIGSEGV)"
    except BaseException:
        traceback.print_exc()
        status = "Runtime Error (NZEC)"
    # Se lee antes de soltar el TextIOWrapper: al recolectarlo cierra el BytesIO.
    try:
        stdout.flush()
        text = out.getvalue().decode("utf-8", "replace")
    except ValueError:
        text = ""
    sys.stdin, sys.stdout, sys.stderr = sys.__stdin__, sys.__stdout__, sys.__stderr__
    return status, text, err.getvalue()[-4000:]

def __run_it_compile(code):
    try:
        return compile(code, "solution.py", "exec"), ""
    except SyntaxError:
        return None, traceback.format_exc(limit=0)
`;

let pyodide: Promise<Pyodide> | null = null;

function load() {
  pyodide ??= (async () => {
    const { loadPyodide } = (await import(
      /* @vite-ignore */ `${PYODIDE}pyodide.mjs`
    )) as PyodideModule;
    const py = await loadPyodide({ indexURL: PYODIDE });
    py.runPython(RUNNER);
    return py;
  })();
  return pyodide;
}

self.onmessage = async ({ data }: MessageEvent<RunJob>) => {
  try {
    self.postMessage({ type: "loading" });
    const py = await load();
    const [source, error] = py.globals
      .get("__run_it_compile")(data.code)
      .toJs() as [unknown, string];
    if (!source) {
      self.postMessage({ type: "compile", stderr: error.trim() });
      return;
    }
    const run = py.globals.get("__run_it_case");
    data.inputs.forEach((input, index) => {
      self.postMessage({ type: "start", index });
      const started = performance.now();
      const [verdict, stdout, stderr] = run(source, input).toJs() as [
        string,
        string,
        string,
      ];
      const ms = Math.round(performance.now() - started);
      const tooSlow = verdict === "ok" && ms > data.limitMs;
      self.postMessage({
        type: "case",
        index,
        result: {
          verdict:
            stdout.length > OUTPUT_LIMIT
              ? "Runtime Error (SIGXFSZ)"
              : tooSlow
                ? "Time Limit Exceeded"
                : verdict,
          stdout: stdout.slice(0, OUTPUT_LIMIT),
          stderr,
          ms,
        },
      });
    });
    self.postMessage({ type: "end" });
  } catch (error) {
    pyodide = null;
    self.postMessage({ type: "fail", message: String(error) });
  }
};
