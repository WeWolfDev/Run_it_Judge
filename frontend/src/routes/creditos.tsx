import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/creditos")({
  component: CreditsPage,
  head: () => ({
    meta: [
      { title: "Créditos | Run It" },
      { name: "description", content: "Autores y licencias de los recursos que usa Run It." },
    ],
  }),
});

type Credit = { what: string; author: string; license: string; url?: string; note?: string };

// Misma información que CREDITS.md en la raíz del repo: al agregar un recurso,
// actualizar los dos. La licencia de Penzilla Design exige el crédito visible.
const SECTIONS: Array<{ title: string; items: Credit[] }> = [
  {
    title: "Personajes",
    items: [
      {
        what: "Personajes",
        author: "Graphics created by Penzilla Design",
        license: "Licencia estándar de Penzilla Design",
        url: "https://penzilladesign.com",
      },
      {
        what: "Aldeanos y humanos (Minifolks)",
        author: "LYASeeK",
        license: "Licencia del autor",
        url: "https://lyaseek.itch.io",
      },
      {
        what: "Tiny Heroes",
        author: "CraftPix.net",
        license: "Licencia gratuita de CraftPix",
        url: "https://craftpix.net/file-licenses/",
      },
    ],
  },
  {
    title: "Fondos y pista",
    items: [
      {
        what: "Fondos animados del login (Space Background, Warped City)",
        author: "Luis Zuno (ansimuz)",
        license: "CC0 1.0",
        url: "https://ansimuz.com",
      },
      {
        what: "Bandera, moneda y dígitos de la pista (Pixel Platformer)",
        author: "Kenney",
        license: "CC0 1.0",
        url: "https://kenney.nl/assets/pixel-platformer",
      },
    ],
  },
  {
    title: "Interfaz y sonido",
    items: [
      {
        what: "Íconos (Pixelarticons)",
        author: "Gerrit Halfmann",
        license: "MIT",
        url: "https://github.com/halfmage/pixelarticons",
      },
      {
        what: "Efectos de sonido (ZzFX)",
        author: "Frank Force",
        license: "MIT",
        url: "https://github.com/KilledByAPixel/ZzFX",
      },
      {
        what: "Fuentes Press Start 2P, Pixelify Sans, Inter y JetBrains Mono",
        author: "CodeMan38, Stefie Justprince, Rasmus Andersson y JetBrains",
        license: "SIL Open Font License 1.1",
        url: "https://fonts.google.com",
      },
      {
        what: "Fórmulas matemáticas (KaTeX)",
        author: "Khan Academy y colaboradores",
        license: "MIT",
        url: "https://katex.org",
      },
    ],
  },
];

function CreditsPage() {
  return (
    <main className="flex min-h-screen justify-center bg-background p-6">
      <section className="w-full max-w-[680px] rounded-lg border border-border bg-card p-8">
        <h1 className="text-xl font-semibold text-card-foreground">Créditos</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Run It usa recursos de estos autores. Gracias por compartir su trabajo.
        </p>
        {SECTIONS.map((section) => (
          <div key={section.title} className="mt-6">
            <h2 className="text-sm font-semibold text-primary">{section.title}</h2>
            <ul className="mt-2 space-y-3">
              {section.items.map((item) => (
                <li key={item.what} className="text-sm leading-relaxed">
                  <p className="text-card-foreground">{item.what}</p>
                  <p className="text-muted-foreground">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {item.author}
                      </a>
                    ) : (
                      item.author
                    )}{" "}
                    · {item.license}
                  </p>
                  {item.note && <p className="text-xs text-muted-foreground">{item.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Link to="/" className="mt-8 inline-block text-sm font-medium text-primary hover:underline">
          Volver al acceso
        </Link>
      </section>
    </main>
  );
}
