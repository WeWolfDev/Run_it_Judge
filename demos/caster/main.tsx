import { createRoot } from "react-dom/client";

import { applyPalette } from "@/lib/palette";
import { CasterDemo } from "./CasterDemo";
import "./caster.css";

// Arranca con la paleta "Pantalla CRT"; se cambia desde la barra.
applyPalette("crt");

createRoot(document.getElementById("root")!).render(<CasterDemo />);
