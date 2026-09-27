import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { CHARACTER_COUNT, getSelectedCharacter, setSelectedCharacter } from "@/lib/session";

const CHARACTERS = [
  { name: "Aurora", title: "La veloz", silk: 0 },
  { name: "Nilo", title: "El estratega", silk: 1 },
  { name: "Mango", title: "El constante", silk: 2 },
  { name: "Sol", title: "La precisa", silk: 3 },
  { name: "Pixel", title: "El veloz", silk: 4 },
  { name: "Nova", title: "La resistente", silk: 5 },
] as const;

interface CharacterCarouselProps {
  /** Dueño de la selección: forma parte de la clave de localStorage. */
  username: string;
  /** Se llama después de guardar la selección. */
  onSelect?: (index: number) => void;
}

function HorseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 46c0-9 5-14 12-17l4-9c1-3 4-6 8-7l6-2 3 5-4 3 2 4c4 2 6 6 6 11l4 3-3 4-4-2c-1 4-4 7-8 9l1 8h-5l-1-7-8 1-2 6h-5l1-7-4-1-3 4-3-2z"
      />
    </svg>
  );
}

export function CharacterCarousel({ username, onSelect }: CharacterCarouselProps) {
  const [viewing, setViewing] = useState(0);
  const [selected, setSelected] = useState(0);

  // localStorage solo existe en el cliente: leerlo después de montar evita que
  // el HTML del SSR (siempre 0) no coincida con la hidratación.
  useEffect(() => {
    const stored = getSelectedCharacter(username);
    setSelected(stored);
    setViewing(stored);
  }, [username]);

  // Navegación cíclica: desde el último se vuelve al primero y viceversa.
  const move = (step: number) =>
    setViewing((current) => (current + step + CHARACTER_COUNT) % CHARACTER_COUNT);

  const confirm = () => {
    setSelectedCharacter(username, viewing);
    setSelected(viewing);
    onSelect?.(viewing);
  };

  // getSelectedCharacter ya acota a [0, CHARACTER_COUNT); el ?? solo satisface a TS.
  const current = CHARACTERS[viewing] ?? CHARACTERS[0];
  const selectedName = (CHARACTERS[selected] ?? CHARACTERS[0]).name;
  const isSelected = viewing === selected;

  return (
    <div className="mt-4 flex flex-col items-center gap-4">
      <div className="flex w-full max-w-sm items-center gap-3">
        <button
          type="button"
          onClick={() => move(-1)}
          aria-label="Personaje anterior"
          className="rounded-full border border-border p-2 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="flex-1 overflow-hidden" aria-live="polite">
          <div
            className="flex transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${viewing * 100}%)` }}
          >
            {CHARACTERS.map((character, index) => (
              <div
                key={character.name}
                aria-hidden={index !== viewing}
                className={`w-full shrink-0 rounded-lg border p-4 text-center transition-colors ${
                  index === selected
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : "border-border bg-muted"
                }`}
              >
                <HorseIcon className={`mx-auto h-16 w-16 text-silk-${character.silk}`} />
                <span className="mt-2 block text-sm font-semibold text-foreground">
                  {character.name}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {character.title}
                </span>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => move(1)}
          aria-label="Personaje siguiente"
          className="rounded-full border border-border p-2 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {viewing + 1} / {CHARACTER_COUNT} · {selectedName} seleccionado
      </p>

      <button
        type="button"
        onClick={confirm}
        disabled={isSelected}
        className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {isSelected ? `${current.name} seleccionado` : "Seleccionar"}
      </button>
    </div>
  );
}

export default CharacterCarousel;
