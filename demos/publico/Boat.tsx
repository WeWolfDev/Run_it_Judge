import { cn } from "@/lib/utils";
import { Figure, useSpriteBounds } from "./fit";
import { Banner, PIXEL, Stage, TESTS, passedOf, useFinale, useSize, zoneOf, type ViewInfo, type ViewProps } from "./shared";

// DEMO: el bote salvavidas. En el bote caben exactamente los del cupo: los
// mejores puestos van sentados. El resto nada en fila esperando un lugar, el
// primero de la fila al lado del bote. Al terminar el tiempo el bote zarpa con
// los que están arriba.

export const BOAT: ViewInfo = {
  id: "bote",
  name: "El bote salvavidas",
  rule: "En el bote caben los del cupo: los mejores puestos van arriba. El resto nada en fila esperando un lugar. Al terminar el tiempo, el bote zarpa.",
  goal: "aseguró su lugar en el bote",
  ending: "el bote zarpó",
  legend: (capacity) => [
    `En el bote caben ${capacity}: los mejores puestos`,
    "Con salvavidas dorado = ya resolvió, nadie lo baja",
    "Al terminar el tiempo el bote zarpa",
  ],
};

const FINALE = [1600, 3000, 2600];
/** Asientos por fila del bote. */
const PER_ROW = 8;

export function BoatView(props: ViewProps) {
  const { round, board } = props;
  const step = useFinale(round.closed, FINALE);
  const [ref, size] = useSize<HTMLDivElement>();
  useSpriteBounds(board.map((e) => e.character));

  const capacity = round.capacity;
  const aboard = board.slice(0, capacity);
  const swimmers = board.slice(capacity);
  const solved = aboard.filter((e) => e.solved_at).length;
  const seatRows = Math.ceil(capacity / PER_ROW);
  const perRow = Math.min(PER_ROW, capacity);
  const boatW = size.width * 0.44;
  const seatW = (boatW * 0.86) / perRow;
  const room = Math.max(16, Math.min(seatW * 0.8, 44, (size.height * 0.36) / seatRows));
  const swimArea = size.width - boatW - size.width * 0.08;
  const swimCols = Math.max(3, Math.floor(swimArea / Math.max(46, room * 1.5)));
  const swimW = swimArea / swimCols;
  const swimRoom = Math.max(14, Math.min(swimW * 0.6, 38));
  const sailing = step >= 1;

  return (
    <Stage view={BOAT} {...props} step={step} summaryStep={FINALE.length}>
      <div ref={ref} className="pub-sea relative h-full overflow-hidden rounded-xl">
        {/* Nubes en pixel art propio. */}
        <span className="pointer-events-none absolute inset-x-0 top-[2%] flex justify-around" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Cloud key={i} width={Math.max(60, size.width * 0.08)} />
          ))}
        </span>
        <span className="pub-waves absolute inset-0" />

        {/* El bote: pasajeros arriba, casco abajo y el cartel con el cupo. */}
        <div
          className={cn("pub-boat absolute flex flex-col items-center", sailing && "pub-boat-sail")}
          style={{ left: size.width * 0.03, width: boatW, top: size.height * 0.18 }}
        >
          <span className="pub-boat-sign mb-[0.6vw] px-[0.8vw] py-[0.3vw] text-[clamp(0.6rem,0.95vw,1.3rem)]" style={PIXEL}>
            Caben {capacity} · {solved} asegurado{solved === 1 ? "" : "s"}
          </span>
          <div className="flex flex-col gap-[0.3vw]">
            {Array.from({ length: seatRows }, (_, r) => (
              <div key={r} className="flex items-end justify-center">
                {Array.from({ length: perRow }, (_, s) => {
                  const i = r * perRow + s;
                  if (i >= capacity) return <span key={s} style={{ width: seatW }} />;
                  const entry = aboard[i];
                  if (!entry) {
                    // Lugar libre: todavía no hay quien lo ocupe.
                    return (
                      <span key={s} className="flex justify-center" style={{ width: seatW }}>
                        <span className="pub-seat-free" style={{ width: room * 0.8, height: room }} />
                      </span>
                    );
                  }
                  const state = zoneOf(entry, i + 1, capacity, round.closed);
                  return (
                    <span key={entry.participant_id} className="animate-run-it-pop flex flex-col items-center" style={{ width: seatW }}>
                      <span className="pub-name pub-name-in max-w-full truncate px-[2px] text-[clamp(0.45rem,0.55vw,0.8rem)]" style={{ maxWidth: seatW - 4 }}>
                        {entry.display_name}
                      </span>
                      <span className={cn("relative", state === "zone" && "pub-seat-risk")}>
                        {state === "in" && <span className="pub-ring" />}
                        <Figure index={entry.character} room={room} state={sailing ? "run" : "idle"} />
                      </span>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <Hull width={boatW} />
        </div>

        {/* Los que nadan, en fila: el primero (siguiente en subir) junto al bote. */}
        <div className="absolute" style={{ left: boatW + size.width * 0.06, top: size.height * 0.16, width: swimArea }}>
          {swimmers.map((entry, j) => {
            const rank = capacity + j + 1;
            const col = j % swimCols;
            const row = Math.floor(j / swimCols);
            const next = j === 0 && !round.closed;
            return (
              <div
                key={entry.participant_id}
                className={cn("pub-swimmer absolute flex flex-col items-center", sailing && "pub-swimmer-left")}
                style={{ left: col * swimW, top: row * swimRoom * 2.3, width: swimW, animationDelay: `${(j % 5) * 0.2}s` }}
              >
                {/* El primero de la fila: el que sube si alguien de arriba lo deja. */}
                <span
                  className={cn("pub-name max-w-full truncate px-[2px] text-[clamp(0.45rem,0.55vw,0.8rem)]", next && "pub-next-tag")}
                  style={{ maxWidth: swimW - 6 }}
                  title={`${rank}. ${entry.display_name} · ${passedOf(entry)}/${TESTS}`}
                >
                  {next ? "▶ " : ""}
                  {rank}. {entry.display_name}
                </span>
                <span className="pub-in-water relative overflow-hidden" style={{ height: swimRoom * 0.75 }}>
                  <Figure index={entry.character} room={swimRoom} state={sailing ? "out" : "idle"} />
                </span>
              </div>
            );
          })}
        </div>

        {step === 0 && <Banner tone="danger">{board.filter((e) => e.solved_at).length >= capacity ? "¡Cupo lleno!" : "¡Tiempo!"}</Banner>}
        {step === 1 && <Banner tone="accent">¡El bote zarpa!</Banner>}
        {step === 2 && <Banner tone="success">Pasan {capacity}</Banner>}
      </div>
    </Stage>
  );
}

// Casco del bote en pixel art propio (160×32): proa a la izquierda (zarpa
// hacia allá), baranda, tablones, franja blanca, tres salvavidas y el mástil
// con la bandera en el color de la paleta. Escalado sin suavizado.
function Hull({ width }: { width: number }) {
  return (
    <svg
      width={width}
      height={width * 0.2}
      viewBox="0 0 160 32"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="pub-hull-svg"
    >
      {/* Mástil y bandera. */}
      <path fill="#5a3214" d="M146 0h2v14h-2z" />
      <path className="pub-flag" d="M134 1h12v7h-12z" />
      <path fill="#fff" d="M136 3h2v3h-2zM140 3h2v3h-2z" />
      {/* Baranda. */}
      <path fill="#5a3214" d="M2 10h156v2H2zM8 12h2v2H8zM40 12h2v2h-2zM72 12h2v2h-2zM104 12h2v2h-2zM136 12h2v2h-2z" />
      {/* Casco: proa alta a la izquierda y fondo más angosto. */}
      <path fill="#b4471f" d="M0 8h4v2h2v4h150v2h2v4h-2v4h-2v4h-4v2H22v-2h-6v-2h-4v-2H8v-4H4v-4H2v-4H0z" />
      {/* Tablones y sombra. */}
      <path fill="#8e3414" d="M4 18h152v1H4zM8 23h146v1H8zM20 28h130v1H20z" />
      <path fill="#fff" d="M4 15h152v2H4z" />
      <path fill="#3a1d08" d="M0 8h4v1H0zM22 31h128v1H22z" />
      {/* Salvavidas colgados del costado. */}
      {[28, 76, 124].map((x) => (
        <g key={x}>
          <path fill="#fff" d={`M${x} 17h6v1h1v4h-1v1h-6v-1h-1v-4h1z`} />
          <path fill="#ff4d4d" d={`M${x + 2} 17h2v1h-2zM${x + 2} 22h2v1h-2zM${x - 1} 19h1v2h-1zM${x + 6} 19h1v2h-1z`} />
          <path fill="#1f6fb2" d={`M${x + 2} 19h2v2h-2z`} />
        </g>
      ))}
    </svg>
  );
}

// Nube en pixel art propio (24×10), blanca con sombra celeste.
function Cloud({ width }: { width: number }) {
  return (
    <svg width={width} height={width * (10 / 24)} viewBox="0 0 24 10" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#fff" d="M8 0h5v1h2v2h3v1h2v2h2v3H1V7h1V5h2V3h2V1h2z" />
      <path fill="#cfe6f5" d="M1 8h21v1H1zM3 7h2v1H3zM16 7h3v1h-3z" />
    </svg>
  );
}
