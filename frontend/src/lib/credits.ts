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
        what: "Logos de GitHub y Google (botones de inicio de sesión del modo solo)",
        author: "GitHub, Inc. y Google LLC",
        license: "Marcas registradas de sus dueños",
        note: "Se usan solo para identificar el inicio de sesión, según sus guías de marca.",
      },
      {
        what: "Fórmulas matemáticas (KaTeX)",
        author: "Khan Academy y colaboradores",
        license: "MIT",
        url: "https://katex.org",
      },
    ],
  },
  {
    title: "Juez en el navegador (demo solo)",
    items: [
      {
        what: "Compilador de C y C++ (Clang y LLD compilados a WebAssembly)",
        author: "YoWASP, sobre LLVM",
        license: "ISC (YoWASP) · Apache 2.0 con excepciones de LLVM (LLVM)",
        url: "https://yowasp.org",
        note: "Se descarga de jsDelivr la primera vez que compilas; no forma parte de este sitio.",
      },
      {
        what: "Python en el navegador (Pyodide)",
        author: "Proyecto Pyodide y colaboradores",
        license: "MPL 2.0 · CPython bajo la licencia de la Python Software Foundation",
        url: "https://pyodide.org",
        note: "Se descarga de jsDelivr la primera vez que eliges Python.",
      },
      {
        what: "Ejercicios de la demo",
        author: "WeWolf",
        license: "Enunciados propios",
        note: "Los formatos de entrada y salida siguen problemas de Codeforces, citados en cada uno.",
      },
    ],
  },
];
