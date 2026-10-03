// Fondos del login (components/LoginBackdrop.tsx) y cuál toca en cada visita.
export type BackdropId = "arcade" | "neon" | "space";

const BACKDROPS: BackdropId[] = ["arcade", "neon", "space"];
const BACKDROP_KEY = "run-it-login-backdrop";

// Cada vez que alguien entra al login le toca un fondo al azar, distinto del de
// la vez anterior en ese navegador. Usa localStorage: llamarla solo en el cliente.
export function nextBackdrop(): BackdropId {
  let last: string | null = null;
  try {
    last = window.localStorage.getItem(BACKDROP_KEY);
  } catch {
    // Sin almacenamiento cualquiera sirve.
  }
  const options = BACKDROPS.filter((id) => id !== last);
  const pick = options[Math.floor(Math.random() * options.length)] ?? "arcade";
  try {
    window.localStorage.setItem(BACKDROP_KEY, pick);
  } catch {
    // Sin almacenamiento la próxima vez puede repetirse.
  }
  return pick;
}
