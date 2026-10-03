import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import Ceremony from "@/components/Ceremony";
import ProjectedRace from "@/components/ProjectedRace";
import { useCeremony } from "@/hooks/use-ceremony";
import { getActiveRound } from "@/lib/api";

export const Route = createFileRoute("/pista")({
  component: PublicTrackPage,
  head: () => ({
    meta: [
      { title: "Pista en vivo | Run It" },
      { name: "description", content: "Sigue en vivo el avance de los participantes de Run It." },
    ],
  }),
});

// Es lo que se proyecta: con una ronda en curso, la carrera; si el último torneo
// terminó, la ceremonia de premios. Las dos ocupan la pantalla entera.
function PublicTrackPage() {
  const ceremony = useCeremony();
  const [racing, setRacing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      void getActiveRound()
        .then((active) => {
          if (!cancelled) setRacing(Boolean(active));
        })
        .catch(() => undefined);
    check();
    const poll = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [ceremony]);

  if (ceremony && !racing) {
    return (
      <main className="fixed inset-0 z-40 bg-background p-[2vmin]">
        <Ceremony ceremony={ceremony} />
      </main>
    );
  }

  return (
    <main>
      <ProjectedRace />
    </main>
  );
}
