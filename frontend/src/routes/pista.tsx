import { createFileRoute } from "@tanstack/react-router";
import RaceTrack from "@/components/RaceTrack";

export const Route = createFileRoute("/pista")({
  component: PublicTrackPage,
  head: () => ({
    meta: [
      { title: "Pista en vivo | Run It" },
      { name: "description", content: "Sigue en vivo el avance de los participantes de Run It." },
    ],
  }),
});

function PublicTrackPage() {
  return (
    <main className="mx-auto max-w-7xl px-5 py-8">
      <RaceTrack />
    </main>
  );
}