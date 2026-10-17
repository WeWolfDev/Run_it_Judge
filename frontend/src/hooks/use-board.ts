import { useCallback, useState } from "react";

// Estado de la pizarra del caster (components/caster/Whiteboard.tsx): los
// elementos dibujados y el historial para deshacer y rehacer. Vive en el padre,
// así lo dibujado sobrevive al cambiar entre la pista y la pizarra.

export type BoardItem =
  | {
      id: number;
      kind: "stroke";
      color: string;
      size: number;
      erase: boolean;
      points: number[];
    }
  | {
      id: number;
      kind: "text";
      x: number;
      y: number;
      text: string;
      color: string;
      size: number;
    }
  | {
      id: number;
      kind: "code";
      x: number;
      y: number;
      title: string;
      code: string;
    };

type BoardState = {
  items: BoardItem[];
  past: BoardItem[][];
  future: BoardItem[][];
};

let nextId = 1;

/** Id para un elemento nuevo de la pizarra. */
export const nextBoardId = () => nextId++;

/** Estado de la pizarra con deshacer/rehacer. Vive en el padre: sobrevive al cambiar de pestaña. */
export function useBoard() {
  const [board, setBoard] = useState<BoardState>({
    items: [],
    past: [],
    future: [],
  });
  const commit = useCallback(
    (change: (items: BoardItem[]) => BoardItem[]) =>
      setBoard((current) => ({
        items: change(current.items),
        past: [...current.past, current.items].slice(-100),
        future: [],
      })),
    [],
  );
  const undo = useCallback(
    () =>
      setBoard((current) =>
        current.past.length
          ? {
              items: current.past[current.past.length - 1]!,
              past: current.past.slice(0, -1),
              future: [current.items, ...current.future],
            }
          : current,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setBoard((current) =>
        current.future.length
          ? {
              items: current.future[0]!,
              past: [...current.past, current.items],
              future: current.future.slice(1),
            }
          : current,
      ),
    [],
  );
  /** Pega un bloque de código (desde el visor de envíos), debajo del último. */
  const addCode = useCallback(
    (title: string, code: string) =>
      commit((items) => {
        const blocks = items.filter((item) => item.kind === "code").length;
        return [
          ...items,
          {
            id: nextId++,
            kind: "code",
            x: 40 + blocks * 30,
            y: 40 + blocks * 30,
            title,
            code,
          },
        ];
      }),
    [commit],
  );
  return { board, commit, undo, redo, addCode };
}

export type Board = ReturnType<typeof useBoard>;
