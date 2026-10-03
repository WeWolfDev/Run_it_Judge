import "@/styles.css";
import "./login.css";

// DEMO: /auth/login y /auth/register simulados. Cualquier código de 6 caracteres
// entra, salvo "000000" (para ver el error). El usuario "admin" entra como admin.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (path !== "/auth/login" && path !== "/auth/register") return realFetch(input, init);
  const { username, accessCode } = JSON.parse(String(init?.body ?? "{}"));
  await new Promise((resolve) => setTimeout(resolve, 700));
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (accessCode === "000000") return json(401, { error: "Código de acceso inválido" });
  const role = username === "admin" ? "admin" : "participant";
  return json(200, { token: "demo", user: { username, role } });
};

const { createRoot } = await import("react-dom/client");
const { applyPalette, storedPalette } = await import("../shell/DemoShell");
applyPalette(storedPalette());
const { LoginDemo } = await import("./LoginDemo");

createRoot(document.getElementById("root")!).render(<LoginDemo />);
