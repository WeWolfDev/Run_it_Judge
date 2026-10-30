# Créditos y licencias

Recursos de terceros que usa Run It. La página `/legal/creditos` muestra lo mismo:
al agregar o quitar un recurso, actualizar los dos (`frontend/src/lib/credits.ts`).
La lista de bibliotecas de código abierto se genera con `npm run licenses`
(`frontend/src/lib/third-party.json`).

Los paquetes originales (`frontend/Run_it_Asset 3/`) **no se versionan**: varias
licencias prohíben redistribuirlos. Se guardan fuera del repo; en el repo solo
quedan las hojas que la app sirve en `frontend/public/`.

## Personajes (`frontend/public/chars/`)

| Recurso | Autor | Licencia | Notas |
| --- | --- | --- | --- |
| Paquete comprado a Penzilla Design | Penzilla Design | Licencia estándar (compra) | **Crédito obligatorio:** "Graphics created by Penzilla Design". Si se modifican los archivos, listar los cambios junto al crédito. Avisar el enlace del proyecto público a PenzillaDesign@gmail.com. Una compra = un proyecto. No redistribuir. **Pendiente: confirmar qué hojas son de este paquete.** |
| Minifolks Humans y Villagers (`Mini*.png`) | LYASeeK | Licencia del autor (itch.io) | No redistribuir el paquete. **Pendiente: confirmar los términos.** |
| Tiny Heroes (`Pink_/Owlet_/Dude_Monster_*.png`) | CraftPix.net | Licencia gratuita de CraftPix | Uso en proyectos permitido; no redistribuir ni revender. |
| Animales (`*SPRITESHEET*.png`, `Animals WIP.aseprite`) | **Pendiente** | **Pendiente** | ¿Es el paquete de Penzilla? |
| NPC (`npc1..12.png`) | **Pendiente** | **Pendiente** | |
| Explorador (`jungle_*.gif`, Jungle Asset Pack) | **Pendiente** | **Pendiente** | |
| `character-blue.gif`, `character-white.gif`, `AnimationSheet.png` | **Pendiente** | **Pendiente** | |

## Fondos y pista

| Recurso | Autor | Licencia |
| --- | --- | --- |
| Space Background, Warped City (`public/backdrops/`) | Luis Zuno (ansimuz) | CC0 1.0 |
| Pixel Platformer: bandera, moneda, dígitos (`public/pista/`) | Kenney | CC0 1.0 |
| Steampunk Cityscape (`public/bg-*.png`) | CraftPix.net | Licencia gratuita de CraftPix |

## Interfaz, sonido y fuentes

| Recurso | Autor | Licencia |
| --- | --- | --- |
| Pixelarticons (`src/components/PixelIcon.tsx`) | Gerrit Halfmann | MIT |
| ZzFX (`src/lib/zzfx.ts`) | Frank Force | MIT |
| KaTeX | Khan Academy y colaboradores | MIT |
| Logos de GitHub y Google (`src/components/solo/account/ProviderButton.tsx`) | GitHub, Inc. y Google LLC | Marcas registradas; solo en los botones de inicio de sesión, según sus guías de marca |
| Press Start 2P, Pixelify Sans, Inter, JetBrains Mono | sus autores, vía Google Fonts | SIL OFL 1.1 |

## Juez en el navegador (demo solo)

No se versionan ni se publican con el sitio: el navegador los baja de jsDelivr.

| Recurso | Autor | Licencia |
| --- | --- | --- |
| Clang y LLD a WebAssembly (`@yowasp/clang`, `src/components/solo/judge/compiler.worker.ts`) | YoWASP, sobre LLVM | ISC (YoWASP), Apache 2.0 con excepciones de LLVM (LLVM) |
| Pyodide (`src/components/solo/judge/python.worker.ts`) | Proyecto Pyodide | MPL 2.0; CPython bajo la licencia PSF |
| Ejercicios (`src/components/solo/problems.ts`) | WeWolf | Enunciados propios; formatos de Codeforces citados en `source` |

## Sin origen confirmado

- `frontend/public/Login.mp4`, `Winner.mp4`: no se usan en el código. Confirmar origen antes de volver a usarlos.
