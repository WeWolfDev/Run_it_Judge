import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";

import { ArcadeDeck } from "@/components/ArcadeDeck";
import { LoginBackdrop } from "@/components/LoginBackdrop";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useArcadeDeck, type DeckSide } from "@/hooks/use-arcade-deck";
import { nextBackdrop, type BackdropId } from "@/lib/login-backdrop";
import { cn } from "@/lib/utils";
import { setSession } from "@/lib/session";
import { login, register } from "@/lib/api";
import { play } from "@/lib/sfx";

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Acceso | Run It" },
      { name: "description", content: "Accede a tu torneo de programación Run It." },
    ],
  }),
});

// Gabinete arcade: pantalla CRT con el formulario y, abajo, el panel de
// controles que reacciona a lo que se escribe. Estilos en styles.css (login-*).
function LoginPage() {
  const deck = useArcadeDeck();
  return (
    <main className="login-cabinet flex min-h-dvh flex-col overflow-x-clip">
      <div className="login-bezel flex flex-1 p-3 sm:p-6 lg:px-12 lg:pt-8">
        <LoginScreen onKey={deck.pulse} />
      </div>
      <ArcadeDeck stick={deck.stick} pressed={deck.pressed} />
    </main>
  );
}

function LoginScreen({ onKey }: { onKey: (side: DeckSide) => void }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Se elige en el cliente: el SSR no conoce el fondo de la visita anterior y
  // elegirlo ahí haría que el HTML no coincida con el primer render.
  const [backdrop, setBackdrop] = useState<BackdropId | null>(null);

  useEffect(() => {
    setBackdrop(nextBackdrop());
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (username.trim().length < 3) {
      setError("Ingresa un nombre de usuario de al menos 3 caracteres.");
      return;
    }

    // Matches ACCESS_CODE_LENGTH in run-it-backend/index.js. The old floor of 8
    // came from the retired 22-character codes and silently blocked the
    // 6-character PINs, so the form could never submit one.
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
      setSession({ username: result.user.username, role: result.user.role, token: result.token });
      await navigate({ to: result.user.role === "admin" ? "/admin" : "/participante" });
    } catch (requestError) {
      play("error");
      setError(requestError instanceof Error ? requestError.message : "No se pudo iniciar sesión");
      setLoading(false);
    }
  };

  return (
    <section className="login-screen relative flex min-h-[480px] flex-1 items-center justify-center overflow-hidden">
      <div className="login-glass pointer-events-none absolute inset-0">
        {backdrop && <LoginBackdrop id={backdrop} />}
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
            onKeyDown={() => onKey("left")}
            placeholder="Nombre de usuario"
            autoComplete="username"
            className="login-field"
          />
          <div className="relative">
            <Input
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              onKeyDown={() => onKey("right")}
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
              <Link to="/reglas" className="text-primary hover:underline">
                reglas del torneo
              </Link>
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

          <Link
            to="/pista"
            className="block text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Ver la pista como espectador
          </Link>
        </form>
      </div>
    </section>
  );
}
