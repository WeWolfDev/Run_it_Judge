import type { DeckState } from "@/hooks/use-arcade-deck";
import { cn } from "@/lib/utils";

// Dos botones por lado con los colores de la paleta activa; los de la derecha en
// espejo. Se usa --secondary y no --accent porque en los colores base de :root
// --accent es igual a --primary.
const LEFT_BUTTONS = ["var(--primary)", "var(--secondary)"];
const RIGHT_BUTTONS = ["var(--secondary)", "var(--primary)"];

// Panel del gabinete: sticks en los extremos, que suben por encima del borde de
// la pantalla, y dos botones junto a cada uno. Es bajo para que la pantalla
// quede grande.
export function ArcadeDeck({ stick, pressed }: DeckState) {
  return (
    <div className="login-deck relative z-20 px-4 pb-4 pt-3 sm:px-10 sm:pb-5 lg:px-16">
      <div className="mx-auto flex max-w-6xl items-end justify-between">
        <div className="flex items-end gap-3 sm:gap-8 lg:gap-12">
          <StickSlot angle={stick.left} />
          <Buttons colors={LEFT_BUTTONS} offset={0} pressed={pressed} />
        </div>
        <div className="flex items-end gap-3 sm:gap-8 lg:gap-12">
          <Buttons colors={RIGHT_BUTTONS} offset={2} pressed={pressed} />
          <StickSlot angle={stick.right} />
        </div>
      </div>
    </div>
  );
}

// Hueco del alto de los botones: el stick se apoya abajo y sobresale hacia
// arriba, encima de la pantalla, sin agrandar el panel.
function StickSlot({ angle }: { angle: number }) {
  return (
    <div className="relative h-11 w-[5.5rem] shrink-0 sm:h-16 sm:w-[10rem] lg:h-20 lg:w-[13rem]">
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
        <Joystick angle={angle} />
      </div>
    </div>
  );
}

function Joystick({ angle }: { angle: number }) {
  return (
    // Caja más ancha que el dibujo (x de -20 a 80): inclinado ±22°, la bola llega
    // a ~37 unidades del eje y no se corta.
    <svg
      viewBox="-20 0 100 90"
      overflow="visible"
      className="block h-20 w-auto sm:h-40 lg:h-52"
      aria-hidden
    >
      <ellipse cx="30" cy="80" rx="26" ry="8" fill="#0e0a0c" />
      <ellipse cx="30" cy="77" rx="20" ry="6" fill="#2a2326" />
      <g
        style={{
          transform: `rotate(${angle}deg)`,
          transformOrigin: "30px 77px",
          transition: "transform 80ms steps(2)",
        }}
      >
        <rect x="27" y="30" width="6" height="47" fill="#3b3438" />
        <rect x="27" y="30" width="2" height="47" fill="#5a5156" />
        <circle cx="30" cy="22" r="16" fill="var(--primary)" />
        <circle cx="30" cy="22" r="16" fill="black" opacity="0.25" />
        <circle cx="30" cy="20" r="14" fill="var(--primary)" />
        <rect x="21" y="11" width="6" height="5" fill="white" opacity="0.55" />
      </g>
    </svg>
  );
}

function Buttons({
  colors,
  offset,
  pressed,
}: {
  colors: string[];
  offset: number;
  pressed: number;
}) {
  return (
    <div className="flex items-end gap-2 sm:gap-6 lg:gap-10">
      {colors.map((color, i) => {
        const down = pressed === offset + i;
        return (
          <svg
            key={`${color}-${i}`}
            viewBox="0 0 40 30"
            overflow="visible"
            // En celular queda un botón por lado para que entre todo.
            className={cn("h-11 w-auto sm:h-14 lg:h-20", i === 1 && "hidden sm:block")}
            aria-hidden
          >
            <ellipse cx="20" cy="22" rx="18" ry="7" fill="#0e0a0c" />
            <ellipse cx="20" cy={down ? 20 : 17} rx="15" ry="6" fill={color} />
            <ellipse cx="20" cy={down ? 20 : 17} rx="15" ry="6" fill="black" opacity="0.3" />
            <rect x="5" y={down ? 14 : 9} width="30" height={down ? 6 : 8} fill={color} />
            <ellipse cx="20" cy={down ? 14 : 9} rx="15" ry="6" fill={color} />
            <rect x="12" y={down ? 11 : 6} width="5" height="3" fill="white" opacity="0.5" />
          </svg>
        );
      })}
    </div>
  );
}
