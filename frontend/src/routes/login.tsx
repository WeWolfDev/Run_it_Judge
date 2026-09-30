import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { setSession } from "@/lib/session";
import { login, register } from "@/lib/api";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Acceso | Run It" },
      { name: "description", content: "Accede a tu torneo de programación Run It." },
    ],
  }),
});

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    try {
      const result = registerMode
        ? await register(username.trim(), accessCode.trim())
        : await login(username.trim(), accessCode.trim());
      setSession({ username: result.user.username, role: result.user.role, token: result.token });
      await navigate({ to: result.user.role === "admin" ? "/admin" : "/participante" });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo iniciar sesión");
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-start justify-center overflow-hidden bg-background p-4 pt-80">
      {/* Video de fondo arcade */}
      <video
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'%3E%3Crect width='100%25' height='100%25' fill='%230a0a1a'/%3E%3C/svg%3E"
      >
        <source
          src="/Login.mp4"
          type="video/mp4"
        />
      </video>

      {/* Overlay oscuro para legibilidad */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Contenido del formulario */}
      <section className="relative z-10 w-full max-w-[300px] rounded-lg border border-border bg-card/80 p-4 shadow-2xl backdrop-blur-md">
        <header className="mb-8 text-center">
          <div className="mb-2 inline-flex items-center gap-2">

          </div>
        </header>

        <form onSubmit={submit} className="space-y-3">
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Nombre de usuario"
            autoComplete="username"
          />

          <div className="relative">
            <Input
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              type={showCode ? "text" : "password"}
              placeholder="Código de acceso"
              className={cn("pr-10", error && "border-destructive")}
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

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button type="submit" variant="secondary" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {registerMode ? "Crear acceso" : "Entrar al torneo"}
          </Button>

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
      </section>
    </main>
  );
}
