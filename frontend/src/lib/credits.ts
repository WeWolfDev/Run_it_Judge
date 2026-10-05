export type Credit = { what: string; author: string; license: string; url?: string; note?: string };

// Recursos gráficos, sonido y fuentes. Misma información que CREDITS.md en la
// raíz del repo: al agregar un recurso, actualizar los dos. La licencia de
// Penzilla Design exige el crédito visible.
export const CREDIT_SECTIONS: Array<{ title: string; items: Credit[] }> = [
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
