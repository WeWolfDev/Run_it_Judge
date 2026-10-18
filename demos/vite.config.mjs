// Build de las demos: el código de src/ (copia de frontend/src) con el backend
// y el socket simulados. Uso: DEMO=admin|participante vite build --config demos/vite.config.mjs
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const demo = process.env.DEMO || "admin";

export default {
  root: here(`./${demo}`),
  base: "./",
  logLevel: "warn",
  publicDir: here("./public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Las demos solo y caster usan los componentes actuales del frontend, no la copia de src/.
      { find: /^@\//, replacement: here(["solo", "caster", "trailer"].includes(demo) ? "../frontend/src/" : "./src/") },
      { find: /^socket\.io-client$/, replacement: here("./fake/socket.ts") },
    ],
  },
  define: {
    "import.meta.env.VITE_SOCKET_URL": JSON.stringify("/"),
    "import.meta.env.VITE_API_URL": JSON.stringify(""),
  },
  // Los workers del juez de la demo solo importan Pyodide y Clang desde jsDelivr.
  worker: { format: "es" },
  build: {
    outDir: here(`./dist/${demo}`),
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 200000,
  },
};
