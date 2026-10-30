import { useState } from "react";

import type { Solved } from "./useProgress";

// Mapa de actividad: un cuadro por día de las últimas 26 semanas, más intenso
// cuantos más ejercicios se resolvieron ese día. Debajo, el total del periodo y
// las rachas.

const WEEKS = 26;
const DAY = 86_400_000;
/** Escala de un solo tono, de vacío a muchos ejercicios. */
const STEPS = ["#221d33", "#134e4a", "#0f766e", "#14b8a6", "#5eead4"];

const dayKey = (t: number) => new Date(t).toLocaleDateString("en-CA");

export function Activity({ solved }: { solved: Solved }) {
  const [hover, setHover] = useState<{ key: string; count: number; at: number } | null>(null);
  const counts = new Map<string, number>();
  for (const iso of Object.values(solved)) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) counts.set(dayKey(t), (counts.get(dayKey(t)) ?? 0) + 1);
  }

  // La última columna es la semana actual; las semanas empiezan en domingo.
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const first = today.getTime() - (today.getDay() + (WEEKS - 1) * 7) * DAY;
  const days = Array.from({ length: WEEKS * 7 }, (_, k) => first + k * DAY).filter(
    (t) => t <= today.getTime(),
  );

  const inPeriod = days.reduce((sum, t) => sum + (counts.get(dayKey(t)) ?? 0), 0);
  let best = 0;
  let run = 0;
  for (const t of days) {
    run = counts.has(dayKey(t)) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current = 0;
  for (let k = days.length - 1; k >= 0 && counts.has(dayKey(days[k]!)); k--) current++;

  const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);
  const months = days
    .map((t, k) => ({ t, col: Math.floor(k / 7) }))
    .filter(({ t }) => new Date(t).getDate() <= 7 && new Date(t).getDay() === 0);

  return (
    <div className="grid gap-3">
      {/* Las celdas se estiran para llenar el ancho de la tarjeta. */}
      <div className="relative pt-4">
        {months.map(({ t, col }) => (
          <span
            key={t}
            className="absolute top-0 text-[10px] text-muted-foreground"
            style={{ left: `${(col / WEEKS) * 100}%` }}
          >
            {new Date(t).toLocaleDateString("es-MX", { month: "short" })}
          </span>
        ))}
        <div
          className="grid grid-flow-col grid-rows-7 gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}
        >
          {days.map((t) => {
            const key = dayKey(t);
            const count = counts.get(key) ?? 0;
            return (
              <span
                key={key}
                className="aspect-square w-full rounded-[2px]"
                style={{ background: STEPS[level(count)] }}
                onMouseEnter={() => setHover({ key, count, at: t })}
                onMouseLeave={() => setHover(null)}
                title={`${new Date(t).toLocaleDateString("es-MX", { dateStyle: "medium" })}: ${count} ${count === 1 ? "ejercicio" : "ejercicios"}`}
              />
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p aria-live="polite">
          {hover
            ? `${new Date(hover.at).toLocaleDateString("es-MX", { dateStyle: "long" })}: ${hover.count} ${hover.count === 1 ? "ejercicio" : "ejercicios"}`
            : "Pasa el mouse por un día para ver cuántos resolviste."}
        </p>
        <p className="flex items-center gap-1">
          Menos
          {STEPS.map((c) => (
            <span key={c} className="h-3 w-3 rounded-[2px]" style={{ background: c }} />
          ))}
          Más
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-center">
        <Fig value={inPeriod} label="ejercicios en 6 meses" />
        <Fig value={best} label={best === 1 ? "día de racha máxima" : "días de racha máxima"} />
        <Fig
          value={current}
          label={current === 1 ? "día de racha actual" : "días de racha actual"}
        />
      </div>
    </div>
  );
}

function Fig({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="font-mono text-lg font-semibold tabular-nums text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
