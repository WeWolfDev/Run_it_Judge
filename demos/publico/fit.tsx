import { useEffect, useState } from "react";

import { Sprite, type SpriteState } from "@/components/Sprite";
import { CHARACTERS } from "@/lib/characters";

// DEMO: personajes del mismo tamaño visible en todas las vistas. Muchas hojas
// dejan mucho margen transparente alrededor del dibujo; se mide el primer cuadro
// quieto una vez y se ajusta la escala (la misma idea que la pista proyectada).

type Bounds = { height: number; bottom: number };
const bounds = new Map<number, Bounds | "loading">();
const listeners = new Set<() => void>();

function measure(index: number) {
  const character = CHARACTERS[index];
  const anim = character?.anims?.idle;
  if (!character || !anim || bounds.has(index)) return;
  bounds.set(index, "loading");
  const img = new Image();
  img.onload = () => {
    const { fw, fh } = character;
    const cols = Math.max(1, Math.floor(img.naturalWidth / fw));
    const frame = anim.col0 ?? 0;
    const canvas = document.createElement("canvas");
    canvas.width = fw;
    canvas.height = fh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, (frame % cols) * fw, (anim.row + Math.floor(frame / cols)) * fh, fw, fh, 0, 0, fw, fh);
    const alpha = ctx.getImageData(0, 0, fw, fh).data;
    let top = fh;
    let last = -1;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        if (alpha[(y * fw + x) * 4 + 3]! > 0) {
          top = Math.min(top, y);
          last = y;
          break;
        }
      }
    }
    bounds.set(index, last < 0 ? { height: fh, bottom: 0 } : { height: last - top + 1, bottom: fh - 1 - last });
    listeners.forEach((listener) => listener());
  };
  img.src = anim.sheet;
}

/** Vuelve a dibujar cuando termina de medir a los personajes pedidos. */
export function useSpriteBounds(indexes: number[]) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  indexes.forEach(measure);
}

/** Escala entera de Sprite, ajuste fino con zoom y margen de abajo para apoyarlo. */
export function spriteFit(index: number, room: number) {
  const character = CHARACTERS[index];
  if (!character) return { scale: 1, zoom: 1, lift: 0 };
  const [visible, own] = character.gif
    ? [{ height: character.gif.height * 0.8, bottom: 0 }, character.gif.scale]
    : [
        (() => {
          const measured = bounds.get(index);
          return measured && measured !== "loading" ? measured : { height: character.fh * 0.6, bottom: 0 };
        })(),
        character.scale,
      ];
  const total = room / visible.height;
  const factor = Math.max(1, Math.round(total));
  return { scale: factor / own, zoom: total / factor, lift: visible.bottom * total };
}

/**
 * Personaje en una casilla de ancho fijo, con los pies en el borde de abajo.
 * `room` es la altura visible del dibujo en px.
 */
export function Figure({
  index,
  room,
  state = "idle",
  flip = false,
  speed,
  className = "",
}: {
  index: number;
  room: number;
  state?: SpriteState;
  flip?: boolean;
  speed?: number;
  className?: string;
}) {
  const fit = spriteFit(index, room);
  return (
    <span className={`flex shrink-0 items-end justify-center ${className}`} style={{ width: room * 1.05, height: room * 1.1 }}>
      <span
        className="pub-sprite block"
        style={{ marginBottom: -fit.lift, transform: `scale(${flip ? -fit.zoom : fit.zoom}, ${fit.zoom})` }}
      >
        <Sprite index={index} state={state} scale={fit.scale} {...(speed ? { speed } : {})} />
      </span>
    </span>
  );
}
