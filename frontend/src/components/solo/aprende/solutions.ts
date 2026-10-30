// Soluciones de referencia y generadores de casos de los ejercicios del mapa
// (mundo Principiante). Sin imports: también lo corre scripts/aprende-tests.ts
// con Node para escribir public/solo-tests/<id>.json. Al cambiar un generador,
// volver a correr `npm run aprende:tests` y commitear los JSON.

export type Spec = {
  id: string;
  /** Ejemplos del enunciado: son los primeros casos del JSON. */
  samples: string[];
  /** Salida esperada para una entrada (también da la de los ejemplos). */
  solve: (input: string) => string;
  /** Entradas de prueba (sin los ejemplos, que van primero). */
  tests: (rand: Rand) => string[];
};

export type Rand = {
  int: (min: number, max: number) => number;
  word: (min: number, max: number, letters?: string) => string;
};

const nums = (input: string) => input.split(/\s+/).filter(Boolean);
const big = (input: string) => nums(input).map((n) => BigInt(n));
const list = (values: (number | bigint | string)[]) => values.join(" ");
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

function isPrime(x: number) {
  if (x < 2) return false;
  for (let d = 2; d * d <= x; d++) if (x % d === 0) return false;
  return true;
}

function gcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : gcd(b, a % b);
}

/** Arreglo de n enteros en [min, max], como "n\na1 a2 ...". */
function arrayInput(rand: Rand, n: number, min: number, max: number) {
  return `${n}\n${list(Array.from({ length: n }, () => rand.int(min, max)))}\n`;
}

export const SPECS: Spec[] = [
  {
    id: "ini-saludo",
    samples: ["Ana\n", "Leonardo\n"],
    solve: (i) => `Hola, ${nums(i)[0] ?? ""}!`,
    tests: (r) => [
      "A\n",
      "Run\n",
      ...Array.from(
        { length: 8 },
        () => `${r.word(1, 1, "ABCDEFGHIJKLMNOPQRSTUVWXYZ")}${r.word(1, 19)}\n`,
      ),
    ],
  },
  {
    id: "ini-suma",
    samples: ["2 3\n", "-7 10\n"],
    solve: (i) => String(big(i).reduce((a, b) => a + b, 0n)),
    tests: (r) => [
      "0 0\n",
      "-1000000 -1000000\n",
      "1000000 -1000000\n",
      ...Array.from(
        { length: 7 },
        () => `${r.int(-1_000_000, 1_000_000)} ${r.int(-1_000_000, 1_000_000)}\n`,
      ),
    ],
  },
  {
    id: "ini-producto",
    samples: ["3 4\n", "1000000000 1000000000\n"],
    solve: (i) => {
      const [a = 0n, b = 0n] = big(i);
      return String(a * b);
    },
    tests: (r) => [
      "1 1\n",
      "100000 100000\n",
      "999999999 1000000000\n",
      ...Array.from({ length: 7 }, () => `${r.int(1, 1_000_000_000)} ${r.int(1, 1_000_000_000)}\n`),
    ],
  },
  {
    id: "ini-tiempo",
    samples: ["125\n", "3600\n"],
    solve: (i) => {
      const s = Number(nums(i)[0] ?? 0);
      return `${Math.floor(s / 60)} ${s % 60}`;
    },
    tests: (r) => [
      "0\n",
      "59\n",
      "60\n",
      "1000000000\n",
      ...Array.from({ length: 6 }, () => `${r.int(0, 1_000_000_000)}\n`),
    ],
  },
  {
    id: "ini-paridad",
    samples: ["4\n", "-7\n"],
    solve: (i) => (BigInt(nums(i)[0] ?? 0) % 2n === 0n ? "PAR" : "IMPAR"),
    tests: (r) => [
      "0\n",
      "-1\n",
      "-4\n",
      "-999999999\n",
      "1000000000\n",
      ...Array.from({ length: 5 }, () => `${r.int(-1_000_000_000, 1_000_000_000)}\n`),
    ],
  },
  {
    id: "ini-mayor",
    samples: ["3 9 4\n", "-5 -2 -8\n"],
    solve: (i) => String(big(i).reduce((a, b) => (b > a ? b : a))),
    tests: (r) => [
      "5 5 5\n",
      "-1 -2 -3\n",
      "-1000000000 0 -1000000000\n",
      ...Array.from(
        { length: 7 },
        () => `${list(Array.from({ length: 3 }, () => r.int(-1_000_000_000, 1_000_000_000)))}\n`,
      ),
    ],
  },
  {
    id: "ini-suma-n",
    samples: ["3\n", "100\n"],
    solve: (i) => {
      const n = BigInt(nums(i)[0] ?? 0);
      return String((n * (n + 1n)) / 2n);
    },
    tests: (r) => [
      "1\n",
      "2\n",
      "65536\n",
      "1000000\n",
      ...Array.from({ length: 6 }, () => `${r.int(1, 1_000_000)}\n`),
    ],
  },
  {
    id: "ini-tabla",
    samples: ["7\n", "12\n"],
    solve: (i) => {
      const n = Number(nums(i)[0] ?? 0);
      return Array.from({ length: 10 }, (_, k) => `${n} x ${k + 1} = ${n * (k + 1)}`).join("\n");
    },
    tests: (r) => ["1\n", "1000\n", ...Array.from({ length: 6 }, () => `${r.int(1, 1000)}\n`)],
  },
  {
    id: "ini-maximo",
    samples: ["5\n3 8 1 8 2\n", "3\n-4 -1 -9\n"],
    solve: (i) => {
      const [, ...a] = big(i);
      let best = 0;
      a.forEach((v, k) => {
        if (v > (a[best] ?? v)) best = k;
      });
      return `${a[best] ?? 0} ${best + 1}`;
    },
    tests: (r) => [
      "1\n-5\n",
      "4\n7 7 7 7\n",
      "5\n-1000000000 -1000000000 -999999999 -1000000000 -999999999\n",
      arrayInput(r, 50_000, -1_000_000_000, 1_000_000_000),
      ...Array.from({ length: 6 }, () =>
        arrayInput(r, r.int(1, 1000), -1_000_000_000, 1_000_000_000),
      ),
    ],
  },
  {
    id: "ini-invertir",
    samples: ["4\n1 2 3 4\n", "3\n-5 0 5\n"],
    solve: (i) => list(nums(i).slice(1).reverse()),
    tests: (r) => [
      "1\n42\n",
      "2\n-1 1\n",
      arrayInput(r, 50_000, -1_000_000_000, 1_000_000_000),
      ...Array.from({ length: 6 }, () =>
        arrayInput(r, r.int(1, 1000), -1_000_000_000, 1_000_000_000),
      ),
    ],
  },
  {
    id: "ini-vocales",
    samples: ["programacion\n", "xyz\n"],
    solve: (i) => String([...(nums(i)[0] ?? "")].filter((c) => VOWELS.has(c)).length),
    tests: (r) => [
      "a\n",
      "rhythm\n",
      "aeiouaeiou\n",
      `${r.word(100_000, 100_000)}\n`,
      ...Array.from({ length: 6 }, () => `${r.word(1, 1000)}\n`),
    ],
  },
  {
    id: "ini-palindromo",
    samples: ["reconocer\n", "codigo\n"],
    solve: (i) => {
      const s = nums(i)[0] ?? "";
      return [...s].reverse().join("") === s ? "SI" : "NO";
    },
    tests: (r) => {
      const pal = (half: string, odd: boolean) =>
        half + (odd ? r.word(1, 1) : "") + [...half].reverse().join("");
      return [
        "a\n",
        "ab\n",
        "abca\n",
        `${pal(r.word(50_000, 50_000), false)}\n`,
        `${pal(r.word(49_999, 49_999), true)}\n`,
        ...Array.from({ length: 3 }, () => `${pal(r.word(1, 500), r.int(0, 1) === 1)}\n`),
        ...Array.from({ length: 3 }, () => `${r.word(2, 1000)}\n`),
      ];
    },
  },
  {
    id: "ini-mcd",
    samples: ["12 18\n", "7 13\n"],
    solve: (i) => {
      const [a = 1n, b = 1n] = big(i);
      return String(gcd(a, b));
    },
    tests: (r) => [
      "1 1\n",
      "1000000000 1000000000\n",
      "999999937 2\n",
      "735134400 963761198\n",
      ...Array.from({ length: 6 }, () => {
        const g = r.int(1, 1000);
        return `${g * r.int(1, 1_000_000)} ${g * r.int(1, 1_000_000)}\n`;
      }),
    ],
  },
  {
    id: "ini-primos",
    samples: ["4\n2 9 17 1\n", "2\n97 100\n"],
    solve: (i) => {
      const [, ...xs] = nums(i).map(Number);
      return xs.map((x) => (isPrime(x) ? "SI" : "NO")).join("\n");
    },
    tests: (r) => [
      "5\n1 2 3 4 9999991\n",
      `1000\n${list(Array.from({ length: 1000 }, () => r.int(9_000_000, 10_000_000)))}\n`,
      `1000\n${list(Array.from({ length: 1000 }, () => 9_999_991))}\n`,
      ...Array.from({ length: 5 }, () => {
        const q = r.int(1, 100);
        return `${q}\n${list(Array.from({ length: q }, () => r.int(1, 10_000_000)))}\n`;
      }),
    ],
  },
  {
    id: "ini-pares",
    samples: ["4\n1 2 3 4\n", "3\n5 7 9\n"],
    solve: (i) => {
      const [, ...a] = nums(i).map(Number);
      const even = BigInt(a.filter((v) => v % 2 === 0).length);
      const odd = BigInt(a.length) - even;
      return String((even * (even - 1n)) / 2n + (odd * (odd - 1n)) / 2n);
    },
    tests: (r) => [
      "1\n7\n",
      "3\n2 2 2\n",
      arrayInput(r, 50_000, 1, 1_000_000_000),
      `50000\n${list(Array.from({ length: 50_000 }, () => 2))}\n`,
      ...Array.from({ length: 5 }, () => arrayInput(r, r.int(1, 1000), 1, 1_000_000_000)),
    ],
  },
  {
    id: "ini-distintos",
    samples: ["6\n4 1 4 2 1 4\n", "3\n10 20 30\n"],
    solve: (i) => String(new Set(nums(i).slice(1)).size),
    tests: (r) => [
      "1\n1\n",
      "5\n1000000 1000000 1000000 1000000 1000000\n",
      arrayInput(r, 50_000, 1, 1_000_000),
      arrayInput(r, 50_000, 1, 50),
      ...Array.from({ length: 5 }, () => arrayInput(r, r.int(1, 1000), 1, 1_000_000)),
    ],
  },
  {
    id: "ini-entrada-grande",
    samples: ["3\n1 2 3\n", "2\n1000000000 1000000000\n"],
    solve: (i) =>
      String(
        big(i)
          .slice(1)
          .reduce((a, b) => a + b, 0n),
      ),
    tests: (r) => [
      "1\n-1000000000\n",
      `100000\n${list(Array.from({ length: 100_000 }, () => 1_000_000_000))}\n`,
      arrayInput(r, 100_000, -1_000_000_000, 1_000_000_000),
      ...Array.from({ length: 4 }, () =>
        arrayInput(r, r.int(1, 1000), -1_000_000_000, 1_000_000_000),
      ),
    ],
  },
];
