import { applyPixelCursor } from "@/lib/pixel-cursor";

// Paletas que cada usuario elige para sí (styles.css, :root[data-palette]); son
// la 1, 2, 5 y 12 de la propuesta. Solo cambian los colores de marca: los silks
// y los colores de estado no.
export const PALETTES = [
  { id: "arcade", name: "Arcade Neón" },
  { id: "synthwave", name: "Atardecer Synthwave" },
  { id: "dorada", name: "Ficha Dorada" },
  { id: "crt", name: "Pantalla CRT" },
] as const;

export const PALETTE_KEY = "run-it-palette";
const DEFAULT_PALETTE = "arcade";

const PALETTE_IDS: readonly string[] = PALETTES.map((palette) => palette.id);

// Un id guardado que ya no existe (las paletas anteriores) vuelve a la de siempre.
export function storedPalette() {
  try {
    const id = window.localStorage.getItem(PALETTE_KEY);
    return id && PALETTE_IDS.includes(id) ? id : DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

export function applyPalette(id: string) {
  document.documentElement.dataset["palette"] = id;
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
export const PALETTE_BOOT_SCRIPT = `try{var p=localStorage.getItem(${JSON.stringify(PALETTE_KEY)});if(${JSON.stringify(PALETTE_IDS)}.indexOf(p)<0)p=${JSON.stringify(DEFAULT_PALETTE)};document.documentElement.dataset.palette=p}catch(e){document.documentElement.dataset.palette=${JSON.stringify(DEFAULT_PALETTE)}}`;
