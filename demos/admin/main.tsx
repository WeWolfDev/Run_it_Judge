import { installFakeBackend } from "../fake/backend";
import { setSession } from "@/lib/session";
import "@/styles.css";

// El backend simulado va antes que la app: api.ts usa fetch desde el primer render.
installFakeBackend("admin");
setSession({ username: "admin", role: "admin", token: "demo-admin-token" });

const { createRoot } = await import("react-dom/client");
const { DemoShell, applyPalette, storedPalette } = await import("../shell/DemoShell");
applyPalette(storedPalette());
const { default: AdminPanel } = await import("@/components/AdminPanel");

createRoot(document.getElementById("root")!).render(
  <DemoShell role="admin">
    <AdminPanel />
  </DemoShell>,
);
