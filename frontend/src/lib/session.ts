export type UserRole = "admin" | "participant";

export interface Session {
  username: string;
  role: UserRole;
  token?: string;
}

const SESSION_KEY = "run-it-session";
// Las claves del personaje van por nombre de usuario. Desde que username dejó de
// ser único, dos "Ana" en el MISMO navegador comparten personaje y la segunda
// no ve el carrusel. Es una consecuencia aceptada: pasar a la clave por id pide
// guardar el id en la sesión (login.tsx), y migrar la clave vieja al id en el
// login le daría a la segunda "Ana" el personaje de la primera igual. El
// personaje que cuenta es participants.character, que el servidor fija por
// torneo en la primera inscripción. Quien ya eligió conserva su personaje.
const CHARACTER_KEY_PREFIX = "run-it-character:";
// Clave aparte: el personaje guardado no alcanza para saber si ya eligió,
// porque 0 (ausente) y 0 (eligió Aurora) son el mismo valor.
const CHARACTER_CONFIRMED_KEY_PREFIX = "run-it-character-confirmed:";
export const CHARACTER_COUNT = 3;

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(SESSION_KEY);
    return value ? (JSON.parse(value) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(session: Session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export function getSessionToken() {
  return getSession()?.token;
}

export function getSelectedCharacter(username: string) {
  if (typeof window === "undefined") return 0;

  const stored = window.localStorage.getItem(`${CHARACTER_KEY_PREFIX}${username}`);
  const character = Number(stored);
  return Number.isInteger(character) && character >= 0 && character < CHARACTER_COUNT
    ? character
    : 0;
}

export function setSelectedCharacter(username: string, character: number) {
  window.localStorage.setItem(`${CHARACTER_KEY_PREFIX}${username}`, String(character));
}

export function getCharacterConfirmed(username: string) {
  if (typeof window === "undefined") return false;

  return window.localStorage.getItem(`${CHARACTER_CONFIRMED_KEY_PREFIX}${username}`) === "1";
}

export function setCharacterConfirmed(username: string) {
  window.localStorage.setItem(`${CHARACTER_CONFIRMED_KEY_PREFIX}${username}`, "1");
}
