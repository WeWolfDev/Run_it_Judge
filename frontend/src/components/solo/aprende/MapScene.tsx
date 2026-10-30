import { memo, type ReactElement } from "react";

// Fondo del mapa de mundos en pixel art, en el mismo lienzo de 1000 × 760 que
// WorldMap (W y H de allá): cielo arcade con estrellas, horizonte synthwave y tres islas
// flotantes, cada una con el tema de su mundo (placa de circuito, cristales de
// datos y fortaleza del jefe), unidas por la pista de carreras.

const MAP_W = 1000;
const MAP_H = 760;
const P = 12; // tamaño del "pixel" de las islas

type Island = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  top: string;
  light: string;
  side: string;
  deep: string;
  seed: number;
};

const ISLANDS = {
  fundamentos: {
    cx: 310,
    cy: 505,
    rx: 300,
    ry: 235,
    top: "#0f3d33",
    light: "#145244",
    side: "#0a2a24",
    deep: "#061a17",
    seed: 3,
  },
  algoritmos: {
    cx: 770,
    cy: 500,
    rx: 205,
    ry: 160,
    top: "#2a2466",
    light: "#352d80",
    side: "#1c1747",
    deep: "#110e2c",
    seed: 7,
  },
  jefe: {
    cx: 775,
    cy: 175,
    rx: 150,
    ry: 105,
    top: "#4a1230",
    light: "#5c1a3c",
    side: "#300a1f",
    deep: "#1d0613",
    seed: 11,
  },
} satisfies Record<string, Island>;

/** Ruido determinista para que el borde de las islas no sea un óvalo perfecto. */
function noise(x: number, y: number, seed: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function cellsOf(island: Island) {
  const cells = new Set<string>();
  const { cx, cy, rx, ry, seed } = island;
  for (let y = cy - ry - P; y <= cy + ry + P; y += P) {
    for (let x = cx - rx - P; x <= cx + rx + P; x += P) {
      const gx = Math.round(x / P);
      const gy = Math.round(y / P);
      const d = ((gx * P - cx) / rx) ** 2 + ((gy * P - cy) / ry) ** 2;
      // Borde irregular: entre 0.86 y 1.04 según el ruido.
      if (d <= 0.86 + noise(gx >> 1, gy >> 1, seed) * 0.18) cells.add(`${gx},${gy}`);
    }
  }
  return cells;
}

function IslandShape({ island }: { island: Island }) {
  const cells = cellsOf(island);
  const tops: ReactElement[] = [];
  const sides: ReactElement[] = [];
  for (const key of cells) {
    const [gx, gy] = key.split(",").map(Number) as [number, number];
    const x = gx * P;
    const y = gy * P;
    const checker = noise(gx, gy, island.seed + 1) > 0.82;
    tops.push(
      <rect
        key={key}
        x={x}
        y={y}
        width={P}
        height={P}
        fill={checker ? island.light : island.top}
      />,
    );
    // Cara lateral: tres filas bajo cada celda del borde de abajo.
    if (!cells.has(`${gx},${gy + 1}`)) {
      for (let k = 1; k <= 3; k++) {
        sides.push(
          <rect
            key={`${key}:${k}`}
            x={x}
            y={y + k * P}
            width={P}
            height={P}
            fill={k === 1 ? island.side : island.deep}
          />,
        );
      }
    }
  }
  return (
    <g shapeRendering="crispEdges">
      <ellipse
        cx={island.cx}
        cy={island.cy + island.ry + 70}
        rx={island.rx * 0.8}
        ry={18}
        fill="black"
        opacity="0.35"
      />
      {sides}
      {tops}
    </g>
  );
}

/** Pistas de circuito impreso y chips sobre la isla de Fundamentos. */
function CircuitDecor() {
  const traces = [
    "M60 560 H160 V600 H230",
    "M90 470 H200 V420",
    "M420 650 V590 H520",
    "M380 470 H440 V430 H560",
    "M150 380 V330 H260",
    "M300 690 H380",
  ];
  const chips: [number, number][] = [
    [520, 600],
    [168, 410],
    [270, 330],
    [560, 430],
  ];
  return (
    <g shapeRendering="crispEdges" opacity="0.55">
      {traces.map((d) => (
        <path key={d} d={d} fill="none" stroke="#34d399" strokeWidth="4" opacity="0.45" />
      ))}
      {chips.map(([x, y]) => (
        <g key={`${x},${y}`}>
          <rect
            x={x - 14}
            y={y - 10}
            width="28"
            height="20"
            fill="#062016"
            stroke="#34d399"
            strokeWidth="2"
          />
          {[-8, 0, 8].map((dx) => (
            <rect key={dx} x={x + dx - 2} y={y - 16} width="4" height="6" fill="#34d399" />
          ))}
        </g>
      ))}
    </g>
  );
}

/** Cristales de datos sobre la isla de Algoritmos. */
function CrystalDecor() {
  const crystals: [number, number, number][] = [
    [640, 420, 1],
    [700, 610, 0.8],
    [905, 520, 1.1],
    [740, 400, 0.7],
    [860, 610, 0.9],
  ];
  return (
    <g shapeRendering="crispEdges">
      {crystals.map(([x, y, s]) => (
        <g key={`${x},${y}`} transform={`translate(${x} ${y}) scale(${s})`} opacity="0.85">
          <path d="M0 -26 L10 -8 L6 10 H-6 L-10 -8 Z" fill="#7c6cff" />
          <path d="M0 -26 L10 -8 L0 -2 Z" fill="#b4a9ff" />
          <path d="M-6 10 H6 L4 14 H-4 Z" fill="#3b2f99" />
        </g>
      ))}
    </g>
  );
}

/** Fortaleza del jefe final con grietas de lava. */
function FortressDecor() {
  return (
    <g shapeRendering="crispEdges">
      <path
        d="M680 230 H720 V210 M840 220 H880 V240"
        stroke="#f97316"
        strokeWidth="4"
        fill="none"
        opacity="0.6"
      />
      <g fill="#1d0613" opacity="0.9">
        <rect x="726" y="112" width="98" height="58" />
        {[0, 1, 2, 3, 4].map((k) => (
          <rect key={k} x={726 + k * 22} y="102" width="12" height="12" />
        ))}
        <rect x="712" y="92" width="22" height="78" />
        <rect x="816" y="92" width="22" height="78" />
        <rect x="712" y="82" width="8" height="10" />
        <rect x="830" y="82" width="8" height="10" />
      </g>
      <rect x="722" y="58" width="3" height="34" fill="#c4b5fd" />
      <path d="M725 58 h18 l-6 6 l6 6 h-18 z" fill="var(--primary)" />
    </g>
  );
}

function Sky() {
  const bands = ["#07040d", "#0a0614", "#0d081b", "#120a22", "#170c29", "#1d0e2f"];
  return (
    <g shapeRendering="crispEdges">
      {bands.map((color, k) => (
        <rect key={color} x="0" y={k * 90} width={MAP_W} height="92" fill={color} />
      ))}
      <rect x="0" y="540" width={MAP_W} height="220" fill="#1d0e2f" />
      {Array.from({ length: 70 }, (_, k) => {
        const x = (k * 137 + 41) % MAP_W;
        const y = (k * 71 + 13) % 520;
        const size = k % 9 === 0 ? 4 : 2;
        return (
          <rect
            key={k}
            x={x}
            y={y}
            width={size}
            height={size}
            fill="white"
            opacity={0.25 + (k % 5) * 0.12}
          />
        );
      })}
      {/* Luna pixel */}
      <g transform="translate(70 60)">
        <rect x="8" y="0" width="32" height="48" fill="#f5e9ff" opacity="0.85" />
        <rect x="0" y="8" width="48" height="32" fill="#f5e9ff" opacity="0.85" />
        <rect x="22" y="2" width="22" height="44" fill="#07040d" opacity="0.9" />
      </g>
    </g>
  );
}

/** Horizonte synthwave: la cuadrícula del gabinete arcade, abajo del mapa. */
function Horizon() {
  const top = 600;
  const lines = Array.from({ length: 6 }, (_, k) => top + (k * k + k) * 5.5);
  return (
    <g opacity="0.35">
      {lines.map((y) => (
        <line key={y} x1="0" x2={MAP_W} y1={y} y2={y} stroke="var(--accent)" strokeWidth="2" />
      ))}
      {Array.from({ length: 21 }, (_, k) => {
        const x = k * 50;
        return (
          <line
            key={x}
            x1={MAP_W / 2 + (x - MAP_W / 2) * 0.25}
            y1={top}
            x2={MAP_W / 2 + (x - MAP_W / 2) * 2.2}
            y2={MAP_H}
            stroke="var(--accent)"
            strokeWidth="2"
          />
        );
      })}
    </g>
  );
}

/** Bandera a cuadros de salida o meta. */
export function CheckeredFlag({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} shapeRendering="crispEdges">
      <rect x="0" y="-40" width="3" height="44" fill="#e5e7eb" />
      {[0, 1, 2].map((r) =>
        [0, 1, 2, 3].map((c) => (
          <rect
            key={`${r}${c}`}
            x={3 + c * 6}
            y={-40 + r * 6}
            width="6"
            height="6"
            fill={(r + c) % 2 === 0 ? "#f9fafb" : "#111827"}
          />
        )),
      )}
    </g>
  );
}

/** Pista de carreras que une las paradas: asfalto, borde y línea central. */
export function Track({
  points,
  progress,
  dim = false,
}: {
  points: [number, number][];
  /** Cuántas paradas desde el inicio ya están recorridas (se pintan de color). */
  progress: number;
  dim?: boolean;
}) {
  const all = points.map(([x, y]) => `${x},${y}`).join(" ");
  const done = points
    .slice(0, Math.max(0, progress))
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
  return (
    <g opacity={dim ? 0.45 : 1} strokeLinejoin="round" strokeLinecap="round" fill="none">
      <polyline points={all} stroke="#05030a" strokeWidth="30" />
      <polyline points={all} stroke={dim ? "#2b2640" : "#2a2440"} strokeWidth="22" />
      <polyline
        points={all}
        stroke="#f5f3ff"
        strokeWidth="3"
        strokeDasharray="14 14"
        opacity="0.5"
      />
      {progress > 1 && (
        <polyline points={done} stroke="#5eead4" strokeWidth="5" strokeDasharray="14 14" />
      )}
    </g>
  );
}

export const MapBackdrop = memo(function MapBackdrop() {
  return (
    <>
      <Sky />
      <Horizon />
      <IslandShape island={ISLANDS.jefe} />
      <IslandShape island={ISLANDS.algoritmos} />
      <IslandShape island={ISLANDS.fundamentos} />
      <CircuitDecor />
      <CrystalDecor />
      <FortressDecor />
    </>
  );
});
