import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CasterView } from "@/components/caster/CasterView";
import { getSession, homeFor } from "@/lib/session";

export const Route = createFileRoute("/caster")({
  head: () => ({
    meta: [
      { title: "Caster — Run It" },
      {
        name: "description",
        content: "Enunciado, pista, envíos y votación de la ronda para narrar el torneo en vivo.",
      },
    ],
  }),
  component: CasterPage,
});

// El admin también puede entrar: ve lo mismo que el caster.
function CasterPage() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      void navigate({ to: "/login" });
      return;
    }
    if (session.role !== "caster" && session.role !== "admin") {
      void navigate({ to: homeFor(session.role) });
      return;
    }
    setAllowed(true);
  }, [navigate]);

  if (!allowed) return null;

  return (
    <div className="mx-auto max-w-[110rem] px-5 py-6">
      <CasterView />
    </div>
  );
}
