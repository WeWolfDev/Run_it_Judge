import JSZip from "jszip";

export interface ParsedTestCase {
  stdin: string;
  expected: string;
}

type FileRole = "input" | "output";

interface Candidate {
  role: FileRole;
  // Menor número = mayor prioridad cuando hay varios archivos para el mismo caso.
  priority: number;
  entry: JSZip.JSZipObject;
}

// Extensiones reconocidas, en orden de prioridad:
// a) pares explícitos (.in con .out o .ans), c) sufijos de salida (.a, .answer, .expected).
const EXTENSION_ROLES: Record<string, { role: FileRole; priority: number }> = {
  in: { role: "input", priority: 0 },
  out: { role: "output", priority: 0 },
  ans: { role: "output", priority: 1 },
  a: { role: "output", priority: 3 },
  answer: { role: "output", priority: 3 },
  expected: { role: "output", priority: 3 },
};

// b) Archivos sin extensión. Es entrada, salvo que viva en una carpeta de salidas
// (por ejemplo input/1 + output/1).
const OUTPUT_DIRECTORY = /(^|\/)[^/]*(out|ans|expected)[^/]*\//i;

function classify(
  path: string,
  entry: JSZip.JSZipObject,
): { key: string; candidate: Candidate } | null {
  const segments = path.split("/");
  const fileName = segments[segments.length - 1];
  if (!fileName || segments.some((segment) => segment.startsWith("."))) return null;

  const dot = fileName.lastIndexOf(".");
  if (dot === -1) {
    const role: FileRole = OUTPUT_DIRECTORY.test(path) ? "output" : "input";
    return { key: fileName, candidate: { role, priority: 2, entry } };
  }

  const known = EXTENSION_ROLES[fileName.slice(dot + 1).toLowerCase()];
  if (!known || dot === 0) return null;
  return { key: fileName.slice(0, dot), candidate: { ...known, entry } };
}

function pickBest(candidates: Candidate[], role: FileRole): Candidate | undefined {
  return candidates
    .filter((candidate) => candidate.role === role)
    .sort((a, b) => a.priority - b.priority)[0];
}

export async function parseCodeforcesZip(file: File): Promise<ParsedTestCase[]> {
  // Si no es un zip o está corrupto, JSZip rechaza y el error se propaga.
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const groups = new Map<string, Candidate[]>();
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const classified = classify(path, entry);
    if (!classified) return;
    const group = groups.get(classified.key) ?? [];
    group.push(classified.candidate);
    groups.set(classified.key, group);
  });

  const pairs: Array<{ key: string; input: JSZip.JSZipObject; output: JSZip.JSZipObject }> = [];
  for (const [key, candidates] of groups) {
    const input = pickBest(candidates, "input");
    const output = pickBest(candidates, "output");
    if (input && output) pairs.push({ key, input: input.entry, output: output.entry });
  }

  if (pairs.length === 0) {
    throw new Error(
      "El .zip no tiene pares de casos válidos. Se esperan pares tipo 1.in/1.out o 1.in/1.ans.",
    );
  }

  // Orden numérico: el caso 2 va antes que el 10.
  pairs.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));

  // El contenido se guarda tal cual, con su salto de línea final.
  return Promise.all(
    pairs.map(async (pair) => ({
      stdin: await pair.input.async("string"),
      expected: await pair.output.async("string"),
    })),
  );
}
