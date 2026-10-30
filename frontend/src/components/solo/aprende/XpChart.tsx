import { useEffect, useRef, useState } from "react";

import { Sprite } from "@/components/Sprite";

import { ALL_EXERCISES, TOTAL_POINTS } from "./content";
import { TIERS, tierOf } from "./rank";
import type { Solved } from "./useProgress";

// Historial de XP con estética de arcade: una línea de neón escalonada que sube
// con cada ejercicio resuelto, sobre una cuadrícula oscura. Los rangos son
// marcas a la derecha y el personaje del jugador está parado en su XP de hoy.
// Pasar el mouse por un punto muestra el ejercicio y el total.

const DAY = 86_400_000;
const NEON = "#2dd4bf";

type Point = { at: number; total: number; name: string; gained: number };

function pointsOf(solved: Solved): Point[] {
  const byId = new Map(ALL_EXERCISES.map((e) => [e.id, e]));
  let total = 0;
  return Object.entries(solved)
    .map(([id, iso]) => ({ e: byId.get(id), at: Date.parse(iso) }))
    .filter((p): p is { e: NonNullable<typeof p.e>; at: number } => !!p.e && !Number.isNaN(p.at))
    .sort((a, b) => a.at - b.at)
    .map(({ e, at }) => {
      total += e.points;
      return { at, total, name: e.name, gained: e.points };
    });
}

const fmt = (t: number) =>
  new Date(t).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

/** Ancho real del contenedor: la gráfica se dibuja a esa medida y el texto no se encoge. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function XpChart({ solved, character }: { solved: Solved; character: number | null }) {
  const points = pointsOf(solved);
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  // En pantallas angostas los rangos quedan como cuadros sin nombre.
  const wide = W >= 560;
  const H = Math.round(Math.min(300, Math.max(220, W * 0.38)));
  const PAD = { left: 36, right: wide ? 168 : 22, top: 22, bottom: 28 };

  const now = Date.now();
  // Sin ejercicios la gráfica se dibuja igual, plana en 0, con un aviso encima.
  const total = points[points.length - 1]?.total ?? 0;
  const start = Math.min((points[0]?.at ?? now) - DAY / 2, now - 6 * DAY);
  const end = Math.max(now, points[points.length - 1]?.at ?? now);
  const top = Math.max(TOTAL_POINTS, total);
  const right = W - PAD.right;
  const x = (t: number) => PAD.left + ((t - start) / (end - start)) * (right - PAD.left);
  const y = (v: number) => H - PAD.bottom - (v / top) * (H - PAD.top - PAD.bottom);

  // Línea escalonada: plano hasta el siguiente envío y luego sube.
  let line = `M${x(start)},${y(0)}`;
  for (const p of points) line += ` H${x(p.at)} V${y(p.total)}`;
  line += ` H${x(now)}`;
  const area = `${line} V${y(0)} H${x(start)} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => start + f * (end - start));
  const columns = Array.from({ length: 13 }, (_, k) => PAD.left + (k / 12) * (right - PAD.left));
  const active = hover === null ? null : points[hover]!;
  const current = tierOf(total);

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-lg border border-[#2a1f45] bg-[#0b0613]"
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Historial de XP: ${points.length} ejercicios, ${total} XP en total`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="xp-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={NEON} stopOpacity="0.35" />
            <stop offset="100%" stopColor={NEON} stopOpacity="0" />
          </linearGradient>
          <filter id="xp-glow" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Cuadrícula de fondo */}
        {columns.map((cx) => (
          <line key={cx} x1={cx} x2={cx} y1={PAD.top} y2={y(0)} stroke="#2a1f45" strokeWidth="1" />
        ))}

        {/* Rangos: una raya fina en su umbral y su marca a la derecha. */}
        {TIERS.filter((t) => t.min <= top).map((tier) => {
          const mine = tier.name === current.name;
          const ty = y(tier.min);
          return (
            <g key={tier.name}>
              <line
                x1={PAD.left}
                x2={right}
                y1={ty}
                y2={ty}
                stroke={tier.color}
                strokeOpacity={mine ? 0.55 : 0.22}
                strokeDasharray="2 6"
              />
              <text
                x={PAD.left - 8}
                y={ty + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--muted-foreground)"
              >
                {tier.min}
              </text>
              <rect
                x={right + (wide ? 12 : 6)}
                y={ty - 5}
                width="10"
                height="10"
                fill={tier.color}
                opacity={mine ? 1 : 0.6}
              />
              {wide && (
                <text
                  x={right + 30}
                  y={ty + 4}
                  fontSize="12"
                  fontWeight={mine ? 700 : 400}
                  fill={mine ? "var(--foreground)" : "var(--muted-foreground)"}
                >
                  {mine ? `▸ ${tier.name}` : tier.name}
                </text>
              )}
            </g>
          );
        })}

        {ticks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H - 9}
            textAnchor="middle"
            fontSize="11"
            fill="var(--muted-foreground)"
          >
            {fmt(t)}
          </text>
        ))}

        <path d={area} fill="url(#xp-area)" />
        <path
          d={line}
          fill="none"
          stroke={NEON}
          strokeWidth="3"
          strokeLinejoin="miter"
          filter="url(#xp-glow)"
        />
        {points.map((p, k) => {
          const size = hover === k ? 14 : 10;
          return (
            <g key={k}>
              <rect
                x={x(p.at) - size / 2}
                y={y(p.total) - size / 2}
                width={size}
                height={size}
                fill={tierOf(p.total).color}
                stroke="#0b0613"
                strokeWidth="2"
              />
              {/* Zona de toque más grande que el punto */}
              <rect
                x={x(p.at) - 12}
                y={y(p.total) - 12}
                width="24"
                height="24"
                fill="transparent"
                onMouseEnter={() => setHover(k)}
                onFocus={() => setHover(k)}
                tabIndex={0}
                aria-label={`${fmt(p.at)}: ${p.name}, +${p.gained} XP, total ${p.total}`}
              />
            </g>
          );
        })}
      </svg>

      {/* El jugador, parado en su XP de hoy. */}
      {character !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
          style={{ left: `${(x(now) / W) * 100}%`, top: `${(y(total) / H) * 100}%` }}
        >
          <Sprite index={character} state="idle" scale={0.4} />
        </div>
      )}

      {points.length === 0 && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center">
          <span className="rounded-md border border-[#3b2d5c] bg-[#120a20] px-3 py-2 text-sm text-muted-foreground">
            Resuelve tu primer ejercicio del mapa para encender tu historial.
          </span>
        </p>
      )}

      {active && (
        <div
          className={`pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap rounded-md border bg-[#120a20] px-2.5 py-1.5 text-xs shadow-lg ${
            x(active.at) / W > 0.6
              ? "-translate-x-full"
              : x(active.at) / W < 0.25
                ? ""
                : "-translate-x-1/2"
          }`}
          style={{
            left: `${(x(active.at) / W) * 100}%`,
            top: `${(y(active.total) / H) * 100 - 4}%`,
            borderColor: tierOf(active.total).color,
          }}
        >
          <p className="font-medium text-foreground">{active.name}</p>
          <p className="text-muted-foreground">
            {fmt(active.at)} · +{active.gained} XP ·{" "}
            <span className="font-mono text-foreground">{active.total} XP</span> ·{" "}
            <span style={{ color: tierOf(active.total).color }}>{tierOf(active.total).name}</span>
          </p>
        </div>
      )}
    </div>
  );
}
