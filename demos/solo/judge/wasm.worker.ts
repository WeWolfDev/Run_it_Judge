// Corre el programa que compiló compiler.worker.ts, caso por caso, con una WASI
// mínima: stdin desde la entrada del caso y stdout/stderr a memoria. Si un caso
// no termina, la página mata este worker (Tiempo excedido) y crea otro.

import { OUTPUT_LIMIT, type CaseRun } from "./protocol";

type RunJob = { module: WebAssembly.Module; inputs: string[]; limitMs: number };

class Exit {
  constructor(readonly code: number) {}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ERRNO = { SUCCESS: 0, BADF: 8, NOSYS: 52, SPIPE: 70 };

function runCase(
  module: WebAssembly.Module,
  input: string,
): Omit<CaseRun, "ms"> {
  const stdin = encoder.encode(input);
  let offset = 0;
  const out: Uint8Array[] = [];
  const err: Uint8Array[] = [];
  let outBytes = 0;
  let memory: WebAssembly.Memory;
  const view = () => new DataView(memory.buffer);

  const wasi: Record<string, (...args: never[]) => number> = {
    args_sizes_get: (argc: number, size: number) => {
      view().setUint32(argc, 0, true);
      view().setUint32(size, 0, true);
      return ERRNO.SUCCESS;
    },
    args_get: () => ERRNO.SUCCESS,
    environ_sizes_get: (count: number, size: number) => {
      view().setUint32(count, 0, true);
      view().setUint32(size, 0, true);
      return ERRNO.SUCCESS;
    },
    environ_get: () => ERRNO.SUCCESS,
    fd_close: () => ERRNO.SUCCESS,
    fd_seek: () => ERRNO.SPIPE,
    fd_prestat_get: () => ERRNO.BADF,
    fd_prestat_dir_name: () => ERRNO.BADF,
    fd_fdstat_get: (fd: number, stat: number) => {
      if (fd > 2) return ERRNO.BADF;
      const v = view();
      v.setUint8(stat, 2); // Dispositivo de caracteres.
      v.setUint16(stat + 2, 0, true);
      v.setBigUint64(stat + 8, 0xffffffffn, true);
      v.setBigUint64(stat + 16, 0xffffffffn, true);
      return ERRNO.SUCCESS;
    },
    fd_read: (fd: number, iovs: number, count: number, nread: number) => {
      if (fd !== 0) return ERRNO.BADF;
      const v = view();
      let total = 0;
      for (let i = 0; i < count; i++) {
        const ptr = v.getUint32(iovs + i * 8, true);
        const len = v.getUint32(iovs + i * 8 + 4, true);
        const chunk = stdin.subarray(offset, offset + len);
        new Uint8Array(memory.buffer, ptr, chunk.length).set(chunk);
        offset += chunk.length;
        total += chunk.length;
        if (chunk.length < len) break;
      }
      v.setUint32(nread, total, true);
      return ERRNO.SUCCESS;
    },
    fd_write: (fd: number, iovs: number, count: number, written: number) => {
      if (fd !== 1 && fd !== 2) return ERRNO.BADF;
      const v = view();
      let total = 0;
      for (let i = 0; i < count; i++) {
        const ptr = v.getUint32(iovs + i * 8, true);
        const len = v.getUint32(iovs + i * 8 + 4, true);
        const bytes = new Uint8Array(memory.buffer, ptr, len).slice();
        if (fd === 1) {
          outBytes += len;
          if (outBytes > OUTPUT_LIMIT) throw new Exit(-1);
          out.push(bytes);
        } else if (err.length < 64) err.push(bytes);
        total += len;
      }
      v.setUint32(written, total, true);
      return ERRNO.SUCCESS;
    },
    proc_exit: (code: number) => {
      throw new Exit(code);
    },
    clock_time_get: (_id: number, _precision: bigint, time: number) => {
      view().setBigUint64(
        time,
        BigInt(Math.round(performance.now() * 1e6)),
        true,
      );
      return ERRNO.SUCCESS;
    },
    random_get: (ptr: number, len: number) => {
      crypto.getRandomValues(new Uint8Array(memory.buffer, ptr, len));
      return ERRNO.SUCCESS;
    },
    sched_yield: () => ERRNO.SUCCESS,
  };
  // Lo que el programa importe y no esté arriba responde "no soportado".
  const imports = new Proxy(wasi, {
    get: (target, name: string) => target[name] ?? (() => ERRNO.NOSYS),
  });

  const text = (parts: Uint8Array[]) => decoder.decode(join(parts));
  let verdict = "ok";
  try {
    const instance = new WebAssembly.Instance(module, {
      wasi_snapshot_preview1: imports,
    });
    memory = instance.exports["memory"] as WebAssembly.Memory;
    (instance.exports["_start"] as () => void)();
  } catch (error) {
    if (error instanceof Exit) {
      if (error.code === -1) verdict = "Runtime Error (SIGXFSZ)";
      else if (error.code !== 0) verdict = "Runtime Error (NZEC)";
    } else verdict = trapVerdict(error);
  }
  return { verdict, stdout: text(out), stderr: text(err) };
}

function join(parts: Uint8Array[]) {
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

// Traducción de las trampas de WebAssembly a las señales que muestra Judge0.
function trapVerdict(error: unknown) {
  const message = String((error as Error)?.message ?? error);
  if (/divide by zero|integer overflow|remainder by zero/i.test(message))
    return "Runtime Error (SIGFPE)";
  if (/unreachable/i.test(message)) return "Runtime Error (SIGABRT)";
  if (/out of bounds|call stack|stack overflow/i.test(message))
    return "Runtime Error (SIGSEGV)";
  return "Runtime Error (Other)";
}

self.onmessage = ({ data }: MessageEvent<RunJob>) => {
  const { module, inputs, limitMs } = data;
  inputs.forEach((input, index) => {
    self.postMessage({ type: "start", index });
    const started = performance.now();
    const result = runCase(module, input);
    const ms = Math.round(performance.now() - started);
    const verdict =
      result.verdict === "ok" && ms > limitMs
        ? "Time Limit Exceeded"
        : result.verdict;
    self.postMessage({
      type: "case",
      index,
      result: { ...result, verdict, ms },
    });
  });
  self.postMessage({ type: "end" });
};
