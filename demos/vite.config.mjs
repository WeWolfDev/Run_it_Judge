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
      { find: /^@\//, replacement: here("./src/") },
      { find: /^socket\.io-client$/, replacement: here("./fake/socket.ts") },
    ],
  },
  define: {
    "import.meta.env.VITE_SOCKET_URL": JSON.stringify("/"),
    "import.meta.env.VITE_API_URL": JSON.stringify(""),
  },
  build: {
    outDir: here(`./dist/${demo}`),
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 200000,
  },
};
