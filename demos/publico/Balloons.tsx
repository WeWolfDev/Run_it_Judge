import { cn } from "@/lib/utils";
import { Figure, useSpriteBounds } from "./fit";
import { Banner, LEVELS, PER_LEVEL, PIXEL, Stage, levelOf, useFinale, useSize, zoneOf, type ViewInfo, type ViewProps } from "./shared";

// DEMO: globos al cielo. Cada jugador cuelga de su globo, en columnas por
// puesto (el 1.º a la izquierda); cada 6 tests resueltos lo suben un nivel y
// con los 30 llega a la nube dorada. El color del globo dice si está dentro del
// cupo. Al terminar, los clasificados suben a la nube y los de afuera se pinchan.

export const BALLOONS: ViewInfo = {
  id: "globos",
  name: "Globos al cielo",
  rule: "Cada 6 tests resueltos suben tu globo un nivel; con los 30 llega a la nube dorada. Globo verde: dentro del cupo. Al terminar, los globos de afuera se pinchan.",
  goal: "llegó a la nube dorada",
  ending: "se pincharon los globos",
  legend: (capacity) => [
    "Cada 6 tests sube el globo un nivel (30 = la nube)",
    `Globo verde o dorado: dentro de los ${capacity} que pasan`,
    "Al terminar, los globos rojos se pinchan",
  ],
};

const FINALE = [1600, 3000, 2600];

export function BalloonsView(props: ViewProps) {
  const { round, board } = props;
  const step = useFinale(round.closed, FINALE);
  const [ref, size] = useSize<HTMLDivElement>();
  useSpriteBounds(board.map((e) => e.character));

  const n = Math.max(1, board.length);
  const capacity = round.capacity;
  const padL = Math.max(48, size.width * 0.06);
  const colW = (size.width - padL - 10) / n;
  const cloudH = size.height * 0.16;
  const ground = size.height * 0.92;
  const top = cloudH * 0.95;
  const levelY = (k: number) => ground - (k / LEVELS) * (ground - top);
  const room = Math.max(12, Math.min(colW * 0.75, 34));
  const balloon = Math.max(12, Math.min(colW * 0.8, 30));
  const arrived = board.filter((e) => e.solved_at).length;

  return (
    <Stage view={BALLOONS} {...props} step={step} summaryStep={FINALE.length}>
      <div ref={ref} className="pub-skyday relative h-full overflow-hidden rounded-xl">
        {/* La nube dorada: la meta, con el cupo. */}
        <div className="pub-goldcloud absolute inset-x-[1%] top-[1%] grid place-items-start justify-center" style={{ height: cloudH }}>
          <span className="pub-goldcloud-tag mt-[0.4vw] px-[0.8vw] py-[0.2vw] text-[clamp(0.55rem,0.8vw,1.1rem)]" style={PIXEL}>
            Nube dorada · caben {capacity} · {step >= 1 ? capacity : arrived} arriba
          </span>
        </div>
        {Array.from({ length: LEVELS - 1 }, (_, k) => k + 1).map((k) => (
          <div key={k} className="pub-level absolute inset-x-0" style={{ top: levelY(k) }}>
            <span className="pub-level-tag" style={PIXEL}>
              {k * PER_LEVEL}
            </span>
          </div>
        ))}
        <div className="pub-meadow absolute inset-x-0 bottom-0" style={{ top: ground }} />

        {board.map((entry, i) => {
          const rank = i + 1;
          const state = zoneOf(entry, rank, capacity, round.closed);
          const up = step >= 1 && entry.final_status === "advanced";
          const popped = step >= 1 && entry.final_status === "eliminated";
          const level = up ? LEVELS : levelOf(entry);
          const y = popped ? ground : levelY(level);
          const color = state === "in" ? "#ffd34d" : state === "zone" ? "#5fd16b" : "#ff4d4d";
          return (
            <div
              key={entry.participant_id}
              className="pub-balloon-col absolute flex flex-col items-center"
              style={{ left: padL + i * colW, width: colW, top: y, transitionDelay: up ? `${i * 60}ms` : popped ? `${(n - i) * 30}ms` : undefined }}
            >
              <div className="flex -translate-y-full flex-col items-center">
                {popped ? (
                  <span className="pub-pop" style={{ width: balloon, height: balloon }} />
                ) : (
                  <Balloon color={color} size={balloon} />
                )}
                <Figure index={entry.character} room={room} state={popped ? "out" : "idle"} />
              </div>
              <span
                className={cn("pub-name absolute whitespace-nowrap", state === "out" ? "pub-name-out" : "pub-name-in")}
                style={{ ...PIXEL, top: ground - y + 6, fontSize: Math.max(8, Math.min(colW * 0.35, 13)) }}
              >
                {rank}
              </span>
            </div>
          );
        })}

        {step === 0 && <Banner tone="danger">{arrived >= capacity ? "¡Cupo lleno!" : "¡Tiempo!"}</Banner>}
        {step === 1 && <Banner tone="accent">¡Suben los clasificados!</Banner>}
        {step === 2 && <Banner tone="success">Pasan {capacity}</Banner>}
      </div>
    </Stage>
  );
}

// Globo en pixel art propio (12×16): cuerpo, brillo, nudo y cuerda.
function Balloon({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size * (16 / 12)} viewBox="0 0 12 16" shapeRendering="crispEdges" aria-hidden="true" className="pub-balloon">
      <path fill={color} d="M4 0h4v1h2v1h1v2h1v4h-1v2h-1v1H8v1H4v-1H2v-1H1V8H0V4h1V2h1V1h2z" />
      <path fill="rgb(255 255 255 / 0.6)" d="M3 2h2v1H3zM2 3h1v2H2z" />
      <path fill="rgb(0 0 0 / 0.25)" d="M9 7h1v2H9zM8 9h1v1H8z" />
      <path fill={color} d="M5 12h2v1H5z" />
      <path fill="#e8e0d0" d="M6 13h1v3H6z" />
    </svg>
  );
}
