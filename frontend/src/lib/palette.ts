import { applyPixelCursor } from "@/lib/pixel-cursor";

// Paletas que cada usuario elige para sí (styles.css, :root[data-palette]).
// Solo cambian los colores de marca: los silks y los colores de estado no.
export const PALETTES = [
  { id: "arcade", name: "Arcade Neón" },
  { id: "marquesina", name: "Marquesina" },
  { id: "lavanda", name: "Lavanda Koala" },
  { id: "", name: "Original" },
] as const;

export const PALETTE_KEY = "run-it-palette";
const DEFAULT_PALETTE = "arcade";

export function storedPalette() {
  try {
    return window.localStorage.getItem(PALETTE_KEY) ?? DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

export function applyPalette(id: string) {
  if (id) document.documentElement.dataset["palette"] = id;
  else delete document.documentElement.dataset["palette"];
  try {
    window.localStorage.setItem(PALETTE_KEY, id);
  } catch {
    // Sin almacenamiento la paleta dura hasta recargar.
  }
  // El cursor se dibuja con los colores nuevos una vez que el CSS los aplicó.
  requestAnimationFrame(applyPixelCursor);
}

// Se ejecuta en el <head>, antes del primer pintado: el HTML del SSR no conoce
// la preferencia y sin esto se vería un instante la paleta por defecto.
export const PALETTE_BOOT_SCRIPT = `try{var p=localStorage.getItem(${JSON.stringify(PALETTE_KEY)});if(p===null)p=${JSON.stringify(DEFAULT_PALETTE)};if(p)document.documentElement.dataset.palette=p}catch(e){document.documentElement.dataset.palette=${JSON.stringify(DEFAULT_PALETTE)}}`;
