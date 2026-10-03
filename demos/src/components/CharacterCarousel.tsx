import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Sprite } from "@/components/Sprite";
import { CHARACTER_PACKS, CHARACTERS } from "@/lib/characters";
import { play } from "@/lib/sfx";
import { CHARACTER_COUNT, getSelectedCharacter, setSelectedCharacter } from "@/lib/session";

/** DEMO: tres tarjetas grandes a la vista; las flechas desplazan de a 1. */
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
  const [popping, setPopping] = useState(false);
  // Solo las flechas, los grupos y la carga inicial mueven el carrusel hasta
  // `viewing`. Ni las flechas, ni arrastrar, ni el clic en una tarjeta eligen:
  // solo el botón.
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

  // Arrastrar o usar el teclado mueve el carrusel: el foco sigue a la tarjeta central.
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
    play("click");
  };

  const jumpTo = (index: number) => {
    scrollToViewing.current = true;
    setViewing(index);
    play("click");
  };

  const choose = (index: number) => {
    setSelectedCharacter(username, index);
    setSelected(index);
    setViewing(index);
    setPopping(true);
    play("coin");
    // La tarjeta rebota antes de pasar a la sala de espera.
    setTimeout(() => onSelect?.(index), 450);
  };

  const current = CHARACTERS[viewing] ?? CHARACTERS[0]!;
  const near = (index: number) => {
    const distance = Math.abs(index - viewing);
    return distance <= 2 || distance >= CHARACTER_COUNT - 2;
  };

  return (
    <div className="mt-5 flex flex-col items-center gap-5">
      {/* Grupos: saltan al primer personaje de cada pack. */}
      <div className="flex flex-wrap justify-center gap-2">
        {CHARACTER_PACKS.map((pack) => {
          const first = CHARACTERS.findIndex((c) => c.pack === pack);
          const active = current.pack === pack;
          return (
            <button
              key={pack}
              type="button"
              onClick={() => jumpTo(first)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {pack}
            </button>
          );
        })}
      </div>

      <div className="flex w-full items-center gap-3 sm:gap-5">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="Personaje anterior"
          className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
        >
          <ChevronLeft className="h-10 w-10" strokeWidth={3} />
        </button>

        {/* La caja de la distribución: tres tarjetas grandes adentro. */}
        <div className="min-w-0 flex-1 rounded-2xl border border-border bg-muted/60 p-3 sm:p-5">
          <Carousel
            setApi={setApi}
            opts={{ align: "center", loop: true }}
            className="min-w-0"
            aria-label="Personajes"
          >
            <CarouselContent className="-ml-3 sm:-ml-5">
              {CHARACTERS.map((character, index) => (
                <CarouselItem
                  key={`${character.pack}-${character.name}`}
                  className="basis-1/3 pl-3 sm:pl-5"
                >
                  <button
                    type="button"
                    onClick={() => jumpTo(index)}
                    aria-pressed={index === selected}
                    className={`flex aspect-square w-full flex-col items-center justify-end overflow-hidden rounded-xl border-2 p-3 text-center transition-[transform,opacity] ${
                      index === viewing
                        ? `border-primary bg-primary/10 ring-4 ring-primary/20 ${popping ? "animate-run-it-pop" : ""}`
                        : "scale-95 border-border bg-card opacity-70 hover:opacity-100"
                    }`}
                  >
                    <span className="flex min-h-0 flex-1 items-end justify-center">
                      {/* Solo se animan las tarjetas cercanas: con 48, el resto espera. */}
                      {near(index) ? (
                        <Sprite index={index} state={index === viewing ? "run" : "idle"} scale={1.5} />
                      ) : (
                        <span className="block h-32 w-32" />
                      )}
                    </span>
                    <span className="mt-2 block w-full truncate text-sm font-semibold text-foreground sm:text-base">
                      {character.name}
                    </span>
                    <span className="hidden w-full truncate text-xs text-muted-foreground sm:block">
                      {character.title} · {character.pack}
                    </span>
                  </button>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
        </div>

        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Personaje siguiente"
          className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
        >
          <ChevronRight className="h-10 w-10" strokeWidth={3} />
        </button>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {viewing + 1} / {CHARACTER_COUNT} · {current.title}
      </p>

      <button
        type="button"
        onClick={() => choose(viewing)}
        className="rounded-lg bg-primary px-8 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Confirmar {current.name}
      </button>
    </div>
  );
}

export default CharacterCarousel;
