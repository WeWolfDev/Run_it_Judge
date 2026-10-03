import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { login, register } from "@/lib/api";
import { play } from "@/lib/sfx";
import { PALETTES, applyPalette, storedPalette } from "../shell/DemoShell";
import { BACKDROP_OPTIONS, Backdrop, type BackdropId } from "./Backdrop";

// DEMO: dos distribuciones del login para elegir antes de pasarlo a
// src/routes/login.tsx. 1 = gabinete con panel de controles, 2 = solo pantalla.
type Layout = "gabinete" | "pantalla";
const LAYOUT_KEY = "run-it-login-layout";
const BACKGROUNDS = ["/bg-1.png", "/bg-3.png", "/bg-4.png"];
const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

const BACKDROP_KEY = "run-it-login-backdrop";

// Fondos que entran en la rotación (la imagen fija queda solo para comparar).
const ROTATION = BACKDROP_OPTIONS.map((o) => o.id).filter((id) => id !== "original");

// Cada vez que alguien entra al login le toca un fondo al azar, distinto del de
// la vez anterior en ese navegador.
function nextBackdrop(): BackdropId {
  let last: string | null = null;
  try {
    last = localStorage.getItem(BACKDROP_KEY);
  } catch {
    /* sin almacenamiento: cualquiera sirve */
  }
  const options = ROTATION.filter((id) => id !== last);
  const pick = options[Math.floor(Math.random() * options.length)] ?? "arcade";
  try {
    localStorage.setItem(BACKDROP_KEY, pick);
  } catch {
    /* sin almacenamiento */
  }
  return pick;
}

function storedLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "pantalla" ? "pantalla" : "gabinete";
  } catch {
    return "gabinete";
  }
}

export function LoginDemo() {
  const [layout, setLayout] = useState<Layout>(storedLayout);
  const [backdrop, setBackdrop] = useState<BackdropId>(nextBackdrop);
  // Cada tecla inclina un joystick (grados) y aprieta un botón; se mantiene
  // mientras se sigue escribiendo.
  const [stick, setStick] = useState({ left: 0, right: 0 });
  const [pressed, setPressed] = useState(-1);
  const release = useRef<ReturnType<typeof setTimeout>>(undefined);

  const pulse = (side: "left" | "right") => {
    setStick((s) => ({ ...s, [side]: [-22, 22, -16, 16][Math.floor(Math.random() * 4)] }));
    setPressed(Math.floor(Math.random() * 4));
    clearTimeout(release.current);
    release.current = setTimeout(() => {
      setStick({ left: 0, right: 0 });
      setPressed(-1);
    }, 220);
  };

  const choose = (next: Layout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* sin almacenamiento */
    }
  };

  const screen = <Screen onKey={pulse} backdrop={backdrop} />;

  return (
    <>
      {layout === "gabinete" ? (
        <main className="login-cabinet flex min-h-dvh flex-col overflow-x-clip">
          <div className="login-bezel flex flex-1 p-3 sm:p-6 lg:px-12 lg:pt-8">{screen}</div>
          <ControlDeck stick={stick} pressed={pressed} />
        </main>
      ) : (
        <main className="login-cabinet flex min-h-dvh flex-col overflow-x-clip">
          <div className="login-bezel flex flex-1 flex-col p-3 sm:p-6 lg:px-12 lg:py-8">{screen}</div>
        </main>
      )}
      <DemoSwitch
        layout={layout}
        onChange={choose}
        backdrop={backdrop}
        onBackdrop={(next) => {
          setBackdrop(next);
          try {
            localStorage.setItem(BACKDROP_KEY, next);
          } catch {
            /* sin almacenamiento */
          }
        }}
      />
    </>
  );
}

// Pantalla CRT: fondo pixel, título y formulario. Es igual en las dos distribuciones.
function Screen({
  onKey,
  backdrop,
}: {
  onKey: (side: "left" | "right") => void;
  backdrop: BackdropId;
}) {
  const [background, setBackground] = useState(BACKGROUNDS[0]);
  const [username, setUsername] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<{ username: string; role: string } | null>(null);
  const keyFor = (side: "left" | "right") => () => onKey(side);

  useEffect(() => {
    setBackground(BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)]);
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (username.trim().length < 3) {
      setError("Ingresa un nombre de usuario de al menos 3 caracteres.");
      return;
    }
    if (accessCode.trim().length < 6) {
      setError("Ingresa tu código de acceso (6 caracteres).");
      return;
    }
    if (!acceptedRules) {
      setError("Acepta las reglas del torneo para continuar.");
      return;
    }
    setError("");
    setLoading(true);
    play("click");
    try {
      const result = registerMode
        ? await register(username.trim(), accessCode.trim())
        : await login(username.trim(), accessCode.trim());
      play("coin");
      setReady(result.user);
    } catch (requestError) {
      play("error");
      setError(requestError instanceof Error ? requestError.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="login-screen relative flex min-h-[480px] flex-1 items-center justify-center overflow-hidden">
      <div className="login-glass pointer-events-none absolute inset-0">
        {backdrop === "original" ? (
          <img
            src={background}
            alt=""
            className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
          />
        ) : (
          <Backdrop id={backdrop} />
        )}
        <div className="absolute inset-0 bg-black/35" />
        <div className="login-scanlines absolute inset-0" />
        <div className="run-it-crt-sweep" />
        <div className="login-vignette absolute inset-0" />
      </div>

      <div className="relative z-10 flex w-full flex-col items-center gap-6 px-4 py-10">
        <h1
          className="login-title text-center text-4xl text-primary sm:text-6xl lg:text-7xl"
          style={PIXEL}
        >
          Run It
        </h1>

        {ready ? (
          <div className="animate-run-it-pop w-full max-w-[320px] border-2 border-primary bg-card/90 p-5 text-center shadow-[6px_6px_0_0_var(--primary)]">
            <p className="text-xs text-accent" style={PIXEL}>
              Player 1 ready
            </p>
            <p className="mt-3 text-sm text-foreground">
              Hola, <b>{ready.username}</b>. En la app entrarías a{" "}
              <code className="text-primary">
                {ready.role === "admin" ? "/admin" : "/participante"}
              </code>
              .
            </p>
            <button
              type="button"
              onClick={() => setReady(null)}
              className="mt-4 text-xs text-muted-foreground underline hover:text-foreground"
            >
              Volver al login
            </button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="w-full max-w-[320px] space-y-3 border-2 border-primary bg-card/85 p-4 shadow-[6px_6px_0_0_var(--primary)] backdrop-blur-sm"
          >
            <p className="text-center text-[10px] text-accent" style={PIXEL}>
              {registerMode ? "Nuevo jugador" : "Login"}
            </p>
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={keyFor("left")}
              placeholder="Nombre de usuario"
              autoComplete="username"
              className="login-field"
            />
            <div className="relative">
              <Input
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                onKeyDown={keyFor("right")}
                type={showCode ? "text" : "password"}
                placeholder="Código de acceso"
                className={cn("login-field pr-10", error && "border-destructive")}
              />
              <button
                type="button"
                onClick={() => setShowCode((visible) => !visible)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showCode ? "Ocultar código" : "Mostrar código"}
              >
                {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="rules"
                checked={acceptedRules}
                onCheckedChange={(checked) => setAcceptedRules(checked === true)}
              />
              <Label
                htmlFor="rules"
                className="text-xs font-normal leading-relaxed text-muted-foreground"
              >
                Acepto las{" "}
                <a href="#reglas" className="text-primary hover:underline">
                  reglas del torneo
                </a>
              </Label>
            </div>
            {error && <p className="animate-run-it-shake text-xs text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="login-start w-full bg-primary py-2.5 text-[11px] text-primary-foreground disabled:opacity-60"
              style={PIXEL}
            >
              {loading ? "Cargando..." : registerMode ? "Crear acceso" : "Press start"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRegisterMode((mode) => !mode);
                setError("");
              }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {registerMode ? "Ya tengo un acceso" : "Registrarme con un código"}
            </button>
            <a
              href="#pista"
              className="block text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Ver la pista como espectador
            </a>
          </form>
        )}
      </div>
    </section>
  );
}

// Dos botones por lado, con los colores de la paleta activa; los de la derecha
// en espejo. Se usa --secondary y no --accent porque en la paleta original
// --accent es igual a --primary.
const LEFT_BUTTONS = ["var(--primary)", "var(--secondary)"];
const RIGHT_BUTTONS = ["var(--secondary)", "var(--primary)"];

// Distribución 1 (DistribucionButtons.png): sticks en los extremos, que suben
// por encima del borde de la pantalla, y dos botones junto a cada uno. El panel
// es bajo para que la pantalla quede grande.
function ControlDeck({ stick, pressed }: { stick: { left: number; right: number }; pressed: number }) {
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

// Selector flotante de la demo: no es parte de la app.
function DemoSwitch({
  layout,
  onChange,
  backdrop,
  onBackdrop,
}: {
  layout: Layout;
  onChange: (l: Layout) => void;
  backdrop: BackdropId;
  onBackdrop: (b: BackdropId) => void;
}) {
  const [palette, setPalette] = useState(storedPalette);
  const option = (value: Layout, label: ReactNode) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={cn(
        "rounded-md px-2.5 py-1",
        layout === value ? "bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
  return (
    <aside className="fixed right-3 top-3 z-50 flex flex-wrap items-center gap-2 rounded-lg border-2 border-dashed border-primary bg-card/95 p-2 text-xs text-foreground shadow-xl">
      <span className="font-semibold text-primary">Demo</span>
      {option("gabinete", "1 · Gabinete")}
      {option("pantalla", "2 · Pantalla")}
      <select
        value={backdrop}
        onChange={(event) => onBackdrop(event.target.value as BackdropId)}
        className="rounded-md border border-input bg-background px-1.5 py-1"
        aria-label="Fondo animado"
      >
        {BACKDROP_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select
        value={palette}
        onChange={(event) => {
          setPalette(event.target.value);
          applyPalette(event.target.value);
        }}
        className="rounded-md border border-input bg-background px-1.5 py-1"
      >
        {PALETTES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </aside>
  );
}
