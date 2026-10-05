import { LEVELS, PER_LEVEL, TESTS, useFinale, viewInfo, type ViewProps } from "./model";
import { Banner, Stage } from "./Stage";
import { SplitScene, type Cell } from "./SplitScene";

// fútbol, el arco. Cada jugador tiene su arco y cada 6 tests resueltos
// son un gol: una pelota más en la red; con los 30 tests, pelotas de oro. En la tribuna
// VIP caben los del cupo (los mejores puestos); al sonar el silbato final, los
// de la cancha se van.

const FINALE = [1600, 3000, 2600];

export function SoccerView(props: ViewProps) {
  const { round, board } = props;
  const step = useFinale(round.closed, FINALE);
  const whistle = step >= 1;
  return (
    <Stage view={viewInfo("futbol")} {...props} step={step} summaryStep={FINALE.length}>
      <SplitScene
        board={board}
        capacity={round.capacity}
        closed={round.closed}
        insideTitle={`Tribuna VIP · caben ${round.capacity}`}
        insideClass="pub-stands"
        outsideClass="pub-pitch"
        drawing={(cell, size) => <Goal cell={cell} size={size} />}
        outsideCellClass={whistle ? "pub-leaving" : undefined}
      />
      {step === 0 && (
        <Banner tone="danger">
          {board.filter((e) => e.solved_at).length >= round.capacity ? "¡Cupo lleno!" : "¡Tiempo!"}
        </Banner>
      )}
      {step === 1 && <Banner tone="accent">¡Silbato final!</Banner>}
      {step === 2 && <Banner tone="success">Pasan {round.capacity}</Banner>}
    </Stage>
  );
}

// Posición de cada pelota dentro de la red (en unidades del viewBox 20×14).
const BALLS = [
  [3, 9],
  [7, 9],
  [11, 9],
  [5, 5],
  [9, 5],
];

// El arco (pixel art propio, 20×14): palos, red y una pelota por gol (6 tests).
// Con los 30 tests las pelotas se vuelven doradas.
function Goal({ cell, size }: { cell: Cell; size: number }) {
  const goals = Math.min(LEVELS, Math.floor(cell.passed / PER_LEVEL));
  const full = cell.passed >= TESTS;
  return (
    <svg
      width={size}
      height={size * 0.7}
      viewBox="0 0 20 14"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={full ? "pub-built" : undefined}
    >
      {/* Red: cuadrícula. */}
      <path
        fill="rgb(255 255 255 / 0.35)"
        d="M2 2h16v1H2zM2 5h16v1H2zM2 8h16v1H2zM2 11h16v1H2zM4 2h1v11H4zM8 2h1v11H8zM12 2h1v11h-1zM16 2h1v11h-1z"
      />
      {/* Palos y travesaño. */}
      <path fill="#f4f4f4" d="M0 0h20v2H0zM0 2h2v12H0zM18 2h2v12h-2z" />
      {BALLS.slice(0, goals).map(([x, y], i) => (
        <g key={i}>
          <path
            fill={full ? "#ffd34d" : "#fff"}
            d={`M${x! + 1} ${y}h2v1h1v2h-1v1h-2v-1h-1v-2h1z`}
          />
          <path
            fill={full ? "#b8860b" : "#1a1a2a"}
            d={`M${x! + 1} ${y! + 1}h1v1h-1zM${x! + 2} ${y! + 2}h1v1h-1z`}
          />
        </g>
      ))}
    </svg>
  );
}
