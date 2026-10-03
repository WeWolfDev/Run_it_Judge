import { useEffect, useRef, useState } from "react";

// DEMO: fondos animados del login.
// - "arcade": dibujado por código en un canvas (synthwave, aliens y nave propios).
// - "neon" y "space": capas CC0 de ansimuz (public/backdrops/LICENSE.txt) con
//   parallax: cada capa se repite y corre a su velocidad, las de atrás más lento.

type Layer = { src: string; w: number; h: number; seconds: number };
type Drifter = {
  src: string;
  w: number;
  h: number;
  top: number;
  seconds: number;
  delay: number;
  bob?: boolean;
};
type LayeredId = "neon" | "space";
export type BackdropId = "arcade" | LayeredId | "original";

const LAYERED: Record<
  LayeredId,
  { base: number; fill: string; layers: Layer[]; drifters: Drifter[] }
> = {
  neon: {
    base: 240,
    fill: "#0b0a23",
    layers: [
      { src: "/backdrops/neon/sky.png", w: 128, h: 240, seconds: 120 },
      { src: "/backdrops/neon/far.png", w: 144, h: 124, seconds: 60 },
      { src: "/backdrops/neon/near.png", w: 493, h: 209, seconds: 28 },
    ],
    drifters: [
      { src: "/backdrops/neon/car-red.png", w: 96, h: 61, top: 6, seconds: 14, delay: -3, bob: true },
      { src: "/backdrops/neon/car-police.png", w: 163, h: 60, top: 30, seconds: 11, delay: -9, bob: true },
      { src: "/backdrops/neon/car-yellow.png", w: 93, h: 60, top: 18, seconds: 19, delay: -14, bob: true },
    ],
  },
  space: {
    base: 160,
    fill: "#120a14",
    layers: [
      { src: "/backdrops/space/bg.png", w: 272, h: 160, seconds: 0 },
      { src: "/backdrops/space/stars.png", w: 272, h: 160, seconds: 70 },
      { src: "/backdrops/space/far.png", w: 272, h: 160, seconds: 40 },
    ],
    drifters: [
      { src: "/backdrops/space/ring.png", w: 51, h: 115, top: 20, seconds: 55, delay: -20 },
      { src: "/backdrops/space/big.png", w: 88, h: 87, top: 50, seconds: 80, delay: -55 },
    ],
  },
};

export const BACKDROP_OPTIONS: Array<{ id: BackdropId; name: string }> = [
  { id: "arcade", name: "Fondo: arcade retro" },
  { id: "neon", name: "Fondo: ciudad neón" },
  { id: "space", name: "Fondo: espacio" },
  { id: "original", name: "Fondo: imagen fija" },
];

// Escala entera (píxeles nítidos) que cubre el alto disponible.
function useScale(base: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: 3, width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      const height = entry?.contentRect.height ?? base * 3;
      setSize({ scale: Math.max(1, Math.ceil(height / base)), width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [base]);
  return [ref, size] as const;
}

export function Backdrop({ id }: { id: Exclude<BackdropId, "original"> }) {
  return id === "arcade" ? <ArcadeBackdrop /> : <LayeredBackdrop id={id} />;
}

function LayeredBackdrop({ id }: { id: LayeredId }) {
  const backdrop = LAYERED[id];
  const [ref, { scale }] = useScale(backdrop.base);
  return (
    <div
      ref={ref}
      aria-hidden
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor: backdrop.fill }}
    >
      {backdrop.layers.map((layer) => (
        <div
          key={layer.src}
          className="login-backdrop-layer absolute inset-x-0 bottom-0 [image-rendering:pixelated]"
          style={
            {
              height: layer.h * scale,
              backgroundImage: `url(${layer.src})`,
              backgroundSize: `${layer.w * scale}px ${layer.h * scale}px`,
              "--tile": `${-layer.w * scale}px`,
              animationDuration: layer.seconds ? `${layer.seconds}s` : undefined,
              animationName: layer.seconds ? "login-backdrop-scroll" : "none",
            } as React.CSSProperties
          }
        />
      ))}
      {backdrop.drifters.map((d) => (
        <div
          key={d.src}
          className="login-backdrop-drift absolute"
          style={{ top: `${d.top}%`, animationDuration: `${d.seconds}s`, animationDelay: `${d.delay}s` }}
        >
          <img
            src={d.src}
            alt=""
            className={d.bob ? "login-backdrop-bob [image-rendering:pixelated]" : "[image-rendering:pixelated]"}
            style={{ width: d.w * scale, height: d.h * scale, maxWidth: "none" }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------- Arcade retro: todo dibujado en un canvas de baja resolución ----------

// Aliens y nave propios, 2 cuadros cada alien. "X" = píxel pintado.
const ALIENS = [
  [
    ["..X..X..", "...XX...", ".XXXXXX.", "XX.XX.XX", "XXXXXXXX", ".X....X."],
    ["..X..X..", "X..XX..X", "XXXXXXXX", "XX.XX.XX", ".XXXXXX.", "X......X"],
  ],
  [
    ["...XX...", "..XXXX..", ".X.XX.X.", "XXXXXXXX", "..X..X..", ".X.XX.X."],
    ["...XX...", "..XXXX..", ".X.XX.X.", "XXXXXXXX", ".X.XX.X.", "X......X"],
  ],
];
const SHIP = ["...X...", "..XXX..", ".XXXXX.", "XXXXXXX", "X.X.X.X"];
const BASE_H = 180;

function sprite(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number) {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] === "X") ctx.fillRect(Math.round(x) + dx, Math.round(y) + dy, 1, 1);
    }
  });
}

type RGB = [number, number, number];

// Color de la paleta activa en RGB: se pinta un píxel y se lee, así sirve
// cualquier formato (oklch, lab…) que entienda el navegador.
function paletteRGB(name: string, fallback: RGB): RGB {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx || !value) return fallback;
  ctx.fillStyle = `rgb(${fallback.join(",")})`;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b2 = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b2];
}

const mix = (a: RGB, b: RGB, t: number) =>
  `rgb(${a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * t)).join(",")})`;
const NIGHT: RGB = [11, 6, 19];
const GOLD: RGB = [255, 211, 77];

function ArcadeBackdrop() {
  const [ref, { scale, width, height }] = useScale(BASE_H);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !width || !height) return;
    const W = Math.ceil(width / scale);
    const H = Math.ceil(height / scale);
    canvas.width = W;
    canvas.height = H;
    const pri = paletteRGB("--primary", [226, 85, 159]);
    const acc = paletteRGB("--accent", [111, 216, 232]);
    const priCss = mix(pri, pri, 0);
    const accCss = mix(acc, acc, 0);
    const horizon = Math.round(H * 0.58);
    const stars = Array.from({ length: Math.round((W * horizon) / 90) }, () => ({
      x: Math.floor(Math.random() * W),
      y: Math.floor(Math.random() * (horizon - 4)),
      phase: Math.random() * Math.PI * 2,
    }));
    const COLS = Math.max(3, Math.min(7, Math.floor(W / 26)));
    let fleetX = 8;
    let dir = 1;
    let step = 0;
    let shipX = W / 2;
    let shipTarget = W / 2;
    const shots: Array<{ x: number; y: number }> = [];
    const booms: Array<{ x: number; y: number; t: number }> = [];
    const dead = new Set<string>();
    let frame = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      frame++;
      // Cielo en bandas (sin degradado suave: estilo 8 bits).
      const bands = 7;
      for (let i = 0; i < bands; i++) {
        ctx.fillStyle = mix(NIGHT, pri, (i / bands) * 0.55);
        ctx.fillRect(0, Math.floor((horizon * i) / bands), W, Math.ceil(horizon / bands) + 1);
      }
      ctx.fillStyle = "#fff";
      for (const s of stars) {
        if (Math.sin(frame / 12 + s.phase) > -0.3) ctx.fillRect(s.x, s.y, 1, 1);
      }
      // Sol con franjas que bajan.
      const r = Math.round(H * 0.17);
      const cx = Math.round(W / 2);
      const cy = horizon - 2;
      for (let y = -r; y <= 0; y++) {
        const half = Math.floor(Math.sqrt(r * r - y * y));
        const gap = (y + r + Math.floor(frame / 4)) % 7;
        if (y > -r * 0.45 && gap < 2) continue;
        ctx.fillStyle = mix(GOLD, pri, ((y + r) / r) * 0.8);
        ctx.fillRect(cx - half, cy + y, half * 2, 1);
      }
      // Suelo y grilla en perspectiva que avanza.
      ctx.fillStyle = "#0b0613";
      ctx.fillRect(0, horizon, W, H - horizon);
      ctx.fillStyle = accCss;
      ctx.fillRect(0, horizon, W, 1);
      const depth = H - horizon;
      const offset = (frame % 16) / 16;
      for (let i = 0; i < 12; i++) {
        const t = (i + offset) / 12;
        const y = horizon + Math.round(depth * t * t);
        ctx.fillRect(0, y, W, 1);
      }
      // Verticales: arrancan unos píxeles bajo el horizonte para no amontonarse.
      for (let i = -6; i <= 6; i++) {
        const xb = cx + i * (W / 4);
        // Se rellena el tramo entre filas para que la diagonal quede continua.
        let prev = Math.round(cx + (xb - cx) * (3 / depth));
        for (let y = horizon + 3; y < H; y++) {
          const x = Math.round(cx + (xb - cx) * ((y - horizon) / depth));
          ctx.fillRect(Math.min(prev, x), y, Math.abs(x - prev) + 1, 1);
          prev = x;
        }
      }
      // Flota de aliens: avanza a saltos y rebota en los bordes.
      if (frame % 10 === 0) {
        step = 1 - step;
        fleetX += dir * 2;
        if (fleetX < 2 || fleetX + COLS * 13 > W - 2) dir = -dir;
      }
      const targets: Array<{ x: number; y: number; key: string }> = [];
      for (let row = 0; row < 2; row++) {
        ctx.fillStyle = row === 0 ? accCss : priCss;
        for (let col = 0; col < COLS; col++) {
          const key = `${row}-${col}`;
          if (dead.has(key)) continue;
          const x = fleetX + col * 13;
          const y = 6 + row * 10;
          sprite(ctx, ALIENS[row]![step]!, x, y);
          targets.push({ x, y, key });
        }
      }
      if (dead.size >= COLS * 2) dead.clear();
      // Nave: se mueve hacia un objetivo y dispara.
      if (frame % 50 === 0 && targets.length) {
        shipTarget = targets[Math.floor(Math.random() * targets.length)]!.x + 4;
      }
      shipX += Math.sign(shipTarget - shipX) * Math.min(1, Math.abs(shipTarget - shipX));
      if (frame % 24 === 0) shots.push({ x: Math.round(shipX), y: horizon - 12 });
      ctx.fillStyle = "#fff";
      sprite(ctx, SHIP, shipX - 3, horizon - 8);
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i]!;
        s.y -= 3;
        ctx.fillStyle = "#ffd34d";
        ctx.fillRect(s.x, s.y, 1, 3);
        const hit = targets.find((t) => s.x >= t.x && s.x < t.x + 8 && s.y >= t.y && s.y < t.y + 6);
        if (hit) {
          dead.add(hit.key);
          booms.push({ x: hit.x + 4, y: hit.y + 3, t: 0 });
          shots.splice(i, 1);
        } else if (s.y < 0) shots.splice(i, 1);
      }
      // Explosiones: chispas que se abren y se apagan.
      ctx.fillStyle = "#fff";
      for (let i = booms.length - 1; i >= 0; i--) {
        const b = booms[i]!;
        b.t++;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          ctx.fillRect(Math.round(b.x + Math.cos(a) * b.t), Math.round(b.y + Math.sin(a) * b.t), 1, 1);
        }
        if (b.t > 6) booms.splice(i, 1);
      }
    };

    draw();
    if (reduced) return;
    // ~20 cuadros por segundo: movimiento a saltos, como un arcade.
    const id = window.setInterval(() => {
      if (!document.hidden) draw();
    }, 50);
    return () => window.clearInterval(id);
  }, [scale, width, height]);

  return (
    <div ref={ref} aria-hidden className="absolute inset-0 overflow-hidden bg-[#0b0613]">
      <canvas
        ref={canvasRef}
        className="absolute left-0 top-0 [image-rendering:pixelated]"
        style={{ width: Math.ceil(width / scale) * scale, height: Math.ceil(height / scale) * scale }}
      />
    </div>
  );
}
