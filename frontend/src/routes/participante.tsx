import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import ParticipantView from "@/components/ParticipantView";
import { getSession } from "@/lib/session";

export const Route = createFileRoute("/participante")({
  head: () => ({
    meta: [
      { title: "Tu carrera — Run It" },
      { name: "description", content: "Resuelve el problema de la ronda y sigue tu avance en la pista." },
      { property: "og:title", content: "Tu carrera — Run It" },
      { property: "og:description", content: "Enunciado, tests y editor de código para la ronda activa." },
    ],
  }),
  component: ParticipantPage,
});

function ParticipantPage() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      void navigate({ to: "/login" });
      return;
    }

    if (session.role !== "participant") {
      void navigate({ to: "/admin" });
      return;
    }

    setAllowed(true);
  }, [navigate]);

  if (!allowed) return null;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <ParticipantView />
    </div>
  );
}
