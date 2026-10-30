import { useEffect, useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PLAYER } from "@/components/solo/account/useAccount";
import { getSelectedCharacter } from "@/lib/session";

import type { Exercise, Topic } from "./content";
import type { NextStep } from "./useProgress";

// Pantalla de nivel superado: aparece al aceptar un ejercicio del mapa. Ofrece
// seguir con lo que toca (otro problema del tema, el tema siguiente o el mundo
// siguiente) o salir al mapa. Con Esc o la X se cierra y sigues viendo tu código.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

export function LevelComplete({
  exercise,
  topic,
  firstTime,
  solvedInTopic,
  next,
  onNext,
  onMap,
  onClose,
}: {
  exercise: Exercise;
  topic: Topic;
  /** Primera vez que lo resuelve: suma XP. */
  firstTime: boolean;
  /** Ejercicios resueltos del tema, contando este. */
  solvedInTopic: number;
  next: NextStep;
  onNext: () => void;
  onMap: () => void;
  onClose: () => void;
}) {
  const [character, setCharacter] = useState<number | null>(null);
  useEffect(() => setCharacter(getSelectedCharacter(PLAYER)), []);

  const total = topic.exercises.length;
  const title =
    next.kind === "exercise"
      ? "¡Nivel superado!"
      : next.kind === "topic"
        ? "¡Tema completado!"
        : "¡Mundo completado!";
  const action =
    next.kind === "exercise"
      ? { label: "Siguiente problema", detail: next.name }
      : next.kind === "topic"
        ? { label: "Siguiente tema", detail: next.topic.title }
        : next.kind === "world"
          ? { label: "Siguiente mundo", detail: `${next.world}: ${next.topic.title}` }
          : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-none border-2 border-primary bg-card p-0 shadow-[6px_6px_0_0_var(--primary)]">
        <div className="login-scanlines pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative grid justify-items-center gap-4 px-6 pb-6 pt-8 text-center">
          {character !== null && <Sprite index={character} state="run" scale={0.7} />}
          <DialogTitle className="login-title text-lg leading-relaxed text-primary" style={PIXEL}>
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Resolviste <b className="text-foreground">{exercise.name}</b>
            {firstTime ? (
              <>
                {" "}
                y ganaste <b className="font-mono text-silk-2">+{exercise.points} XP</b>.
              </>
            ) : (
              " otra vez. Los XP ya los tenías."
            )}
          </DialogDescription>

          {/* Avance del tema: un bloque por ejercicio. */}
          <div className="grid w-full gap-1.5">
            <p className="text-xs text-muted-foreground">
              {topic.title} · {solvedInTopic}/{total}
            </p>
            <div className="flex gap-1.5">
              {topic.exercises.map((e, k) => (
                <span
                  key={e.id}
                  className={`h-2.5 flex-1 ${k < solvedInTopic ? "bg-[#2dd4bf]" : "bg-muted"}`}
                />
              ))}
            </div>
          </div>

          {next.kind === "end" && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {next.nextWorld
                ? `Terminaste todo lo disponible. El mundo ${next.nextWorld} llega pronto.`
                : "Terminaste todo el mapa."}
            </p>
          )}

          <div className="grid w-full gap-2">
            {action && (
              <button
                type="button"
                onClick={onNext}
                autoFocus
                className="login-start flex items-center justify-center gap-2 bg-primary py-3 text-[11px] text-primary-foreground"
                style={PIXEL}
              >
                {action.label} <PixelIcon name="play" className="h-4 w-4" />
              </button>
            )}
            {action && (
              <p className="-mt-1 truncate text-xs text-muted-foreground">{action.detail}</p>
            )}
            <button
              type="button"
              onClick={onMap}
              autoFocus={!action}
              className="flex items-center justify-center gap-2 border-2 border-border py-2.5 text-[10px] text-foreground hover:bg-muted"
              style={PIXEL}
            >
              <PixelIcon name="flag" className="h-4 w-4 text-primary" /> Salir al mapa
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
