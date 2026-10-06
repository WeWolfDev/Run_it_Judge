import { useCallback, useEffect, useState } from "react";

import { RaceStandby } from "@/components/ProjectedRace";
import { ProjectedTrack } from "@/components/ProjectedTrack";
import { Blackout, Cheer, GradaCard } from "@/components/hits/Grada";
import { useLiveRace } from "@/hooks/use-live-race";
import { formatLeft, useHits } from "@/lib/hits";
import { BalloonsView } from "./Balloons";
import { BoatView } from "./Boat";
import { pickView, type ViewInfo } from "./model";
import { SoccerView } from "./Soccer";
import { Intro } from "./Stage";
import { TowerView } from "./Tower";

/**
 * Vista del público (/publico): la ronda en vivo dibujada como un minijuego.
 * A cada espectador le toca una vista al azar (sin repetir la última que vio)
 * y se vuelve a sortear en cada ronda nueva. Arranca con un cartel que explica
 * cómo se lee.
 */
export function PublicView() {
  const { load, round, board, events, serverOffsetMs } = useLiveRace();
  const hits = useHits();
  const [view, setView] = useState<ViewInfo | null>(null);
  const [intro, setIntro] = useState(false);
  const roundId = round?.id;

  // localStorage solo existe en el cliente: el sorteo va en un efecto.
  useEffect(() => {
    if (!roundId) return;
    setView(pickView());
    setIntro(true);
  }, [roundId]);
  const endIntro = useCallback(() => setIntro(false), []);

  if (load !== "ready" || !round || !view) return <RaceStandby load={load} />;
  const fog = hits.isOn("niebla")
    ? `Niebla · el ranking vuelve en ${formatLeft(hits.left("niebla"))}`
    : null;
  const props = {
    round,
    board,
    events,
    serverOffsetMs,
    fog,
    clockHidden: hits.isOn("reloj-oculto"),
  };
  return (
    <>
      {view.id === "pista" && <ProjectedTrack {...props} />}
      {view.id === "torre" && <TowerView {...props} />}
      {view.id === "globos" && <BalloonsView {...props} />}
      {view.id === "futbol" && <SoccerView {...props} />}
      {view.id === "bote" && <BoatView {...props} />}
      <GradaCard hits={hits} />
      <Cheer hits={hits} />
      <Blackout hits={hits} />
      {intro && <Intro view={view} onDone={endIntro} />}
    </>
  );
}

export default PublicView;
