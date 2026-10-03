import { useEffect, useRef } from "react";
import { characterAt, type SpriteAnim } from "@/lib/characters";

export type SpriteState = "idle" | "run" | "out";

// DEMO: un solo bucle de animación para todos los sprites de la página. Cada
// canvas guarda en dataset qué hoja y fila dibuja; el bucle solo redibuja
// cuando cambia el cuadro. Sin suavizado: el pixel art queda nítido.
const images = new Map<string, HTMLImageElement>();
function image(src: string) {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    images.set(src, img);
  }
  return img;
}

type Entry = { canvas: HTMLCanvasElement; anim: SpriteAnim; fw: number; fh: number; t0: number; last: string };
const entries = new Set<Entry>();
let running = false;
const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function loop(now: number) {
  entries.forEach((entry) => {
    const { anim, canvas, fw, fh } = entry;
    const img = image(anim.sheet);
    if (!img.complete || !img.naturalWidth) return;
    let frame = Math.floor(((now - entry.t0) * anim.fps) / 1000);
    frame = anim.once ? Math.min(frame, anim.frames - 1) : reduced() ? 0 : frame % anim.frames;
    const key = `${anim.sheet}:${anim.row}:${frame}`;
    if (key === entry.last) return;
    entry.last = key;
    const cols = Math.round(img.naturalWidth / fw);
    const index = (anim.col0 ?? 0) + frame;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, fw, fh);
    context.drawImage(img, (index % cols) * fw, (anim.row + Math.floor(index / cols)) * fh, fw, fh, 0, 0, fw, fh);
  });
  if (entries.size) requestAnimationFrame(loop);
  else running = false;
}

/**
 * Personaje animado. `scale` multiplica la escala entera del personaje (1 = la
 * natural); se redondea para no perder nitidez. Sin animación de derrota, el
 * estado "out" lo muestra quieto y en gris.
 */
export function Sprite({
  index,
  state = "idle",
  scale = 1,
  className = "",
}: {
  index: number;
  state?: SpriteState;
  scale?: number;
  className?: string;
}) {
  const character = characterAt(index);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const factor = Math.max(1, Math.round(character.scale * scale));
  const grey = state === "out" && !character.anims?.out;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !character.anims) return;
    const anim = (state === "out" ? character.anims.out : character.anims[state]) ?? character.anims.idle;
    const entry: Entry = { canvas, anim, fw: character.fw, fh: character.fh, t0: performance.now(), last: "" };
    entries.add(entry);
    if (!running) {
      running = true;
      requestAnimationFrame(loop);
    }
    return () => {
      entries.delete(entry);
    };
  }, [character, state]);

  const style = {
    width: character.fw * factor,
    height: character.fh * factor,
    imageRendering: "pixelated" as const,
    filter: grey ? "grayscale(1) brightness(0.6)" : undefined,
  };

  if (character.gif) {
    const gifFactor = Math.max(1, Math.round(character.gif.scale * scale));
    return (
      <img
        src={state === "run" ? character.gif.run : character.gif.idle}
        alt=""
        aria-hidden="true"
        className={`object-contain object-bottom ${className}`}
        // El GIF puede venir ya ampliado (231 px = arte de 33 px × 7): se mide
        // al cargar y se muestra a un múltiplo entero del arte original.
        onLoad={(event) => {
          const img = event.currentTarget;
          const upscale = Math.max(1, Math.round(img.naturalWidth / character.gif!.width));
          img.style.width = `${(img.naturalWidth / upscale) * gifFactor}px`;
          img.style.height = `${(img.naturalHeight / upscale) * gifFactor}px`;
        }}
        style={{
          width: character.gif.width * gifFactor,
          height: character.gif.height * gifFactor,
          imageRendering: "pixelated",
          filter: state === "out" ? "grayscale(1) brightness(0.6)" : undefined,
        }}
      />
    );
  }
  return (
    <canvas
      ref={canvasRef}
      width={character.fw}
      height={character.fh}
      aria-hidden="true"
      className={className}
      style={style}
    />
  );
}

export default Sprite;
