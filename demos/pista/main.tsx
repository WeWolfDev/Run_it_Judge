import { demo, installFakeBackend } from "../fake/backend";
import { setSession } from "@/lib/session";
import "@/styles.css";

// La pista es pública: usa el backend simulado del admin y arranca la ronda 1.
installFakeBackend("admin");
setSession({ username: "admin", role: "admin", token: "demo-admin-token" });
const pending = demo.rounds().find((r) => r.status === "pending" && r.round_number === 1);
if (pending && !demo.activeRound()) demo.start(pending.id);

const { createRoot } = await import("react-dom/client");
const { DemoShell, applyPalette, storedPalette } = await import("../shell/DemoShell");
applyPalette(storedPalette());
const { default: RaceTrack } = await import("@/components/RaceTrack");

createRoot(document.getElementById("root")!).render(
  <DemoShell role="admin">
    <RaceTrack />
  </DemoShell>,
);
