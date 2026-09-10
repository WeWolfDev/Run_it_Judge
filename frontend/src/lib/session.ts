export type UserRole = "admin" | "participant";

export interface Session {
  username: string;
  role: UserRole;
  token?: string;
}

const SESSION_KEY = "run-it-session";

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