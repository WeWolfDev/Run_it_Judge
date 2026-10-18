// Compilador de C y C++ de la demo: Clang/LLD compilados a WebAssembly (YoWASP),
// bajados de jsDelivr la primera vez (~23 MB, después quedan en la caché del
// navegador). Genera un programa WASI que corre wasm.worker.ts.

export {};

const CLANG = "https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/gen/bundle.js";

// libc++ no trae <bits/stdc++.h> (es de GCC): lo armamos con los headers de siempre.
const STDCPP = [
  "algorithm",
  "array",
  "bitset",
  "cassert",
  "cctype",
  "cfloat",
  "climits",
  "cmath",
  "cstdint",
  "cstdio",
  "cstdlib",
  "cstring",
  "deque",
  "functional",
  "iomanip",
  "iostream",
  "iterator",
  "limits",
  "list",
  "map",
  "numeric",
  "queue",
  "random",
  "set",
  "sstream",
  "stack",
  "string",
  "tuple",
  "unordered_map",
  "unordered_set",
  "utility",
  "vector",
  "chrono",
  "complex",
  "optional",
  "bit",
]
  .map((name) => `#include <${name}>`)
  .join("\n");

type CompileJob = { id: number; language: "c" | "cpp"; code: string };
// Lo poco que usamos de @yowasp/clang (sin instalar el paquete).
type Clang = {
  runClang: (
    args: string[],
    files: object,
    options: {
      stdout: null;
      stderr: (bytes: Uint8Array | null) => void;
      fetchProgress: (event: { totalLength: number; doneLength: number }) => void;
    },
  ) => Promise<Record<string, unknown>>;
};

let clang: Promise<Clang> | null = null;

self.onmessage = async ({ data }: MessageEvent<CompileJob>) => {
  const { id, language, code } = data;
  const post = (message: object) => self.postMessage({ id, ...message });
  try {
    clang ??= import(/* @vite-ignore */ CLANG) as Promise<Clang>;
    const { runClang } = await clang;
    const file = language === "c" ? "solution.c" : "solution.cpp";
    const args =
      language === "c"
        ? ["clang", "-O2", "-std=gnu17", file, "-lm"]
        : ["clang++", "-O2", "-std=gnu++17", "-fno-exceptions", "-I", "inc", file];
    let stderr = "";
    const decoder = new TextDecoder();
    const out = await runClang(
      // Pila de 32 MB: las soluciones recursivas no entran en los 64 KB por defecto.
      [...args, "-w", "-Wl,-z,stack-size=33554432", "-o", "solution.wasm"],
      { [file]: code, inc: { bits: { "stdc++.h": STDCPP } } },
      {
        stdout: null,
        stderr: (bytes) => {
          if (bytes) stderr += decoder.decode(bytes, { stream: true });
        },
        fetchProgress: ({ totalLength, doneLength }) =>
          post({ type: "download", done: doneLength, total: totalLength }),
      },
    ).catch((error: { files?: unknown }) => {
      if (error && "files" in error) return null; // Clang terminó con error: está en stderr.
      throw error;
    });
    const wasm = out?.["solution.wasm"];
    if (wasm instanceof Uint8Array) post({ type: "done", wasm });
    else post({ type: "error", stderr: stderr.trim() || "No se pudo compilar." });
  } catch (error) {
    clang = null;
    post({ type: "fail", message: String(error) });
  }
};
