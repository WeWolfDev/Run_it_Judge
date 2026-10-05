import { demo, installFakeBackend } from "../fake/backend";
import { setSession } from "@/lib/session";
import "@/styles.css";
import "../publico/publico.css";

// DEMO: la vista del público del repo (components/publico/PublicView) con el
// backend simulado, igual que la demo de la pista.
installFakeBackend("admin");
setSession({ username: "admin", role: "admin", token: "demo-admin-token" });
const pending = demo.rounds().find((r) => r.status === "pending" && r.round_number === 1);
if (pending && !demo.activeRound()) demo.start(pending.id);

const { createRoot } = await import("react-dom/client");
const { applyPalette, storedPalette } = await import("../shell/DemoShell");
applyPalette(storedPalette());
await import("../proyeccion/proyeccion.css");
const { default: PublicView } = await import("@/components/publico/PublicView");

createRoot(document.getElementById("root")!).render(<PublicView />);
