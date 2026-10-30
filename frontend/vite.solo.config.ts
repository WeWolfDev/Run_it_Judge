// Build estático del modo solo para GitHub Pages (MODO_SOLO_PAGES.md). Es
// aparte del de vite.config.ts: sin TanStack Start, sin Nitro y sin backend.
// base "./" hace que funcione en cualquier ruta (wewolfdev.github.io/Run_it_Judge/
// o un dominio propio): tests y sprites se piden con import.meta.env.BASE_URL.
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));
const pub = fileURLToPath(new URL("./public", import.meta.url));
const out = fileURLToPath(new URL("./dist-solo", import.meta.url));

// De public/ solo se publica lo que usa la demo: el sitio es público y varias
// licencias de los sprites piden no redistribuir más de lo necesario
// (CREDITS.md). Al usar un archivo nuevo de public/ en la demo, agregarlo aquí.
const PUBLIC_FILES = [
  "chars",
  "solo-tests",
  "character-white.gif",
  "character-blue.gif",
  "favicon.ico",
  "icon-192.png",
  "apple-touch-icon.png",
];

function copyPublic(): Plugin {
  return {
    name: "run-it-solo-public",
    apply: "build",
    closeBundle() {
      for (const file of PUBLIC_FILES) {
        cpSync(`${pub}/${file}`, `${out}/${file}`, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: "solo",
  base: "./",
  // En desarrollo se sirve public/ entero; el build copia solo PUBLIC_FILES.
  publicDir: process.argv.includes("build") ? false : "../public",
  plugins: [react(), tailwindcss(), copyPublic()],
  resolve: { alias: { "@": src } },
  // Los workers del juez importan Pyodide y Clang desde jsDelivr con import().
  worker: { format: "es" },
  build: { outDir: out, emptyOutDir: true },
  server: { host: "127.0.0.1", port: 4100, strictPort: true },
  preview: { host: "127.0.0.1", port: 4100, strictPort: true },
});
