import { useCallback, useEffect, useRef, useState } from "react";

import type { AccountState } from "@/components/solo/account/useAccount";
import { supabase } from "@/lib/solo-supabase";

import { ALL_EXERCISES, type Topic } from "./content";

// Ejercicios resueltos del mapa. Sin cuenta viven en este navegador; con cuenta
// se suben a Supabase (tabla progreso) y se bajan en cualquier otra computadora.
// Al entrar se juntan los dos: lo resuelto sin cuenta no se pierde.

const KEY = "run-it-aprende-progreso";
const KNOWN = new Set(ALL_EXERCISES.map((e) => e.id));

/** id del ejercicio → fecha ISO en que se resolvió por primera vez. */
export type Solved = Record<string, string>;

function readLocal(): Solved {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Solved;
    return Object.fromEntries(Object.entries(parsed).filter(([id]) => KNOWN.has(id)));
  } catch {
    return {};
  }
}

function writeLocal(solved: Solved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(solved));
  } catch {
    // Sin almacenamiento: dura hasta recargar (o se guarda en la cuenta).
  }
}

export function useProgress(account: AccountState) {
  const [solved, setSolved] = useState<Solved>(() =>
    typeof window === "undefined" ? {} : readLocal(),
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const userId = account.status === "ready" ? account.userId : null;
  // Una cuenta suspendida no sincroniza: el servidor rechazaría lo nuevo.
  const syncId = account.status === "ready" && !account.bloqueado ? account.userId : null;

  // Al cerrar sesión (o borrar la cuenta) se borra la copia local: en una
  // computadora compartida, quien entre después no debe ver ni heredar lo tuyo.
  const lastUser = useRef<string | null>(null);
  useEffect(() => {
    if (lastUser.current && !userId && account.status === "signedOut") {
      writeLocal({});
      setSolved({});
    }
    if (userId) lastUser.current = userId;
    else if (account.status === "signedOut") lastUser.current = null;
  }, [userId, account.status]);

  // Con sesión: sube lo resuelto en este navegador y baja lo de la cuenta.
  useEffect(() => {
    if (!syncId) return;
    let cancelled = false;
    void (async () => {
      const local = readLocal();
      const { data, error } = await supabase
        .from("progreso")
        .select("tema, completado_en")
        .eq("usuario", syncId);
      if (cancelled) return;
      if (error) {
        setSyncError("No se pudo cargar tu progreso de la cuenta. Se guarda en este navegador.");
        return;
      }
      const remote: Solved = Object.fromEntries(
        (data as { tema: string; completado_en: string }[])
          .filter((row) => KNOWN.has(row.tema))
          .map((row) => [row.tema, row.completado_en]),
      );
      const missing = Object.entries(local).filter(([id]) => !(id in remote));
      if (missing.length > 0) {
        const { error: upError } = await supabase.from("progreso").upsert(
          missing.map(([tema, completado_en]) => ({ usuario: syncId, tema, completado_en })),
          { onConflict: "usuario,tema", ignoreDuplicates: true },
        );
        if (cancelled) return;
        if (upError) setSyncError("No se pudo subir parte de tu progreso. Intenta más tarde.");
      }
      const merged = { ...remote, ...Object.fromEntries(missing) };
      writeLocal(merged);
      setSolved(merged);
      setSyncError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [syncId]);

  const markSolved = useCallback(
    (id: string) => {
      if (!KNOWN.has(id)) return;
      const at = new Date().toISOString();
      setSolved((current) => {
        if (id in current) return current;
        const next = { ...current, [id]: at };
        writeLocal(next);
        return next;
      });
      if (syncId) {
        void supabase
          .from("progreso")
          .upsert(
            { usuario: syncId, tema: id, completado_en: at },
            { onConflict: "usuario,tema", ignoreDuplicates: true },
          )
          .then(({ error }) => {
            if (error) setSyncError("Se guardó en este navegador, pero no en tu cuenta.");
          });
      }
    },
    [syncId],
  );

  const points = ALL_EXERCISES.reduce((sum, e) => sum + (e.id in solved ? e.points : 0), 0);

  return { solved, points, markSolved, syncError };
}

export type Progress = ReturnType<typeof useProgress>;

/** Un tema se desbloquea con un ejercicio resuelto del anterior; se completa con todos. */
export type TopicState = "done" | "current" | "locked";

export function topicState(topics: Topic[], index: number, solved: Solved): TopicState {
  const topic = topics[index]!;
  if (topic.exercises.every((e) => e.id in solved)) return "done";
  const prev = topics[index - 1];
  if (!prev || prev.exercises.some((e) => e.id in solved)) return "current";
  return "locked";
}

/** Qué sigue después de resolver un ejercicio (pantalla de nivel superado). */
export type NextStep =
  | { kind: "exercise"; topic: Topic; exerciseId: string; name: string }
  | { kind: "topic"; topic: Topic }
  | { kind: "world"; topic: Topic; world: string }
  | { kind: "end"; nextWorld: string | null };

/**
 * Siguiente paso tras resolver `exerciseId` de `topics[index]`, contando ese
 * ejercicio como resuelto: otro ejercicio sin resolver del mismo tema; si el
 * tema quedó completo, el tema siguiente; si el mundo quedó completo, el primer
 * tema del mundo siguiente, o el final si todavía no tiene temas.
 */
export function nextStep(
  worlds: { title: string; topics: Topic[] }[],
  worldIndex: number,
  index: number,
  exerciseId: string,
  solved: Solved,
): NextStep {
  const now = { ...solved, [exerciseId]: "ahora" };
  const topics = worlds[worldIndex]!.topics;
  const topic = topics[index]!;
  const pending = topic.exercises.find((e) => !(e.id in now));
  if (pending) return { kind: "exercise", topic, exerciseId: pending.id, name: pending.name };
  const nextTopic = topics[index + 1];
  if (nextTopic) return { kind: "topic", topic: nextTopic };
  const nextWorld = worlds[worldIndex + 1];
  const first = nextWorld?.topics[0];
  if (nextWorld && first) return { kind: "world", topic: first, world: nextWorld.title };
  return { kind: "end", nextWorld: nextWorld?.title ?? null };
}
