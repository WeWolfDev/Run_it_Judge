import { createFileRoute, redirect } from "@tanstack/react-router";

// Los créditos viven en /legal/creditos; esta ruta queda para los enlaces viejos.
export const Route = createFileRoute("/creditos")({
  beforeLoad: () => {
    throw redirect({ to: "/legal/creditos" });
  },
});
