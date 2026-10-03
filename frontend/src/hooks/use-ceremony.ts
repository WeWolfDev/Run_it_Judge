import { useEffect, useState } from "react";

import { getCeremony, type Ceremony } from "@/lib/api";
import { createSocketFeed } from "@/lib/runit";

/**
 * Ceremonia del último torneo (null si todavía no terminó). Se vuelve a pedir
 * cuando el admin avanza (ceremony:update), cuando termina un torneo o empieza
 * una ronda, y cada 10 s por si el socket se perdió algún evento.
 */
export function useCeremony() {
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void getCeremony()
        .then((next) => {
          if (!cancelled) setCeremony(next);
        })
        .catch(() => undefined);
    load();
    const poll = setInterval(load, 10_000);
    // Sin ronda: solo escucha los eventos que salen a todos.
    const feed = createSocketFeed("");
    feed?.on("feed:connected", load);
    feed?.on("ceremony:update", load);
    feed?.on("tournament:winner", load);
    feed?.on("round:started", load);
    return () => {
      cancelled = true;
      clearInterval(poll);
      feed?.disconnect();
    };
  }, []);

  return ceremony;
}
