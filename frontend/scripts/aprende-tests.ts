// Genera public/solo-tests/<id>.json de los ejercicios del mapa (solutions.ts):
// primero los ejemplos y después los casos de cada generador, con su salida
// esperada. Semilla fija por ejercicio: correrlo de nuevo da los mismos casos.
//   npm run aprende:tests
import { writeFileSync } from "node:fs";

import { SPECS, type Rand } from "../src/components/solo/aprende/solutions.ts";

const OUT = new URL("../public/solo-tests/", import.meta.url);

function seeded(text: string): Rand {
  let seed = [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const word = (min: number, max: number, letters = "abcdefghijklmnopqrstuvwxyz") =>
    Array.from({ length: int(min, max) }, () => letters[int(0, letters.length - 1)]).join("");
  return { int, word };
}

for (const spec of SPECS) {
  const inputs = [...spec.samples, ...spec.tests(seeded(spec.id))];
  const outputs = inputs.map((input) => `${spec.solve(input)}\n`);
  writeFileSync(new URL(`${spec.id}.json`, OUT), JSON.stringify({ inputs, outputs }));
  const kb = Math.round(JSON.stringify({ inputs, outputs }).length / 1024);
  console.log(`${spec.id}: ${inputs.length} casos, ${kb} KB`);
}
