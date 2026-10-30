import { useCallback, useEffect, useState } from "react";

import { setSelectedCharacter } from "@/lib/session";
import { supabase } from "@/lib/solo-supabase";

import { nicknameProblem } from "./nickname";

// Estado de la cuenta del modo solo. La cuenta es opcional: sin ella se juega
// igual. Con ella solo se guarda un apodo (tabla perfiles) y los ejercicios
// resueltos del mapa (tabla progreso, aprende/useProgress.ts). Ver el aviso en
// SoloLegal.tsx.

export type Provider = "github" | "google";

export type AccountState =
  | { status: "loading" }
  | { status: "signedOut"; notice?: string }
  | { status: "needsNickname" }
  | {
      status: "ready";
      apodo: string;
      userId: string;
      /** Suspendida por el equipo (apodo ofensivo u otra falta a los términos). */
      bloqueado: boolean;
      /** Fecha de alta del perfil (ISO), si la base la devuelve. */
      desde: string | null;
    }
  | { status: "error"; message: string };

export { NICKNAME } from "./nickname";

type Perfil = { apodo: string; bloqueado?: boolean; creado_en?: string; personaje?: number };

/** Usuario local del personaje elegido (el mismo de la contrarreloj y el mapa). */
export const PLAYER = "demo-solo";

/** Error del servidor al guardar un apodo, en palabras del usuario. */
function nicknameError(error: { code?: string; message?: string }) {
  if (error.code === "23505") return "Ese apodo ya lo usa alguien más.";
  if (error.message?.includes("apodo_no_permitido"))
    return "Ese apodo no está permitido: no se aceptan groserías, insultos ni contenido ofensivo.";
  return "No se pudo guardar el apodo. Intenta de nuevo.";
}

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
    let { data, error } = await supabase
      .from("perfiles")
      .select("apodo, bloqueado, creado_en, personaje")
      .eq("id", userId)
      .maybeSingle<Perfil>();
    // Sin 004_solo_perfil_y_moderacion.sql todavía no existe `bloqueado`.
    if (error?.code === "42703") {
      ({ data, error } = await supabase
        .from("perfiles")
        .select("apodo")
        .eq("id", userId)
        .maybeSingle<Perfil>());
    }
    if (error) {
      setState({ status: "error", message: "No se pudo cargar tu cuenta. Intenta de nuevo." });
      return;
    }
    // El personaje guardado en la cuenta manda sobre el de este navegador.
    if (typeof data?.personaje === "number") setSelectedCharacter(PLAYER, data.personaje);
    setState(
      data
        ? {
            status: "ready",
            apodo: data.apodo,
            userId,
            bloqueado: data.bloqueado ?? false,
            desde: data.creado_en ?? null,
          }
        : { status: "needsNickname" },
    );
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
    const problem = nicknameProblem(apodo);
    if (problem) return problem;
    const { data } = await supabase.auth.getUser();
    if (!data.user) return "Tu sesión terminó. Vuelve a entrar.";
    const { error } = await supabase.from("perfiles").insert({ id: data.user.id, apodo });
    if (error) return nicknameError(error);
    setState({
      status: "ready",
      apodo,
      userId: data.user.id,
      bloqueado: false,
      desde: new Date().toISOString(),
    });
    return null;
  }, []);

  /** Cambia el apodo de una cuenta que ya tiene uno. */
  const renameNickname = useCallback(
    async (apodo: string) => {
      if (state.status !== "ready") return "Entra a tu cuenta para cambiar el apodo.";
      const problem = nicknameProblem(apodo);
      if (problem) return problem;
      const { error } = await supabase.from("perfiles").update({ apodo }).eq("id", state.userId);
      if (error) return nicknameError(error);
      setState({ ...state, apodo });
      return null;
    },
    [state],
  );

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

  /** Guarda en la cuenta el personaje elegido (en el navegador ya lo guardó el carrusel). */
  const saveCharacter = useCallback(
    async (index: number) => {
      if (state.status !== "ready" || state.bloqueado) return;
      await supabase.from("perfiles").update({ personaje: index }).eq("id", state.userId);
    },
    [state],
  );

  return {
    state,
    signIn,
    saveNickname,
    renameNickname,
    saveCharacter,
    signOut,
    deleteAccount,
    retry,
  };
}

export type Account = ReturnType<typeof useAccount>;
