import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import Ceremony from "@/components/Ceremony";
import PublicView from "@/components/publico/PublicView";
import { useCeremony } from "@/hooks/use-ceremony";
import { getActiveRound } from "@/lib/api";

export const Route = createFileRoute("/publico")({
  component: PublicPage,
  head: () => ({
    meta: [
      { title: "Vista del público | Run It" },
      {
        name: "description",
        content: "La ronda en vivo de Run It, dibujada como un minijuego para los espectadores.",
      },
    ],
  }),
});

// Como /pista: con una ronda en curso, el minijuego; si el último torneo
// terminó, la ceremonia de premios. Las dos ocupan la pantalla entera.
function PublicPage() {
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
      <PublicView />
    </main>
  );
}
