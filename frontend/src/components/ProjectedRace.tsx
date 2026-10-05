import { ProjectedTrack } from "@/components/ProjectedTrack";
import { useLiveRace } from "@/hooks/use-live-race";

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

/** Pista proyectada con los datos en vivo de la ronda (useLiveRace). */
export function ProjectedRace() {
  const { load, round, board, events, serverOffsetMs } = useLiveRace();

  if (load !== "ready" || !round) return <RaceStandby load={load} />;

  return (
    <ProjectedTrack round={round} board={board} events={events} serverOffsetMs={serverOffsetMs} />
  );
}

export default ProjectedRace;

/** Pantalla de espera de las vistas del público: cargando, error o sin ronda. */
export function RaceStandby({ load }: { load: "loading" | "none" | "error" | "ready" }) {
  return (
    <div
      className="grid h-dvh place-items-center bg-background px-6 text-center"
      aria-busy={load === "loading"}
    >
      <div>
        <p className="text-[clamp(1.2rem,3vw,3rem)] text-primary" style={PIXEL}>
          Run&nbsp;It
        </p>
        <p className="mt-4 text-[clamp(0.9rem,1.6vw,1.6rem)] text-foreground">
          {load === "loading"
            ? "Cargando la pista…"
            : load === "error"
              ? "No se pudo conectar con el servidor"
              : "Todavía no hay una ronda activa"}
        </p>
        {load !== "loading" && (
          <p className="mt-2 text-[clamp(0.75rem,1.1vw,1.1rem)] text-muted-foreground">
            {load === "error"
              ? "La pista no muestra datos hasta recuperar la conexión."
              : "Se actualiza sola cuando el organizador inicie una ronda."}
          </p>
        )}
      </div>
    </div>
  );
}
