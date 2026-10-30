import { PixelIcon } from "@/components/PixelIcon";
import { ProblemStatement } from "@/components/ProblemStatement";

import { LessonAnimation } from "./animations";
import type { Topic } from "./content";
import type { Solved } from "./useProgress";

// Un tema del mapa: la lección (texto y código), su animación paso a paso y los
// ejercicios para practicar.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

export function TopicView({
  topic,
  index,
  solved,
  onExercise,
  onBack,
}: {
  topic: Topic;
  index: number;
  solved: Solved;
  onExercise: (exerciseId: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Volver al mapa
      </button>
      <header>
        <p className="text-[10px] tracking-widest text-muted-foreground" style={PIXEL}>
          Mundo 1 · Tema {index + 1}
        </p>
        <h1 className="mt-2 text-xl text-foreground" style={PIXEL}>
          {topic.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{topic.summary}</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <PixelIcon name="flag" className="h-4 w-4 text-primary" /> La idea
          </h2>
          <div className="[&_code]:font-mono [&_code]:[font-variant-ligatures:none] [&_li]:mt-1 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-editor [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-editor-foreground [&_ul]:list-disc [&_ul]:pl-5">
            <ProblemStatement statement={topic.lesson} />
          </div>
        </section>
        <section className="min-w-0 rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <PixelIcon name="play" className="h-4 w-4 text-primary" /> Míralo paso a paso
          </h2>
          <LessonAnimation id={topic.animation} />
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <PixelIcon name="code" className="h-4 w-4 text-primary" /> Practica
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {topic.exercises.map((exercise) => {
            const done = exercise.id in solved;
            return (
              <li key={exercise.id}>
                <button
                  type="button"
                  onClick={() => onExercise(exercise.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-left hover:border-primary"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">
                      {exercise.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {done ? "Resuelto" : "Sin resolver"} · +{exercise.points} XP
                    </span>
                  </span>
                  <PixelIcon
                    name={done ? "check" : "play"}
                    className={`h-5 w-5 shrink-0 ${done ? "text-success" : "text-primary"}`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
