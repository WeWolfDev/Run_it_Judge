import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { clearSession, getSession, type Session } from "../lib/session";
import { logout } from "../lib/api";
import { PixelIcon } from "../components/PixelIcon";
import { applyPalette, PALETTE_BOOT_SCRIPT, PALETTES, storedPalette } from "../lib/palette";
import { applyPixelCursor } from "../lib/pixel-cursor";
import { onSoundChange, setSoundOn, soundOn } from "../lib/sfx";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Run It — Torneo de programación competitiva" },
      {
        name: "description",
        content:
          "Plataforma de torneos de programación por eliminación con pista de carreras en vivo.",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Run It — Torneo de programación competitiva" },
      {
        property: "og:description",
        content: "Rondas por eliminación, pista en vivo y panel de control.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Pixelify+Sans:wght@400;500;600;700&display=swap",
      },
      // Ícono de WeWolf, organizador del torneo.
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
    // La paleta elegida se aplica antes del primer pintado (ver lib/palette.ts).
    scripts: [{ children: PALETTE_BOOT_SCRIPT }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background font-sans">
        <RoleNavigation />
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </div>
    </QueryClientProvider>
  );
}

// Paleta y sonido: preferencias de cada usuario, guardadas en su navegador.
function Preferences() {
  const [palette, setPalette] = useState("");
  const [sound, setSound] = useState(false);
  useEffect(() => {
    setPalette(storedPalette());
    setSound(soundOn());
    applyPixelCursor();
    return onSoundChange(() => setSound(soundOn()));
  }, []);
  return (
    <div className="ml-auto flex items-center gap-3 text-sm">
      <label className="flex items-center gap-2 text-muted-foreground">
        Paleta
        <select
          value={palette}
          onChange={(event) => {
            setPalette(event.target.value);
            applyPalette(event.target.value);
          }}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-ring"
        >
          {PALETTES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => setSoundOn(!sound)}
        aria-pressed={sound}
        className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground"
      >
        Sonido: {sound ? "sí" : "no"}
      </button>
    </div>
  );
}

function RoleNavigation() {
  const navigate = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setSession(getSession());
  }, []);

  if (!session) return null;

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <Link
          to={session.role === "admin" ? "/admin" : "/participante"}
          className="text-sm text-primary"
          style={{ fontFamily: "'Press Start 2P', ui-monospace, monospace" }}
        >
          Run&nbsp;It
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          {session.role === "participant" ? (
            <Link
              to="/participante"
              className="flex items-center gap-1.5"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              <PixelIcon name="flag" className="h-4 w-4 text-primary" /> Mi carrera
            </Link>
          ) : (
            <>
              <Link
                to="/admin"
                className="flex items-center gap-1.5"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                <PixelIcon name="gamepad" className="h-4 w-4 text-primary" /> Administración
              </Link>
              <Link
                to="/pista"
                className="flex items-center gap-1.5"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                <PixelIcon name="flag" className="h-4 w-4 text-primary" /> Pista
              </Link>
            </>
          )}
        </nav>
        <Preferences />
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => {
            void logout()
              .catch(() => undefined)
              .finally(() => {
                clearSession();
                void navigate.navigate({ to: "/login" });
              });
          }}
        >
          Salir
        </button>
      </div>
    </header>
  );
}
