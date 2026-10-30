import { createRoot } from "react-dom/client";

import { SoloApp } from "@/components/solo/SoloApp";
import { storedPalette } from "@/lib/palette";
import { applyPixelCursor } from "@/lib/pixel-cursor";

import "./styles.css";

// Modo solo publicado aparte del torneo (GitHub Pages): la misma demo de
// /practica, sin servidor, sin login y sin chequear si hay una ronda en juego.
// Se compila con vite.solo.config.ts (npm run build:solo).
document.documentElement.dataset["palette"] = storedPalette();

createRoot(document.getElementById("root")!).render(<SoloApp />);

applyPixelCursor();
