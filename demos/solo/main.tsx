import { createRoot } from "react-dom/client";

import { applyPalette } from "@/lib/palette";
import { SoloDemo } from "./SoloDemo";
import "./solo.css";

// La demo arranca con la paleta "Pantalla CRT"; se cambia desde la barra.
applyPalette("crt");

createRoot(document.getElementById("root")!).render(<SoloDemo />);
