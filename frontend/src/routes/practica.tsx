import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { SoloDemo } from "@/components/solo/SoloDemo";
import { getActiveRound } from "@/lib/api";
import { createSocketFeed } from "@/lib/runit";

export const Route = createFileRoute("/practica")({
  head: () => ({
    meta: [
      { title: "Demo solo — Run It" },
      {
        name: "description",
        content: "Practica contra el reloj sin cuenta: el código se corrige en tu navegador.",
      },
    ],
  }),
  component: PracticePage,
});

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

// Demo solo: práctica contrarreloj sin cuenta. Corrige en el navegador
// (components/solo/judge), así que no carga el servidor del torneo. Solo fuera
// del evento: con una ronda en juego no se puede practicar, y si una ronda
// empieza mientras alguien practica, la práctica se cierra.
function PracticePage() {
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "open" | "event">("checking");

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      void getActiveRound()
        .then((active) => {
          if (!cancelled) setState(active ? "event" : "open");
        })
        .catch(() => {
          // Sin servidor no hay evento que proteger: la demo corre igual.
          if (!cancelled) setState((current) => (current === "checking" ? "open" : current));
        });
    check();
    const poll = setInterval(check, 30_000);
    const feed = createSocketFeed("");
    feed?.on("round:started", () => {
      if (!cancelled) setState("event");
    });
    return () => {
      cancelled = true;
      clearInterval(poll);
      feed?.disconnect();
    };
  }, []);

  if (state === "checking") {
    return (
      <p className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
        Cargando la demo…
      </p>
    );
  }

  if (state === "event") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-5 text-center text-foreground">
        <section className="max-w-md rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-primary" style={PIXEL}>
            Torneo en curso
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            La demo solo está disponible fuera del torneo. Mientras se juega una ronda puedes seguir
            la carrera en la pista.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              to="/pista"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Ver la pista
            </Link>
            <Link
              to="/login"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Volver al login
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return <SoloDemo onExit={() => void navigate({ to: "/login" })} />;
}
