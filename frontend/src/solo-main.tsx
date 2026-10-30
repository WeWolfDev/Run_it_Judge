import { createRoot } from "react-dom/client";

import { SoloApp, SoloFramed } from "@/components/solo/SoloApp";
import { storedPalette } from "@/lib/palette";
import { applyPixelCursor } from "@/lib/pixel-cursor";

import "./styles.css";

// Modo solo publicado aparte del torneo (GitHub Pages): la misma demo de
// /practica, sin servidor, sin login y sin chequear si hay una ronda en juego.
// Se compila con vite.solo.config.ts (npm run build:solo).
document.documentElement.dataset["palette"] = storedPalette();

// GitHub Pages no deja enviar la cabecera frame-ancestors: si otra página mete
// el sitio en un iframe (para engañar clics sobre los botones de cuenta), no se
// muestra el juego, solo un enlace para abrirlo en su propia pestaña.
const framed = window.top !== window.self;

createRoot(document.getElementById("root")!).render(framed ? <SoloFramed /> : <SoloApp />);

if (!framed) applyPixelCursor();
