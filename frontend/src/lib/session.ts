export type UserRole = "admin" | "participant";

export interface Session {
  username: string;
  role: UserRole;
  token?: string;
}

const SESSION_KEY = "run-it-session";
const CHARACTER_KEY_PREFIX = "run-it-character:";

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
  return Number.isInteger(character) && character >= 0 && character < 6 ? character : 0;
}

export function setSelectedCharacter(username: string, character: number) {
  window.localStorage.setItem(`${CHARACTER_KEY_PREFIX}${username}`, String(character));
}