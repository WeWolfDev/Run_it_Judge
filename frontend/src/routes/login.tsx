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

    if (accessCode.trim().length < 8) {
      setError("Ingresa tu código de acceso.");
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
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section className="w-full max-w-[400px] rounded-lg border border-border bg-card p-8">
        <header className="mb-8 text-center">
          <div className="mb-2 inline-flex items-center gap-2">
            <div className="h-6 w-6 rounded-sm bg-primary" aria-hidden="true" />
            <span className="text-xl font-semibold tracking-tight text-card-foreground">Run It</span>
          </div>
          <p className="text-sm text-muted-foreground">Compite. Resuelve. Avanza.</p>
        </header>

        <form onSubmit={submit} className="space-y-4">
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
            <Label htmlFor="rules" className="text-xs font-normal leading-relaxed text-muted-foreground">
              Acepto las <Link to="/reglas" className="text-primary hover:underline">reglas del torneo</Link>
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