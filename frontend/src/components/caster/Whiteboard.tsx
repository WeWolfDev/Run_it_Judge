import { useCallback, useEffect, useRef, useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import { nextBoardId, type Board, type BoardItem } from "@/hooks/use-board";
import { cn } from "@/lib/utils";

// Pizarra del caster: ocupa el lugar de la pista (16:9) para explicar la
// solución en la transmisión. Trazos a mano (mouse, dedo o lápiz con presión),
// texto, borrador y bloques de código traídos desde el visor de envíos.
// Se dibuja en coordenadas fijas de 1600×900, así no cambia al redimensionar.

const W = 1600;
const H = 900;
const COLORS = ["#f5f5f5", "#ffd34d", "#4ade80", "#f87171", "#60a5fa", "#a78bfa"];
const SIZES = [4, 8, 16];
const BACKGROUNDS = [
  { id: "grid", label: "Cuadrícula" },
  { id: "dots", label: "Puntos" },
  { id: "plain", label: "Lisa" },
] as const;

type Tool = "pen" | "eraser" | "text" | "move";
type Background = (typeof BACKGROUNDS)[number]["id"];

const CODE_FONT = 19;
const CODE_LINE = 26;
/** Ancho de la columna de números de línea. */
const GUTTER = 3.4 * CODE_FONT;

/** Rectángulo que ocupa un texto o bloque de código, para moverlo. */
function boxOf(ctx: CanvasRenderingContext2D, item: BoardItem) {
  if (item.kind === "text") {
    ctx.font = `600 ${item.size}px Inter, system-ui, sans-serif`;
    const lines = item.text.split("\n");
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
    return {
      x: item.x,
      y: item.y,
      w: width,
      h: lines.length * item.size * 1.25,
    };
  }
  if (item.kind === "code") {
    ctx.font = `${CODE_FONT}px "JetBrains Mono", ui-monospace, monospace`;
    const lines = item.code.replace(/\s+$/, "").split("\n");
    const width = Math.max(
      ctx.measureText(item.title).width,
      ...lines.map((line) => ctx.measureText(line.replace(/\t/g, "    ")).width),
    );
    return {
      x: item.x,
      y: item.y,
      w: width + 36 + GUTTER,
      h: (lines.length + 1) * CODE_LINE + 36,
    };
  }
  return null;
}

function drawItem(ctx: CanvasRenderingContext2D, item: BoardItem) {
  if (item.kind === "stroke") {
    const p = item.points;
    ctx.save();
    ctx.globalCompositeOperation = item.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = item.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (p.length <= 2) {
      ctx.beginPath();
      ctx.arc(p[0]!, p[1]!, item.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Curvas por los puntos medios: el trazo sale suave aunque el mouse salte.
      ctx.beginPath();
      ctx.moveTo(p[0]!, p[1]!);
      for (let i = 2; i < p.length - 2; i += 2) {
        const mx = (p[i]! + p[i + 2]!) / 2;
        const my = (p[i + 1]! + p[i + 3]!) / 2;
        ctx.quadraticCurveTo(p[i]!, p[i + 1]!, mx, my);
      }
      ctx.lineTo(p[p.length - 2]!, p[p.length - 1]!);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (item.kind === "text") {
    ctx.font = `600 ${item.size}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = item.color;
    ctx.textBaseline = "top";
    item.text.split("\n").forEach((line, i) => {
      ctx.fillText(line, item.x, item.y + i * item.size * 1.25);
    });
    return;
  }
  const box = boxOf(ctx, item)!;
  ctx.save();
  ctx.fillStyle = "rgba(8, 6, 18, 0.92)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 12);
  ctx.fill();
  ctx.stroke();
  ctx.font = `${CODE_FONT}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText(item.title, box.x + 18, box.y + 16);
  ctx.fillStyle = "#e8e6f0";
  item.code
    .replace(/\s+$/, "")
    .split("\n")
    .forEach((line, i) => {
      const y = box.y + 16 + (i + 1) * CODE_LINE + 6;
      ctx.fillStyle = "rgba(232, 230, 240, 0.35)";
      ctx.fillText(String(i + 1).padStart(2, " "), box.x + 18, y);
      ctx.fillStyle = "#e8e6f0";
      ctx.fillText(line.replace(/\t/g, "    "), box.x + 18 + GUTTER, y);
    });
  ctx.restore();
}

export function Whiteboard({ board }: { board: Board }) {
  const { items } = board.board;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[1]!);
  const [size, setSize] = useState(SIZES[1]!);
  const [background, setBackground] = useState<Background>("grid");
  const [draft, setDraft] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const live = useRef<BoardItem | null>(null);
  const drag = useRef<{
    id: number;
    dx: number;
    dy: number;
    moved: BoardItem[];
  } | null>(null);
  const [, repaint] = useState(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const shown = drag.current?.moved ?? items;
    shown.forEach((item) => drawItem(ctx, item));
    if (live.current) drawItem(ctx, live.current);
  }, [items]);

  useEffect(draw, [draw]);
  // Las fuentes del bloque de código pueden llegar después del primer dibujo.
  useEffect(() => {
    void document.fonts?.ready.then(draw);
  }, [draw]);

  const point = (event: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * W,
      y: ((event.clientY - rect.top) / rect.height) * H,
    };
  };

  const onDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = point(event);
    if (tool === "text") {
      // Sin esto el clic le saca el foco al cuadro de texto recién abierto.
      event.preventDefault();
      if (draft?.text.trim()) commitDraft();
      setDraft({ x, y, text: "" });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "move") {
      const ctx = canvasRef.current!.getContext("2d")!;
      const hit = [...items].reverse().find((item) => {
        const box = boxOf(ctx, item);
        return box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
      });
      if (hit && hit.kind !== "stroke")
        drag.current = {
          id: hit.id,
          dx: x - hit.x,
          dy: y - hit.y,
          moved: items,
        };
      return;
    }
    const pressure = event.pointerType === "pen" ? 0.5 + event.pressure : 1;
    live.current = {
      id: nextBoardId(),
      kind: "stroke",
      color,
      size: tool === "eraser" ? size * 4 : size * pressure,
      erase: tool === "eraser",
      points: [x, y],
    };
    draw();
  };

  const onMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current) {
      const { x, y } = point(event);
      const { id, dx, dy } = drag.current;
      drag.current.moved = items.map((item) =>
        item.id === id && item.kind !== "stroke" ? { ...item, x: x - dx, y: y - dy } : item,
      );
      draw();
      return;
    }
    if (live.current?.kind !== "stroke") return;
    const { x, y } = point(event);
    live.current.points.push(x, y);
    draw();
  };

  const onUp = () => {
    if (drag.current) {
      const moved = drag.current.moved;
      drag.current = null;
      if (moved !== items) board.commit(() => moved);
      return;
    }
    const stroke = live.current;
    live.current = null;
    if (stroke) board.commit((current) => [...current, stroke]);
    repaint((n) => n + 1);
  };

  const commitDraft = () => {
    if (draft?.text.trim()) {
      const item: BoardItem = {
        id: nextBoardId(),
        kind: "text",
        x: draft.x,
        y: draft.y,
        text: draft.text,
        color,
        size: size * 4 + 12,
      };
      board.commit((current) => [...current, item]);
    }
    setDraft(null);
  };

  // Ctrl/Cmd + Z deshace, con Shift rehace (salvo mientras se escribe un texto).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (draft || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) board.redo();
      else board.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board, draft]);

  const button = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border text-foreground hover:bg-muted",
    );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <div className="flex gap-1.5" role="toolbar" aria-label="Herramientas">
          {(
            [
              ["pen", "Lápiz"],
              ["eraser", "Borrador"],
              ["text", "Texto"],
              ["move", "Mover"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                commitDraft();
                setTool(id);
              }}
              className={button(tool === id)}
              aria-pressed={tool === id}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5" aria-label="Color">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              className={cn(
                "h-6 w-6 rounded-full border-2",
                color === c ? "border-foreground" : "border-transparent",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5" aria-label="Grosor">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              aria-label={`Grosor ${s}`}
              aria-pressed={size === s}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-md border",
                size === s ? "border-primary" : "border-border",
              )}
            >
              <span
                className="rounded-full bg-foreground"
                style={{ width: s / 2 + 3, height: s / 2 + 3 }}
              />
            </button>
          ))}
        </div>
        <select
          value={background}
          onChange={(event) => setBackground(event.target.value as Background)}
          aria-label="Fondo"
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
        >
          {BACKGROUNDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={board.undo}
            disabled={!board.board.past.length}
            className={cn(button(false), "disabled:opacity-40")}
            title="Deshacer (Ctrl/Cmd + Z)"
          >
            Deshacer
          </button>
          <button
            type="button"
            onClick={board.redo}
            disabled={!board.board.future.length}
            className={cn(button(false), "disabled:opacity-40")}
            title="Rehacer (Ctrl/Cmd + Shift + Z)"
          >
            Rehacer
          </button>
          <button
            type="button"
            onClick={() => board.commit(() => [])}
            disabled={!items.length}
            className={cn(button(false), "disabled:opacity-40")}
          >
            <PixelIcon name="close" className="h-3.5 w-3.5" /> Limpiar
          </button>
        </div>
      </div>

      <div
        className={cn(
          "caster-board relative overflow-hidden rounded-lg border border-border [container-type:inline-size]",
          `caster-board-${background}`,
        )}
      >
        <canvas
          ref={canvasRef}
          width={W * 2}
          height={H * 2}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className={cn(
            "block aspect-video w-full touch-none",
            tool === "text" ? "cursor-text" : tool === "move" ? "cursor-move" : "cursor-crosshair",
          )}
          aria-label="Pizarra"
        />
        {draft && (
          <textarea
            autoFocus
            value={draft.text}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commitDraft();
              }
              if (event.key === "Escape") setDraft(null);
            }}
            placeholder="Escribe y pulsa Enter"
            rows={1}
            className="absolute min-w-[12rem] resize-none border border-dashed border-foreground/50 bg-transparent p-0 font-semibold outline-none"
            style={{
              left: `${(draft.x / W) * 100}%`,
              top: `${(draft.y / H) * 100}%`,
              color,
              // Mismo tamaño que tendrá en el canvas: el ancho del recuadro es W.
              fontSize: `${((size * 4 + 12) / W) * 100}cqw`,
            }}
          />
        )}
        {!items.length && !draft && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            Dibuja con el mouse, el dedo o un lápiz · trae código con "Llevar a la pizarra"
          </p>
        )}
      </div>
    </div>
  );
}
