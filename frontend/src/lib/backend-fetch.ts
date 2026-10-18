// Rutas del backend que un Nginx sin actualizar no enruta: caen en el frontend
// y vuelven como un 404 en HTML. Se reintentan por /api/, que las plantillas de
// Nginx mandan al backend quitando el prefijo. Así el caster, las cuentas de
// caster del panel y los botones del voto funcionan aunque el servidor no tenga
// la regex nueva de deploy/nginx (que sigue siendo lo correcto).

const API_URL = import.meta.env["VITE_API_URL"] ?? "";

export async function backendFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, init);
  const html = (response.headers.get("content-type") ?? "").includes("text/html");
  if (response.status !== 404 || !html || path.startsWith("/api/")) return response;
  return fetch(`${API_URL}/api${path}`, init);
}
