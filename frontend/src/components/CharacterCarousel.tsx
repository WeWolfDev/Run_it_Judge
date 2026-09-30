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
  { name: "Pixel", title: "El veloz", silk: 4, image: "/character-white.gif" },
  { name: "Aurora", title: "La veloz", silk: 0, image: "/character-blue.gif" },
  { name: "Jungle", title: "El salvaje", silk: 5, image: "/jungle-idle.gif" },
] as const;

/** Tarjetas visibles a la vez. Las flechas desplazan de a 1. */
const VISIBLE_COUNT = 1;

interface CharacterCarouselProps {
  /** Dueño de la selección: forma parte de la clave de localStorage. */
  username: string;
  /** Se llama después de guardar la selección. Solo lo dispara el botón de confirmar. */
  onSelect?: (index: number) => void;
}

export function CharacterCarousel({ username, onSelect }: CharacterCarouselProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [viewing, setViewing] = useState(0);
  const [selected, setSelected] = useState(0);
  // Solo las flechas y la carga inicial mueven el carrusel hasta `viewing`; el clic
  // en una tarjeta cambia el foco sin desplazar el grupo que se está mirando.
  // Ni las flechas, ni arrastrar, ni el clic en una tarjeta eligen: solo el botón.
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
          opts={{ align: "center", loop: true }}
          className="min-w-0 flex-1"
          aria-label="Personajes"
        >
          <CarouselContent className="-ml-2">
            {CHARACTERS.map((character, index) => (
              <CarouselItem key={character.name} className="basis-1/3 pl-2">
                <button
                  type="button"
                  onClick={() => {
                    scrollToViewing.current = true;
                    setViewing(index);
                  }}
                  aria-pressed={index === selected}
                  className={`w-full rounded-lg border p-1 text-center transition-colors sm:p-2 ${
                    index === selected
                      ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                      : index === viewing
                        ? "border-primary/50 bg-muted"
                        : "border-border bg-muted"
                  }`}
                >
                  <img
                    src={character.image}
                    alt={character.name}
                    className="mx-auto h-16 w-16 object-contain sm:h-24 sm:w-24"
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
        {viewing + 1} / {CHARACTER_COUNT} · {current.title}
      </p>

      <button
        type="button"
        onClick={() => choose(viewing)}
        className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Confirmar {current.name}
      </button>
    </div>
  );
}

export default CharacterCarousel;
