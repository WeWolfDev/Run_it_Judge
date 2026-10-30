import { useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import { SoloAccount } from "@/components/solo/account/SoloAccount";
import type { Account } from "@/components/solo/account/useAccount";
import { Preferences, SoloDemo } from "@/components/solo/SoloDemo";

import { levelOf, WORLDS } from "./content";
import { Practice } from "./Practice";
import { Ranking } from "./Ranking";
import { TopicView } from "./TopicView";
import { useProgress } from "./useProgress";
import { WorldMap } from "./WorldMap";

// Modo solo después de "Press start": mapa de aprendizaje (temas, lecciones y
// ejercicios sin reloj), la contrarreloj de siempre y el ranking global.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

type View =
  | { kind: "map" }
  | { kind: "topic"; topic: string }
  | { kind: "exercise"; topic: string; exercise: string }
  | { kind: "race" }
  | { kind: "ranking" };

const TABS = [
  { kind: "map", label: "Mapa", icon: "flag" },
  { kind: "race", label: "Contrarreloj", icon: "clock" },
  { kind: "ranking", label: "Ranking", icon: "trophy" },
] as const;

export function SoloHub({ account, onExit }: { account: Account; onExit: () => void }) {
  const [view, setView] = useState<View>({ kind: "map" });
  const progress = useProgress(account.state);
  const topics = WORLDS[0]!.topics;
  const level = levelOf(progress.points);
  const intoLevel = progress.points % 100;

  const tab = view.kind === "topic" || view.kind === "exercise" ? "map" : view.kind;
  const go = (next: View) => {
    setView(next);
    window.scrollTo(0, 0);
  };

  let body;
  if (view.kind === "race") body = <SoloDemo embedded />;
  else if (view.kind === "ranking") body = <Ranking account={account} />;
  else if (view.kind === "map")
    body = <WorldMap solved={progress.solved} onOpen={(topic) => go({ kind: "topic", topic })} />;
  else {
    const index = topics.findIndex((t) => t.id === view.topic);
    const topic = topics[index];
    if (!topic) body = null;
    else if (view.kind === "topic")
      body = (
        <TopicView
          topic={topic}
          index={index}
          solved={progress.solved}
          onExercise={(exercise) => go({ kind: "exercise", topic: topic.id, exercise })}
          onBack={() => go({ kind: "map" })}
        />
      );
    else {
      const exercise = topic.exercises.find((e) => e.id === view.exercise);
      body = exercise ? (
        <Practice
          key={exercise.id}
          exercise={exercise}
          solved={exercise.id in progress.solved}
          onSolved={() => progress.markSolved(exercise.id)}
          onBack={() => go({ kind: "topic", topic: topic.id })}
          backLabel={`Volver a ${topic.title}`}
        />
      ) : null;
    }
  }

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
          <button
            type="button"
            onClick={onExit}
            title="Volver a la pantalla de inicio"
            aria-label="Run It: volver a la pantalla de inicio"
            className="text-sm text-primary"
            style={PIXEL}
          >
            Run&nbsp;It
          </button>
          <nav aria-label="Secciones" className="flex flex-wrap gap-1">
            {TABS.map((item) => (
              <button
                key={item.kind}
                type="button"
                onClick={() => go({ kind: item.kind })}
                aria-current={tab === item.kind ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                  tab === item.kind
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <PixelIcon name={item.icon} className="h-4 w-4 text-primary" /> {item.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-xs" title={`${progress.points} XP en total`}>
            <span style={PIXEL} className="text-[10px] text-foreground">
              Nivel {level}
            </span>
            <span className="h-2.5 w-24 overflow-hidden rounded bg-muted">
              <span className="block h-full bg-accent" style={{ width: `${intoLevel}%` }} />
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {progress.points} XP
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <Preferences />
            <SoloAccount account={account} />
          </div>
        </div>
        {progress.syncError && (
          <p className="border-t border-border bg-danger-soft px-5 py-1.5 text-center text-xs text-danger">
            {progress.syncError}
          </p>
        )}
      </header>
      <main className={view.kind === "race" ? "" : "mx-auto max-w-7xl px-5 py-6"}>{body}</main>
    </div>
  );
}
