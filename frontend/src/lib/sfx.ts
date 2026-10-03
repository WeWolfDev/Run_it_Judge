// Efectos de sonido 8-bit con ZzFX (src/lib/zzfx.ts). Arrancan apagados; la
// preferencia queda en el navegador de cada usuario.
import { setAudioContext, zzfx } from "@/lib/zzfx";

let context: AudioContext | null = null;
const _ = undefined;

export type SoundName = "click" | "coin" | "win" | "over" | "tick" | "error";

// Parámetros de ZzFX; `_` deja el valor por defecto de esa posición.
const SFX: Record<SoundName, Array<number | undefined>> = {
  click: [_, _, 537, 0.02, 0.02, 0.22, 1, 1.59, -6.98, 4.97],
  coin: [1.5, _, 1675, _, 0.06, 0.24, 1, 1.82, _, _, 837, 0.06],
  win: [1.2, _, 523, 0.02, 0.25, 0.45, 1, 1.5, _, _, 262, 0.08, 0.1],
  over: [1.4, _, 180, 0.04, 0.3, 0.6, 2, 0.4, -2, _, _, _, 0.15, _, _, 0.2],
  tick: [0.5, _, 880, _, 0.01, 0.03, 1],
  error: [1, _, 150, 0.02, 0.08, 0.15, 3, 0.5, _, _, _, _, _, 0.4],
};
const KEY = "run-it-sound";
const listeners = new Set<() => void>();

export function soundOn() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* sin almacenamiento */
  }
  listeners.forEach((listener) => listener());
  if (on) play("click");
}

export function onSoundChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function play(name: SoundName) {
  if (!soundOn()) return;
  try {
    if (!context) {
      context = new AudioContext();
      setAudioContext(context);
    }
    void context.resume();
    zzfx(...SFX[name]);
  } catch {
    /* sin audio */
  }
}
