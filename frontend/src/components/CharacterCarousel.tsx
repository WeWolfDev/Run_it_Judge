import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { CHARACTER_COUNT, getSelectedCharacter, setSelectedCharacter } from "@/lib/session";

const CHARACTERS = [
  { name: "Aurora", title: "La veloz", silk: 0 },
  { name: "Nilo", title: "El estratega", silk: 1 },
  { name: "Mango", title: "El constante", silk: 2 },
  { name: "Sol", title: "La precisa", silk: 3 },
  { name: "Pixel", title: "El veloz", silk: 4 },
  { name: "Nova", title: "La resistente", silk: 5 },
  { name: "Trébol", title: "El paciente", silk: 6 },
  { name: "Lima", title: "La curiosa", silk: 7 },
  { name: "Canela", title: "La metódica", silk: 8 },
  { name: "Brasa", title: "El implacable", silk: 9 },
] as const;

/** Tarjetas visibles a la vez. Las flechas desplazan el grupo completo. */
const VISIBLE_COUNT = 6;

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
  const [api, setApi] = useState<CarouselApi>();
  const [viewing, setViewing] = useState(0);
  const [selected, setSelected] = useState(0);
  // Solo las flechas y la carga inicial mueven el carrusel hasta `viewing`; el clic
  // en una tarjeta cambia el foco sin desplazar el grupo que se está mirando.
  const scrollToViewing = useRef(false);

  // localStorage solo existe en el cliente: leerlo después de montar evita que
  // el HTML del SSR (siempre 0) no coincida con la hidratación.
  useEffect(() => {
    const stored = getSelectedCharacter(username);
    scrollToViewing.current = true;
    setSelected(stored);
    setViewing(stored);
  }, [username]);

  useEffect(() => {
    if (!api || !scrollToViewing.current) return;
    scrollToViewing.current = false;
    api.scrollTo(viewing);
  }, [api, viewing]);

  // Arrastrar o usar el teclado mueve el carrusel: el foco sigue a la primera tarjeta.
  useEffect(() => {
    if (!api) return;
    const onScrollSelect = () => setViewing(api.selectedScrollSnap());
    api.on("select", onScrollSelect);
    return () => {
      api.off("select", onScrollSelect);
    };
  }, [api]);

  // Navegación cíclica: desde el último se vuelve al primero y viceversa.
  const move = (step: number) =>
    setViewing((current) => (current + step + CHARACTER_COUNT) % CHARACTER_COUNT);

  const shift = (direction: -1 | 1) => {
    scrollToViewing.current = true;
    move(direction * VISIBLE_COUNT);
  };

  const choose = (index: number) => {
    setSelectedCharacter(username, index);
    setSelected(index);
    setViewing(index);
    onSelect?.(index);
  };

  // getSelectedCharacter ya acota a [0, CHARACTER_COUNT); el ?? solo satisface a TS.
  const current = CHARACTERS[viewing] ?? CHARACTERS[0];
  const selectedName = (CHARACTERS[selected] ?? CHARACTERS[0]).name;
  const isSelected = viewing === selected;

  return (
    <div className="mt-4 flex flex-col items-center gap-4">
      <div className="flex w-full max-w-3xl items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="Personaje anterior"
          className="shrink-0 rounded-full border border-border p-2 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <Carousel
          setApi={setApi}
          opts={{ align: "start", loop: true }}
          className="min-w-0 flex-1"
          aria-label="Personajes"
        >
          <CarouselContent className="-ml-2">
            {CHARACTERS.map((character, index) => (
              <CarouselItem key={character.name} className="basis-1/6 pl-2">
                <button
                  type="button"
                  onClick={() => choose(index)}
                  aria-pressed={index === selected}
                  className={`w-full rounded-lg border p-1 text-center transition-colors sm:p-2 ${
                    index === selected
                      ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                      : index === viewing
                        ? "border-primary/50 bg-muted"
                        : "border-border bg-muted"
                  }`}
                >
                  <HorseIcon
                    className={`mx-auto h-7 w-7 sm:h-12 sm:w-12 text-silk-${character.silk}`}
                  />
                  <span className="mt-1 block truncate text-[10px] font-semibold text-foreground sm:text-xs">
                    {character.name}
                  </span>
                  <span className="mt-0.5 hidden truncate text-[11px] text-muted-foreground md:block">
                    {character.title}
                  </span>
                </button>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>

        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Personaje siguiente"
          className="shrink-0 rounded-full border border-border p-2 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {viewing + 1} / {CHARACTER_COUNT} · {selectedName} seleccionado
      </p>

      <button
        type="button"
        onClick={() => choose(viewing)}
        className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {isSelected ? `${current.name} seleccionado` : `Seleccionar ${current.name}`}
      </button>
    </div>
  );
}

export default CharacterCarousel;
