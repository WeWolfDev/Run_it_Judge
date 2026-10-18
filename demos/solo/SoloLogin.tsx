import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { ArcadeDeck } from "@/components/ArcadeDeck";
import { LoginBackdrop } from "@/components/LoginBackdrop";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useArcadeDeck, type DeckSide } from "@/hooks/use-arcade-deck";
import { nextBackdrop, type BackdropId } from "@/lib/login-backdrop";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";

// Copia de LoginPage (frontend/src/routes/login.tsx) con el acceso simulado y
// la entrada a la demo solo: un enlace dentro del
// formulario, como texto, para quien no tiene código de acceso.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

export function SoloLogin({
  onLogin,
  onSolo,
}: {
  onLogin: (username: string) => void;
  onSolo: () => void;
}) {
  const deck = useArcadeDeck();
  return (
    <main className="login-cabinet flex min-h-dvh text-foreground flex-col overflow-x-clip">
      <div className="login-bezel flex flex-1 p-3 sm:p-6 lg:px-12 lg:pt-8">
        <LoginScreen onKey={deck.pulse} onLogin={onLogin} onSolo={onSolo} />
      </div>
      <ArcadeDeck stick={deck.stick} pressed={deck.pressed} />
    </main>
  );
}

function LoginScreen({
  onKey,
  onLogin,
  onSolo,
}: {
  onKey: (side: DeckSide) => void;
  onLogin: (username: string) => void;
  onSolo: () => void;
}) {
  const [username, setUsername] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [backdrop, setBackdrop] = useState<BackdropId | null>(null);

  useEffect(() => {
    setBackdrop(nextBackdrop());
  }, []);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
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
      setError("Acepta las reglas del torneo y el aviso de privacidad para continuar.");
      return;
    }
    setError("");
    setLoading(true);
    play("click");
    // Demo: cualquier código de 6 caracteres entra, salvo 000000 (para ver el error).
    setTimeout(() => {
      if (accessCode.trim() === "000000") {
        play("error");
        setError("Código de acceso inválido");
        setLoading(false);
        return;
      }
      play("coin");
      onLogin(username.trim());
    }, 700);
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
            <Label htmlFor="rules" className="text-xs font-normal leading-relaxed text-muted-foreground">
              Acepto las <span className="text-primary">reglas del torneo</span> y el{" "}
              <span className="text-primary">aviso de privacidad</span>
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

          {/* Entrada a la demo solo: un enlace más, para quien no tiene código. */}
          <button
            type="button"
            onClick={() => {
              play("click");
              onSolo();
            }}
            className="block w-full text-center text-xs text-accent hover:underline"
          >
            ¿Sin código? Practica en la demo solo
          </button>

          <span className="block text-center text-xs text-muted-foreground">
            Ver la pista como espectador
          </span>
        </form>

        <p className="text-center text-xs text-white/70">
          Demo: cualquier usuario y código de 6 caracteres entra; 000000 muestra el error.
        </p>
      </div>
    </section>
  );
}
