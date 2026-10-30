import { createFileRoute } from "@tanstack/react-router";

import { CreditsContent } from "@/components/legal/CreditsContent";

export const Route = createFileRoute("/legal/creditos")({
  component: CreditsContent,
  head: () => ({
    meta: [
      { title: "Créditos y licencias | Run It" },
      {
        name: "description",
        content:
          "Autores y licencias de los recursos y del software de código abierto que usa Run It.",
      },
    ],
  }),
});
