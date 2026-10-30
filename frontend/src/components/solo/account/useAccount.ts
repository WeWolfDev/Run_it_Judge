import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/solo-supabase";

// Estado de la cuenta del modo solo. La cuenta es opcional: sin ella se juega
// igual. Con ella solo se guarda un apodo (tabla perfiles) y los ejercicios
// resueltos del mapa (tabla progreso, aprende/useProgress.ts). Ver el aviso en
// SoloLegal.tsx.

export type Provider = "github" | "google";

export type AccountState =
  | { status: "loading" }
  | { status: "signedOut"; notice?: string }
  | { status: "needsNickname" }
  | { status: "ready"; apodo: string; userId: string }
  | { status: "error"; message: string };

/** Mismas reglas que el check de perfiles.apodo en Supabase. */
export const NICKNAME = /^[A-Za-z0-9_-]{3,20}$/;

// Lo que deja el regreso del login en la URL (?code=, ?error=). Se borra para
// que recargar o compartir el enlace no lo repita.
const AUTH_PARAMS = ["code", "error", "error_code", "error_description"];

function takeAuthError() {
  const url = new URL(window.location.href);
  const error = url.searchParams.get("error");
  if (!AUTH_PARAMS.some((key) => url.searchParams.has(key))) return null;
  AUTH_PARAMS.forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  if (!error) return null;
  return error === "access_denied"
    ? "Cancelaste el inicio de sesión. Puedes seguir jugando sin cuenta."
    : "No se pudo iniciar sesión. Intenta de nuevo en un momento.";
}

export function useAccount() {
  const [state, setState] = useState<AccountState>({ status: "loading" });

  const load = useCallback(async (userId: string | null) => {
    if (!userId) {
      setState((current) => (current.status === "signedOut" ? current : { status: "signedOut" }));
      return;
    }
    const { data, error } = await supabase
      .from("perfiles")
      .select("apodo")
      .eq("id", userId)
      .maybeSingle<{ apodo: string }>();
    if (error) {
      setState({ status: "error", message: "No se pudo cargar tu cuenta. Intenta de nuevo." });
      return;
    }
    setState(data ? { status: "ready", apodo: data.apodo, userId } : { status: "needsNickname" });
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") return;
      const notice = takeAuthError();
      if (notice && !session) {
        setState({ status: "signedOut", notice });
        return;
      }
      // Supabase pide no llamar a la base dentro de este callback: se difiere.
      setTimeout(() => void load(session?.user.id ?? null), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const signIn = useCallback(async (provider: Provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) setState({ status: "signedOut", notice: "No se pudo abrir el inicio de sesión." });
  }, []);

  /** Devuelve el error para mostrar junto al campo, o null si se guardó. */
  const saveNickname = useCallback(async (apodo: string) => {
    if (!NICKNAME.test(apodo)) {
      return "Usa de 3 a 20 letras sin acentos, números, guion o guion bajo.";
    }
    const { data } = await supabase.auth.getUser();
    if (!data.user) return "Tu sesión terminó. Vuelve a entrar.";
    const { error } = await supabase.from("perfiles").insert({ id: data.user.id, apodo });
    if (error) {
      return error.code === "23505"
        ? "Ese apodo ya lo usa alguien más."
        : "No se pudo guardar el apodo. Intenta de nuevo.";
    }
    setState({ status: "ready", apodo, userId: data.user.id });
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setState({ status: "signedOut" });
  }, []);

  /** Borra la cuenta, el apodo y el progreso (función borrar_mi_cuenta). */
  const deleteAccount = useCallback(async () => {
    const { error } = await supabase.rpc("borrar_mi_cuenta");
    if (error) return "No se pudo borrar la cuenta. Intenta de nuevo.";
    // El usuario ya no existe: la sesión solo se limpia en este navegador.
    await supabase.auth.signOut({ scope: "local" });
    setState({ status: "signedOut", notice: "Tu cuenta y tu progreso se borraron." });
    return null;
  }, []);

  const retry = useCallback(async () => {
    setState({ status: "loading" });
    const { data } = await supabase.auth.getSession();
    await load(data.session?.user.id ?? null);
  }, [load]);

  return { state, signIn, saveNickname, signOut, deleteAccount, retry };
}

export type Account = ReturnType<typeof useAccount>;
