import { installFakeBackend } from "../fake/backend";
import { setSession } from "@/lib/session";
import "@/styles.css";

installFakeBackend("participante");
setSession({ username: "tú", role: "participant", token: "demo-participant-token" });

const { createRoot } = await import("react-dom/client");
const { DemoShell, applyPalette, storedPalette } = await import("../shell/DemoShell");
applyPalette(storedPalette());
const { default: ParticipantView } = await import("@/components/ParticipantView");

createRoot(document.getElementById("root")!).render(
  <DemoShell role="participant">
    <ParticipantView />
  </DemoShell>,
);
