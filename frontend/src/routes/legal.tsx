import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/legal")({
  component: LegalLayout,
});

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

const SECTIONS = [
  { to: "/legal/privacidad", label: "Aviso de privacidad" },
  { to: "/legal/creditos", label: "Créditos y licencias" },
] as const;

// Centro legal: aviso de privacidad y créditos, con el mismo marco. Texto
// largo: va en la fuente de lectura, no en la pixel.
function LegalLayout() {
  return (
    <div className="run-it-statement min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <Link to="/login" className="text-primary" style={PIXEL}>
            Run&nbsp;It
          </Link>
          <span className="text-sm text-muted-foreground">Legal</span>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-8 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Secciones legales" className="flex flex-row gap-2 md:flex-col">
          {SECTIONS.map((section) => (
            <Link
              key={section.to}
              to={section.to}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              activeProps={{ className: "bg-muted font-semibold text-foreground" }}
            >
              {section.label}
            </Link>
          ))}
          <Link
            to="/login"
            className="mt-auto rounded-md px-3 py-2 text-sm text-primary hover:underline md:mt-6"
          >
            Volver al acceso
          </Link>
        </nav>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
      <footer className="border-t border-border">
        <p className="mx-auto max-w-5xl px-6 py-4 text-xs text-muted-foreground">
          Run It · torneo de programación organizado por WeWolf.
        </p>
      </footer>
    </div>
  );
}
