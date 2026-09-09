import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import AdminPanel from "@/components/AdminPanel";
import { getSession } from "@/lib/session";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Panel de administración — Run It" },
      { name: "description", content: "Controla la ronda activa, los cupos y el avance del torneo." },
      { property: "og:title", content: "Panel de administración — Run It" },
      { property: "og:description", content: "Control de rondas, cupos y participantes del torneo Run It." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      void navigate({ to: "/login" });
      return;
    }

    if (session.role !== "admin") {
      void navigate({ to: "/participante" });
      return;
    }

    setAllowed(true);
  }, [navigate]);

  if (!allowed) return null;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <AdminPanel />
    </div>
  );
}
