import { useRef, useState } from "react";

export type DeckSide = "left" | "right";
export type DeckState = { stick: { left: number; right: number }; pressed: number };

// Cada tecla inclina un joystick (grados) y aprieta uno de los cuatro botones;
// vuelven a su lugar cuando se deja de escribir.
export function useArcadeDeck() {
  const [state, setState] = useState<DeckState>({ stick: { left: 0, right: 0 }, pressed: -1 });
  const release = useRef<ReturnType<typeof setTimeout>>(undefined);

  const pulse = (side: DeckSide) => {
    const angle = [-22, 22, -16, 16][Math.floor(Math.random() * 4)] ?? 0;
    setState((current) => ({
      stick: { ...current.stick, [side]: angle },
      pressed: Math.floor(Math.random() * 4),
    }));
    clearTimeout(release.current);
    release.current = setTimeout(
      () => setState({ stick: { left: 0, right: 0 }, pressed: -1 }),
      220,
    );
  };

  return { ...state, pulse };
}
