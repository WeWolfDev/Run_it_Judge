import { createRoot } from "react-dom/client";

import { applyPalette } from "@/lib/palette";
import { Trailer } from "./Trailer";
import "./trailer.css";

// Paleta neón: la más vistosa para el video.
applyPalette("arcade");

createRoot(document.getElementById("root")!).render(<Trailer />);
