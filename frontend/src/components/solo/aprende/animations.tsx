import { useEffect, useState, type ReactNode } from "react";

import type { AnimationId } from "./content";

// Animaciones de las lecciones: cada una es una lista de cuadros (lo que se ve y
// una explicación) que se recorre con Paso, Anterior o Auto. Sin bibliotecas:
// divs con los colores del tema.

type Frame = { view: ReactNode; caption: string };

export function LessonAnimation({ id }: { id: AnimationId }) {
  const frames = BUILDERS[id]();
  return <Stepper key={id} frames={frames} />;
}

function Stepper({ frames }: { frames: Frame[] }) {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const last = frames.length - 1;
  const frame = frames[Math.min(index, last)]!;

  useEffect(() => {
    if (!auto) return;
    if (index >= last) {
      setAuto(false);
      return;
    }
    const id = setTimeout(() => setIndex((i) => i + 1), 1400);
    return () => clearTimeout(id);
  }, [auto, index, last]);

  const button =
    "rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40";
  return (
    <div className="grid gap-3">
      <div className="min-h-[9rem] overflow-x-auto rounded-xl border border-border bg-background/60 p-4">
        {frame.view}
      </div>
      <p className="min-h-[2.5rem] text-sm text-foreground" aria-live="polite">
        {frame.caption}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          Anterior
        </button>
        <button
          type="button"
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
          onClick={() => setIndex((i) => Math.min(last, i + 1))}
          disabled={index === last}
        >
          Paso
        </button>
        <button
          type="button"
          className={button}
          onClick={() => {
            if (index === last) setIndex(0);
            setAuto((on) => !on);
          }}
        >
          {auto ? "Pausa" : "Auto"}
        </button>
        <button
          type="button"
          className={button}
          onClick={() => {
            setAuto(false);
            setIndex(0);
          }}
        >
          Reiniciar
        </button>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
          {index + 1} / {frames.length}
        </span>
      </div>
    </div>
  );
}

// ---------- Piezas ----------

type Tone = "idle" | "active" | "done" | "bad" | "dim";
const TONE: Record<Tone, string> = {
  idle: "border-border bg-card text-foreground",
  active: "border-primary bg-primary/20 text-foreground",
  done: "border-success bg-success-soft text-success",
  bad: "border-danger bg-danger-soft text-danger",
  dim: "border-border bg-card text-muted-foreground opacity-40",
};

function Cell({
  children,
  tone = "idle",
  label,
  above,
}: {
  children: ReactNode;
  tone?: Tone;
  label?: string | undefined;
  above?: string | undefined;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="h-4 font-mono text-[10px] text-primary">{above}</span>
      <div
        className={`grid h-10 min-w-10 place-items-center rounded-md border-2 px-2 font-mono text-sm transition-colors ${TONE[tone]}`}
      >
        {children}
      </div>
      <span className="h-4 font-mono text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-1.5">{children}</div>;
}

function Box({
  title,
  children,
  tone = "idle",
}: {
  title: string;
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`min-w-0 rounded-lg border-2 p-3 transition-colors ${TONE[tone]}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="mt-1 font-mono text-sm">{children}</div>
    </div>
  );
}

function Bar({
  label,
  value,
  max,
  tone = "active",
  note,
}: {
  label: string;
  value: number;
  max: number;
  tone?: Tone;
  note?: string;
}) {
  const width = Math.max(1, Math.min(100, (value / max) * 100));
  const color = tone === "bad" ? "bg-danger" : tone === "done" ? "bg-success" : "bg-primary";
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
      <span className="font-mono text-foreground">{label}</span>
      <div className="h-3 overflow-hidden rounded bg-muted">
        <div
          className={`h-full ${color} transition-[width] duration-500`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="font-mono tabular-nums text-muted-foreground">{note}</span>
    </div>
  );
}

// ---------- Animaciones ----------

function io(): Frame[] {
  const step = (k: number) => (
    <div className="grid gap-3 sm:grid-cols-3">
      <Box title="Entrada" tone={k === 0 ? "active" : "idle"}>
        <span className={k >= 1 ? "opacity-40" : ""}>2</span>{" "}
        <span className={k >= 2 ? "opacity-40" : ""}>3</span>
      </Box>
      <Box title="Tu programa" tone={k >= 1 && k <= 3 ? "active" : "idle"}>
        <div>a = {k >= 1 ? 2 : "?"}</div>
        <div>b = {k >= 2 ? 3 : "?"}</div>
        <div>a + b = {k >= 3 ? 5 : "?"}</div>
      </Box>
      <Box title="Salida" tone={k === 5 ? "done" : k === 4 ? "active" : "idle"}>
        {k >= 4 ? "5" : "—"}
        {k === 5 && <span className="ml-2 text-success">= esperada ✔</span>}
      </Box>
    </div>
  );
  return [
    { view: step(0), caption: "El juez le da a tu programa la entrada: «2 3»." },
    { view: step(1), caption: "cin >> a lee el primer número: a = 2." },
    { view: step(2), caption: "cin >> b lee el siguiente, sin importar el espacio: b = 3." },
    { view: step(3), caption: "El programa calcula a + b." },
    { view: step(4), caption: "cout << a + b escribe 5 en la salida." },
    { view: step(5), caption: "El juez compara tu salida con la esperada. Coinciden: Aceptado." },
  ];
}

function overflow(): Frame[] {
  const LIMIT = 2147483647;
  const gauge = (value: number, tone: Tone, label: string) => (
    <div className="grid gap-2">
      <Bar
        label={label}
        value={Math.abs(value)}
        max={2_600_000_000}
        tone={tone}
        note={value.toLocaleString("es")}
      />
      <Bar
        label="límite de int"
        value={LIMIT}
        max={2_600_000_000}
        tone="dim"
        note={LIMIT.toLocaleString("es")}
      />
    </div>
  );
  return [
    {
      view: gauge(50_000, "active", "a = 50 000"),
      caption: "int guarda hasta 2 147 483 647. 50 000 entra de sobra.",
    },
    {
      view: gauge(2_500_000_000, "bad", "a * a"),
      caption: "a * a = 2 500 000 000: se pasa del límite de int.",
    },
    {
      view: gauge(-1_794_967_296, "bad", "resultado int"),
      caption:
        "Overflow: el número «da la vuelta» y aparece -1 794 967 296. No hay error, solo una respuesta incorrecta.",
    },
    {
      view: gauge(2_500_000_000, "done", "1LL * a * a"),
      caption: "Con long long (1LL * a * a) el resultado es correcto: 2 500 000 000.",
    },
  ];
}

function decision(): Frame[] {
  const tree = (n: number | null, even: boolean | null) => (
    <div className="grid justify-items-center gap-3">
      <Box title="Entrada">{n ?? "n"}</Box>
      <Box title="Condición" tone={n === null ? "idle" : "active"}>
        n % 2 == 0 ?{" "}
        {n !== null && (
          <span className="text-muted-foreground">
            ({n} % 2 = {n % 2})
          </span>
        )}
      </Box>
      <div className="flex gap-6">
        <Cell tone={even === true ? "done" : even === false ? "dim" : "idle"} label="sí">
          PAR
        </Cell>
        <Cell tone={even === false ? "done" : even === true ? "dim" : "idle"} label="no">
          IMPAR
        </Cell>
      </div>
    </div>
  );
  return [
    { view: tree(null, null), caption: "El if evalúa una condición y elige un solo camino." },
    { view: tree(4, true), caption: "n = 4: 4 % 2 es 0, la condición es verdadera → PAR." },
    {
      view: tree(-7, false),
      caption: "n = -7: en C++, -7 % 2 vale -1 (no 1). Como no es 0 → IMPAR.",
    },
    {
      view: tree(0, true),
      caption: "Caso borde n = 0: 0 % 2 es 0 → PAR. Prueba siempre los bordes.",
    },
  ];
}

function loop(): Frame[] {
  const n = 5;
  const frames: Frame[] = [];
  for (let i = 0; i <= n + 1; i++) {
    const sum = (Math.min(i, n) * (Math.min(i, n) + 1)) / 2;
    frames.push({
      view: (
        <div className="grid gap-3">
          <Row>
            {Array.from({ length: n }, (_, k) => (
              <Cell
                key={k}
                tone={k + 1 < i ? "done" : k + 1 === i ? "active" : "idle"}
                above={k + 1 === i ? "i" : undefined}
              >
                {k + 1}
              </Cell>
            ))}
          </Row>
          <Box title="suma" tone={i > n ? "done" : "idle"}>
            {sum}
          </Box>
        </div>
      ),
      caption:
        i === 0
          ? "for (int i = 1; i <= 5; i++) suma += i; — la suma empieza en 0."
          : i <= n
            ? `Vuelta ${i}: i = ${i}, suma += ${i} → ${sum}.`
            : `i = 6 ya no cumple i <= 5: el bucle termina. Resultado: ${sum}.`,
    });
  }
  return frames;
}

function array(): Frame[] {
  const a = [3, 8, 1, 8, 2];
  const frames: Frame[] = [];
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    const before = best;
    if ((a[i] ?? 0) > (a[best] ?? 0)) best = i;
    const current = best;
    frames.push({
      view: (
        <Row>
          {a.map((v, k) => (
            <Cell
              key={k}
              tone={k === current ? "done" : k === i ? "active" : k < i ? "dim" : "idle"}
              above={k === i ? "i" : k === current ? "mejor" : undefined}
              label={`[${k}]`}
            >
              {v}
            </Cell>
          ))}
        </Row>
      ),
      caption:
        i === 0
          ? "Empezamos con a[0] = 3 como el mejor visto hasta ahora."
          : current !== before
            ? `a[${i}] = ${a[i]} es mayor que ${a[before]}: ahora el mejor está en la posición ${i}.`
            : `a[${i}] = ${a[i]} no supera a ${a[current]}${a[i] === a[current] ? " (empate: nos quedamos con la primera aparición)" : ""}.`,
    });
  }
  frames.push({
    view: frames[frames.length - 1]!.view,
    caption: `Fin: el máximo es ${a[best]}, en la posición ${best + 1} contando desde 1.`,
  });
  return frames;
}

function string(): Frame[] {
  const s = "reconocer";
  const frames: Frame[] = [];
  for (let i = 0; i <= Math.floor(s.length / 2); i++) {
    const j = s.length - 1 - i;
    const finished = i >= j;
    frames.push({
      view: (
        <Row>
          {[...s].map((c, k) => (
            <Cell
              key={k}
              tone={
                finished ? "done" : k === i || k === j ? "active" : k < i || k > j ? "done" : "idle"
              }
              above={!finished && k === i ? "i" : !finished && k === j ? "j" : undefined}
              label={String(k)}
            >
              {c}
            </Cell>
          ))}
        </Row>
      ),
      caption: finished
        ? "Los índices se cruzaron sin diferencias: «reconocer» es palíndromo."
        : `s[${i}] = '${s[i]}' y s[${j}] = '${s[j]}': ${s[i] === s[j] ? "iguales, seguimos hacia el centro." : "distintos, no es palíndromo."}`,
    });
  }
  return frames;
}

function stack(): Frame[] {
  const calls: [number, number][] = [];
  let a = 48;
  let b = 18;
  while (true) {
    calls.push([a, b]);
    if (b === 0) break;
    [a, b] = [b, a % b];
  }
  const result = calls[calls.length - 1]![0];
  const view = (depth: number, returning: boolean) => (
    <div className="flex flex-col-reverse gap-1.5">
      {calls.slice(0, depth).map(([x, y], k) => (
        <div
          key={k}
          className={`rounded-md border-2 px-3 py-1.5 font-mono text-sm ${k === depth - 1 ? (returning ? TONE.done : TONE.active) : TONE.idle}`}
        >
          mcd({x}, {y}){returning ? ` → ${result}` : ""}
        </div>
      ))}
    </div>
  );
  const frames: Frame[] = calls.map(([x, y], k) => ({
    view: view(k + 1, false),
    caption:
      y === 0
        ? `mcd(${x}, 0) = ${x}: caso base, deja de llamarse.`
        : `mcd(${x}, ${y}) llama a mcd(${y}, ${x} % ${y}) = mcd(${y}, ${x % y}). Se apila una llamada.`,
  }));
  for (let depth = calls.length; depth >= 1; depth--) {
    frames.push({
      view: view(depth, true),
      caption:
        depth === 1
          ? `La primera llamada devuelve ${result}: mcd(48, 18) = ${result}. La pila queda vacía.`
          : `La llamada de arriba devuelve ${result} y se quita de la pila.`,
    });
  }
  return frames;
}

function race(): Frame[] {
  const LIMIT = 1e8;
  const sizes = [10, 1_000, 50_000, 1_000_000];
  const fmt = (x: number) =>
    x >= 1e6
      ? `${(x / 1e6).toLocaleString("es", { maximumFractionDigits: 1 })} M`
      : Math.round(x).toLocaleString("es");
  const view = (n: number) => {
    const ops = [
      ["O(n)", n],
      ["O(n log n)", n * Math.log2(n)],
      ["O(n²)", n * n],
    ] as const;
    return (
      <div className="grid gap-2">
        <p className="font-mono text-xs text-muted-foreground">
          n = {n.toLocaleString("es")} · límite ≈ 10⁸ operaciones por segundo
        </p>
        {ops.map(([label, count]) => (
          <Bar
            key={label}
            label={label}
            value={Math.log10(Math.max(count, 1))}
            max={12}
            tone={count > LIMIT ? "bad" : "done"}
            note={`${fmt(count)}${count > LIMIT ? " · TLE" : ""}`}
          />
        ))}
      </div>
    );
  };
  return sizes.map((n) => ({
    view: view(n),
    caption:
      n <= 1000
        ? `Con n = ${n.toLocaleString("es")} todo termina al instante: cualquier solución pasa.`
        : n === 50_000
          ? "Con n = 50 000, O(n²) ya son 2 500 millones de operaciones: Tiempo excedido."
          : "Con n = 1 000 000 solo sobreviven O(n) y O(n log n). Por eso se piensa la complejidad antes de programar.",
  }));
}

function fastio(): Frame[] {
  const rows = [
    ["cin normal", 0.5],
    ["cin + sync off", 0.08],
    ["endl en cada línea", 0.9],
    ['"\\n"', 0.07],
  ] as const;
  const view = (shown: number) => (
    <div className="grid gap-2">
      <p className="font-mono text-xs text-muted-foreground">
        Leer y escribir 10⁶ números (tiempos de ejemplo, en segundos)
      </p>
      {rows.slice(0, shown).map(([label, seconds]) => (
        <Bar
          key={label}
          label={label}
          value={seconds}
          max={1}
          tone={seconds > 0.3 ? "bad" : "done"}
          note={`${seconds} s`}
        />
      ))}
    </div>
  );
  return [
    {
      view: view(1),
      caption: "Leer un millón de números con cin, tal cual, puede comerse medio segundo.",
    },
    {
      view: view(2),
      caption: "Con ios::sync_with_stdio(false) y cin.tie(nullptr), lo mismo tarda una fracción.",
    },
    {
      view: view(3),
      caption: "endl vacía la salida en cada línea: con muchas líneas es muy lento.",
    },
    {
      view: view(4),
      caption: 'Escribir "\\n" en su lugar es igual de correcto y mucho más rápido.',
    },
  ];
}

const BUILDERS: Record<AnimationId, () => Frame[]> = {
  io,
  overflow,
  decision,
  loop,
  array,
  string,
  stack,
  race,
  fastio,
};
