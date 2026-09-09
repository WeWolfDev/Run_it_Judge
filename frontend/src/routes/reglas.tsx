import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/reglas")({
  component: RulesPage,
  head: () => ({
    meta: [
      { title: "Reglas del torneo | Run It" },
      { name: "description", content: "Reglas de participación en Run It." },
    ],
  }),
});

function RulesPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-[560px] rounded-lg border border-border bg-card p-8">
        <h1 className="text-xl font-semibold text-card-foreground">Reglas del torneo</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Resuelve el problema de cada ronda dentro del tiempo límite. Las clasificaciones se
          calculan con el estado registrado por el servidor.
        </p>
        <Link to="/" className="mt-8 inline-block text-sm font-medium text-primary hover:underline">
          Volver al acceso
        </Link>
      </section>
    </main>
  );
}