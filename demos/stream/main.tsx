import { createRoot } from "react-dom/client";

import { applyPalette } from "@/lib/palette";
import { StreamTrailer } from "./StreamTrailer";
import "./stream.css";

applyPalette("arcade");

createRoot(document.getElementById("root")!).render(<StreamTrailer />);
